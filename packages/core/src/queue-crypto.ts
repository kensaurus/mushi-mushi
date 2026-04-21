/**
 * AES-GCM at-rest encryption for the offline queue (Wave S1 / D-16).
 *
 * Why this exists: on shared devices (kiosks, support-agent laptops) a
 * queued bug report sits in plaintext IndexedDB until the next flush.
 * Browser extensions, other tabs on the same origin, and forensic tools
 * with disk access can all read it. For a QA/bug-reporting SDK that
 * encourages users to paste sensitive data into descriptions, that's
 * unacceptable.
 *
 * Design:
 *   - Generate a non-extractable AES-GCM key on first call (256-bit).
 *   - Persist the `CryptoKey` object itself (Web Crypto allows IDB round-
 *     trip of `CryptoKey` without ever serialising the raw bytes).
 *   - Use a 12-byte random IV per payload; prepend it to ciphertext so
 *     decrypt() needs no out-of-band state.
 *   - Never block the caller — all errors bubble up so the queue can fall
 *     back to plaintext storage with a debug log (see queue.ts).
 *
 * The key is tied to the browser origin (same-origin IDB). It does NOT
 * protect against an attacker with admin shell on the device: the browser
 * WILL decrypt on demand for anyone with origin access. That's the same
 * guarantee every origin-bound browser secret has and is the correct
 * threat model for offline bug reports.
 */

const KEY_DB = 'mushi-mushi-keyring';
const KEY_STORE = 'keys';
const KEY_RECORD_ID = 'offline-queue/v1';

let cachedKey: CryptoKey | null = null;
let cachedKeyPromise: Promise<CryptoKey> | null = null;

function hasWebCrypto(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { crypto?: Crypto }).crypto !== 'undefined' &&
    typeof (globalThis as unknown as { crypto: Crypto }).crypto.subtle !== 'undefined' &&
    typeof indexedDB !== 'undefined'
  );
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadKey(): Promise<CryptoKey | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readonly');
    const req = tx.objectStore(KEY_STORE).get(KEY_RECORD_ID);
    req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function storeKey(key: CryptoKey): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).put(key, KEY_RECORD_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Lazily get (or generate once + persist) the AES-GCM key for this origin.
 * `extractable: false` — so a script-level attacker can't `exportKey()` and
 * ship the raw bytes to their server, only use it via `encrypt`/`decrypt`.
 */
export async function getOfflineQueueKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (cachedKeyPromise) return cachedKeyPromise;
  if (!hasWebCrypto()) {
    throw new Error('Web Crypto + IndexedDB required for offline queue encryption');
  }
  cachedKeyPromise = (async () => {
    const existing = await loadKey();
    if (existing) {
      cachedKey = existing;
      return existing;
    }
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    await storeKey(key);
    cachedKey = key;
    return key;
  })();
  return cachedKeyPromise;
}

export interface EncryptedPayload {
  /** Magic marker so decrypt() can tell encrypted vs legacy plaintext rows. */
  readonly _mme: 1;
  readonly iv: string;
  readonly ct: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptJson(plain: unknown): Promise<EncryptedPayload> {
  const key = await getOfflineQueueKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(plain));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return { _mme: 1, iv: bytesToB64(iv), ct: bytesToB64(cipher) };
}

export function isEncryptedPayload(v: unknown): v is EncryptedPayload {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as EncryptedPayload)._mme === 1 &&
    typeof (v as EncryptedPayload).iv === 'string' &&
    typeof (v as EncryptedPayload).ct === 'string'
  );
}

export async function decryptJson<T = unknown>(payload: EncryptedPayload): Promise<T> {
  const key = await getOfflineQueueKey();
  const iv = b64ToBytes(payload.iv);
  const ct = b64ToBytes(payload.ct);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
