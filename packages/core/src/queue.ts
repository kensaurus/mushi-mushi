import type { MushiApiClient, MushiOfflineConfig, MushiReport } from './types';
import { createLogger } from './logger';
import {
  encryptJson,
  decryptJson,
  isEncryptedPayload,
  type EncryptedPayload,
} from './queue-crypto';

const queueLog = createLogger({ scope: 'mushi:queue', level: 'warn' });

// Wave S1 / D-16: opaque at-rest wrapper. Each queue row is either:
//   - a legacy plaintext `MushiReport` (pre-encryption; still readable)
//   - an `EncryptedRecord` with a bare `id` (so count / delete can operate
//     without decrypting every row) plus the encrypted payload blob.
interface EncryptedRecord {
  id: string;
  queuedAt: string;
  payload: EncryptedPayload;
}

type StoredRow = MushiReport | EncryptedRecord;

const DB_NAME = 'mushi-mushi';
const STORE_NAME = 'offline-reports';
const DB_VERSION = 1;
const LS_KEY = 'mushi_offline_queue';
const BATCH_SIZE = 10;
const MAX_BACKOFF_MS = 60_000;
const AUTO_FLUSH_INTERVAL_MS = 30_000;
// A queued report that can never be delivered (corrupt payload, a permanently
// offline host, or a network layer that keeps rejecting the POST) must not
// loop forever — otherwise it hammers the API and floods the console on every
// flush tick and page load. Two independent give-up gates bound the retry
// surface:
//   - MAX_DELIVERY_ATTEMPTS: drop a row after this many transient failures.
//   - MAX_QUEUE_AGE_MS: hard backstop — evict any row older than this on the
//     next flush regardless of attempt count (also clears legacy rows that
//     predate the per-row attempt counter so they stop re-flushing).
const MAX_DELIVERY_ATTEMPTS = 8;
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;

export interface OfflineQueue {
  enqueue(report: MushiReport): Promise<void>;
  flush(client: MushiApiClient): Promise<{ sent: number; failed: number }>;
  size(): Promise<number>;
  clear(): Promise<void>;
  startAutoSync(client: MushiApiClient): void;
  stopAutoSync(): void;
}

type StorageBackend = 'indexeddb' | 'localstorage' | 'none';

