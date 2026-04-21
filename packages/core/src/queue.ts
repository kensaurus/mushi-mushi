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

    const batch = rows.slice(0, BATCH_SIZE);
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const rowId = (row as { id: string }).id;
      const report = await unwrapForSend(row);

      if (!report) {
        // Undecryptable row — drop so it doesn't re-poison the queue forever.
        try {
          if (backend === 'indexeddb') await idbDelete(rowId);
          else lsDelete(rowId);
        } catch {
          lsDelete(rowId);
        }
        failed++;
        continue;
      }

      const result = await client.submitReport(report);

      if (result.ok) {
        try {
          if (backend === 'indexeddb') await idbDelete(rowId);
          else lsDelete(rowId);
        } catch {
          lsDelete(rowId);
        }
        sent++;
      } else {
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

    const handler = () => {
      if (navigator.onLine) {
        flush(client).catch(() => {});
      }
    };

    window.addEventListener('online', handler);
    syncCleanup = () => window.removeEventListener('online', handler);
  }

  function stopAutoSync(): void {
    syncCleanup?.();
    syncCleanup = null;
  }

  return { enqueue, flush, size, clear, startAutoSync, stopAutoSync };
}
