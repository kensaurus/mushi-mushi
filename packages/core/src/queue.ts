import type { MushiApiClient, MushiOfflineConfig, MushiReport } from './types';
import { createLogger } from './logger';

const queueLog = createLogger({ scope: 'mushi:queue', level: 'warn' });

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
  const { enabled = true, maxQueueSize = 50, syncOnReconnect = true } = config;

  let syncCleanup: (() => void) | null = null;
  let backendType: StorageBackend | null = null;

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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...report, queuedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAll(): Promise<MushiReport[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as MushiReport[]);
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

  function lsRead(): MushiReport[] {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function lsWrite(reports: MushiReport[]): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(reports));
    } catch {
      // localStorage full or unavailable
    }
  }

  function lsEnqueue(report: MushiReport): void {
    const reports = lsRead();
    reports.push({ ...report, queuedAt: new Date().toISOString() } as MushiReport);
    lsWrite(reports);
  }

  function lsDelete(id: string): void {
    const reports = lsRead().filter((r) => r.id !== id);
    lsWrite(reports);
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
      lsEnqueue(report);
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

    let reports: MushiReport[];
    const backend = detectBackend();

    if (backend === 'indexeddb') {
      try {
        reports = await idbGetAll();
      } catch {
        reports = lsRead();
      }
    } else {
      reports = lsRead();
    }

    const batch = reports.slice(0, BATCH_SIZE);
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < batch.length; i++) {
      const report = batch[i];
      const result = await client.submitReport(report);

      if (result.ok) {
        try {
          if (backend === 'indexeddb') await idbDelete(report.id);
          else lsDelete(report.id);
        } catch {
          lsDelete(report.id);
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