export function createOfflineQueue(config: MushiOfflineConfig = {}): OfflineQueue {
  const { enabled = true, maxQueueSize = 50, syncOnReconnect = true, encryptAtRest = true } = config;

  let syncCleanup: (() => void) | null = null;
  let flushInterval: ReturnType<typeof setInterval> | null = null;
  let backendType: StorageBackend | null = null;

  async function wrapForStorage(report: MushiReport): Promise<StoredRow> {
    const queuedAt = new Date().toISOString();
    if (!encryptAtRest) {
      return { ...report, queuedAt } as MushiReport;
    }
    try {
      const payload = await encryptJson(report);
      return { id: report.id, queuedAt, payload } satisfies EncryptedRecord;
    } catch (err) {
      // Encryption failure is non-fatal — queue integrity matters more than
      // at-rest confidentiality. We fall back to plaintext and warn.
      queueLog.warn('Offline queue: encryption failed, storing plaintext', { err: String(err) });
      return { ...report, queuedAt } as MushiReport;
    }
  }

  async function unwrapForSend(row: StoredRow): Promise<MushiReport | null> {
    if (isEncryptedRecord(row)) {
      try {
        return await decryptJson<MushiReport>(row.payload);
      } catch (err) {
        queueLog.warn('Offline queue: decrypt failed, dropping row', { err: String(err), id: row.id });
        return null;
      }
    }
    return row;
  }

  function isEncryptedRecord(row: StoredRow): row is EncryptedRecord {
    return !!(row as EncryptedRecord).payload && isEncryptedPayload((row as EncryptedRecord).payload);
  }

  // The delivery-attempt counter lives on the OUTER row (alongside `id` /
  // `queuedAt`), so it can be read and bumped for an encrypted record without
  // decrypting the payload.
  function rowAttempts(row: StoredRow): number {
    const n = (row as { attempts?: number }).attempts;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }

  // True when a row has outlived MAX_QUEUE_AGE_MS. Rows without a parseable
  // `queuedAt` are never age-evicted here — the attempt counter is their gate.
  function isExpired(row: StoredRow, now: number): boolean {
    const queuedAt = (row as { queuedAt?: string }).queuedAt;
    if (!queuedAt) return false;
    const ts = Date.parse(queuedAt);
    if (Number.isNaN(ts)) return false;
    return now - ts > MAX_QUEUE_AGE_MS;
  }

  function detectBackend(): StorageBackend {
    if (backendType) return backendType;
    if (typeof indexedDB !== 'undefined') {
      backendType = 'indexeddb';
    } else if (typeof localStorage !== 'undefined') {
      backendType = 'localstorage';
    } else {
      backendType = 'none';
    }
    return backendType;
  }

  // --- IndexedDB backend ---

  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        backendType = 'localstorage';
        reject(request.error);
      };
    });
  }

  async function idbEnqueue(report: MushiReport): Promise<void> {
    const db = await openDb();
    const row = await wrapForStorage(report);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAll(): Promise<StoredRow[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as StoredRow[]);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbDelete(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Overwrite an existing row in place (keyed by `id`) — used to persist the
  // incremented attempt counter after a transient failure.
  async function idbPutRow(row: StoredRow): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbSize(): Promise<number> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbClear(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- localStorage fallback ---

  function lsRead(): StoredRow[] {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as StoredRow[]) : [];
    } catch {
      return [];
    }
  }

  function lsWrite(rows: StoredRow[]): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(rows));
    } catch {
      // localStorage full or unavailable
    }
  }

  async function lsEnqueue(report: MushiReport): Promise<void> {
    const rows = lsRead();
    rows.push(await wrapForStorage(report));
    lsWrite(rows);
  }

  function lsDelete(id: string): void {
    const rows = lsRead().filter((r) => r.id !== id);
    lsWrite(rows);
  }

  // Replace an existing row in place (matched by `id`) — used to persist the
  // incremented attempt counter after a transient failure.
  function lsUpdateRow(row: StoredRow): void {
    const rows = lsRead();
    const idx = rows.findIndex((r) => (r as { id: string }).id === (row as { id: string }).id);
    if (idx >= 0) {
      rows[idx] = row;
      lsWrite(rows);
    }
  }

  // --- Backend-aware row mutators ---
  //
  // A queue row lives in exactly one backend (chosen once per session by
  // detectBackend). We must NOT cross-write to the other backend on failure: a
  // row read from IndexedDB does not exist in localStorage, so an `lsDelete` /
  // `lsUpdateRow` fallback is a guaranteed silent no-op. The earlier
  // `catch { lsUpdateRow(row) }` form meant a failed IndexedDB attempt-counter
  // write never persisted, so the row re-flushed forever (bypassing
  // MAX_DELIVERY_ATTEMPTS) until the 24h age sweep — see Sentry 14751132/0.

  // Remove a row from the active backend. A failure is non-fatal: the row
  // survives to the next flush, where the MAX_QUEUE_AGE_MS sweep is the
  // backstop. No cross-backend fallback (see note above).
  async function removeRow(backend: StorageBackend, rowId: string): Promise<void> {
    try {
      if (backend === 'indexeddb') await idbDelete(rowId);
      else lsDelete(rowId);
    } catch (err) {
      queueLog.debug('Offline queue: row removal failed (will age out)', {
        id: rowId,
        err: String(err),
      });
    }
  }

  // Persist a row in place to save its bumped attempt counter. Returns false
  // when the write could not land, so the caller can give up on the row rather
  // than loop forever on a counter that never advances. No cross-backend
  // fallback (see note above).
  async function persistRow(backend: StorageBackend, row: StoredRow): Promise<boolean> {
    try {
      if (backend === 'indexeddb') await idbPutRow(row);
      else lsUpdateRow(row);
      return true;
    } catch (err) {
      queueLog.debug('Offline queue: row persist failed', {
        id: (row as { id: string }).id,
        err: String(err),
      });
      return false;
    }
  }

  // --- Unified interface ---

  async function enqueue(report: MushiReport): Promise<void> {
    if (!enabled) return;

    const currentSize = await size();
    if (currentSize >= maxQueueSize) {
      queueLog.warn('Offline queue full — dropping report', { maxQueueSize });
      return;
    }

    const backend = detectBackend();
    if (backend === 'indexeddb') {
      try {
        await idbEnqueue(report);
        return;
      } catch {
        // IndexedDB failed, fall through to localStorage
        backendType = 'localstorage';
      }
    }

    if (backend === 'localstorage' || backendType === 'localstorage') {
      await lsEnqueue(report);
      return;
    }
  }

  function getBackoffDelay(attempt: number): number {
    return Math.min(1000 * 2 ** attempt + Math.random() * 500, MAX_BACKOFF_MS);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function flush(client: MushiApiClient): Promise<{ sent: number; failed: number }> {
    if (!enabled) return { sent: 0, failed: 0 };

    let rows: StoredRow[];
    const backend = detectBackend();

    if (backend === 'indexeddb') {
      try {
        rows = await idbGetAll();
      } catch {
        rows = lsRead();
      }
    } else {
      rows = lsRead();
    }

    // Backstop: evict any row that has outlived MAX_QUEUE_AGE_MS before we
    // spend a network attempt on it. This sweeps the whole queue (IndexedDB
    // getAll() is key-ordered, not FIFO, so a stale row may not be in the
    // batch window) and clears legacy rows that predate the attempt counter so
    // they can't re-flush forever on every page load.
    const now = Date.now();
    const fresh: StoredRow[] = [];
    for (const row of rows) {
      if (isExpired(row, now)) {
        const rowId = (row as { id: string }).id;
        await removeRow(backend, rowId);
        queueLog.debug('Offline queue: evicting stale report', { id: rowId });
      } else {
        fresh.push(row);
      }
    }
    rows = fresh;

    const batch = rows.slice(0, BATCH_SIZE);
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const rowId = (row as { id: string }).id;
      const report = await unwrapForSend(row);

      if (!report) {
        // Undecryptable row — drop so it doesn't re-poison the queue forever.
        await removeRow(backend, rowId);
        failed++;
        continue;
      }

      const result = await client.submitReport(report);

      if (result.ok) {
        await removeRow(backend, rowId);
        sent++;
      } else {
        const permanent =
          result.error?.code === 'HTTP_400' ||
          result.error?.code === 'HTTP_413' ||
          result.error?.code === 'HTTP_422' ||
          result.error?.code === 'INGEST_ERROR' ||
          result.error?.code === 'VALIDATION_ERROR' ||
          // A payload that exceeds the size guard will never shrink on its own;
          // retrying re-serialises the multi-MB body every sync tick and wedges
          // the queue (it matches neither permanent nor transient otherwise).
          // SERIALIZE_FAILED (circular ref) is likewise unrecoverable on retry.
          result.error?.code === 'PAYLOAD_TOO_LARGE' ||
          result.error?.code === 'SERIALIZE_FAILED' ||
          (typeof result.error?.message === 'string' &&
            /invalid payload|description must be at least|validation/i.test(
              result.error.message,
            ));
        const transient =
          !permanent &&
          (result.error?.code === 'NETWORK_ERROR' ||
            result.error?.code === 'HTTP_403' ||
            result.error?.code === 'HTTP_429' ||
            result.error?.code === 'HTTP_502' ||
            result.error?.code === 'HTTP_503' ||
            result.error?.code === 'HTTP_504' ||
            (typeof result.error?.code === 'string' && result.error.code.startsWith('HTTP_5')));
        if (permanent) {
          await removeRow(backend, rowId);
        } else if (transient) {
          // Bump the per-row attempt counter and give up once it crosses the
          // ceiling, so a report the network keeps rejecting eventually leaves
          // the queue instead of retrying forever on every flush + page load.
          const nextAttempts = rowAttempts(row) + 1;
          if (nextAttempts >= MAX_DELIVERY_ATTEMPTS) {
            await removeRow(backend, rowId);
            queueLog.warn('Offline queue: giving up on report after repeated failures', {
              id: rowId,
              attempts: nextAttempts,
              code: result.error?.code,
            });
          } else {
            (row as { attempts?: number }).attempts = nextAttempts;
            const persisted = await persistRow(backend, row);
            if (persisted) {
              queueLog.debug('Offline queue: transient failure, will retry', {
                id: rowId,
                attempts: nextAttempts,
                code: result.error?.code,
              });
            } else {
              // The bumped counter could not be saved (e.g. an IndexedDB write
              // failure). Leaving the row would re-flush it forever with a
              // counter that never advances, defeating MAX_DELIVERY_ATTEMPTS —
              // so drop it now rather than wait 24h for the age sweep.
              await removeRow(backend, rowId);
              queueLog.warn('Offline queue: dropping report (attempt counter unpersistable)', {
                id: rowId,
                code: result.error?.code,
              });
            }
          }
        }
        failed++;
        if (i < batch.length - 1) {
          await sleep(getBackoffDelay(i));
        }
      }
    }

    return { sent, failed };
  }

  async function size(): Promise<number> {
    const backend = detectBackend();
    if (backend === 'indexeddb') {
      try {
        return await idbSize();
      } catch {
        return lsRead().length;
      }
    }
    return lsRead().length;
  }

  async function clear(): Promise<void> {
    const backend = detectBackend();
    if (backend === 'indexeddb') {
      try {
        await idbClear();
      } catch {
        // fall through
      }
    }
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // unavailable
    }
  }

  function startAutoSync(client: MushiApiClient): void {
    if (!enabled || !syncOnReconnect || typeof window === 'undefined') return;

    const tryFlush = () => {
      if (navigator.onLine) {
        flush(client).catch(() => {});
      }
    };

    window.addEventListener('online', tryFlush);
    flushInterval = setInterval(() => {
      void size().then((n) => {
        if (n > 0) tryFlush();
      });
    }, AUTO_FLUSH_INTERVAL_MS);
    syncCleanup = () => {
      window.removeEventListener('online', tryFlush);
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
    };
  }

  function stopAutoSync(): void {
    syncCleanup?.();
    syncCleanup = null;
  }

  return { enqueue, flush, size, clear, startAutoSync, stopAutoSync };
}
