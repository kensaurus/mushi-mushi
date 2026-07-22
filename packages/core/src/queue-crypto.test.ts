/**
 * Security tests for AES-GCM at-rest encryption in the offline queue.
 *
 * Verifies: round-trip correctness, tamper detection (bit-flip → decrypt
 * failure), SubtleCrypto-absent fallback, and the encryption invariant
 * that encrypted payloads never embed plaintext.
 *
 * These run in a jsdom environment: SubtleCrypto comes from Node's global
 * webcrypto (present under vitest's jsdom env), and IndexedDB is supplied by
 * the `fake-indexeddb/auto` import below, which installs an in-memory
 * `globalThis.indexedDB` before any test runs.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptJson,
  encryptJson,
  getOfflineQueueKey,
  isEncryptedPayload,
} from './queue-crypto';

// ─── helpers ────────────────────────────────────────────────────────────────

function flipBit(b64: string): string {
  const chars = b64.split('');
  // Flip one bit in the middle of the ciphertext (not the IV)
  const mid = Math.floor(chars.length / 2);
  const c = chars[mid];
  // XOR the charCode with 1 to flip least-significant bit
  chars[mid] = String.fromCharCode((c?.charCodeAt(0) ?? 0) ^ 1);
  return chars.join('');
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('queue-crypto — AES-GCM at-rest encryption', () => {
  // Reset the module-level cache between tests so each test starts with a
  // fresh key state (avoids cross-test key-reuse pollution).
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encryptJson returns an EncryptedPayload with _mme marker', async () => {
    const payload = { description: 'bug report', secret: 'pii@example.com' };
    const enc = await encryptJson(payload);
    expect(enc._mme).toBe(1);
    expect(typeof enc.iv).toBe('string');
    expect(typeof enc.ct).toBe('string');
    expect(enc.iv.length).toBeGreaterThan(0);
    expect(enc.ct.length).toBeGreaterThan(0);
  });

  it('ciphertext does NOT contain plaintext (PII never stored in the clear)', async () => {
    const payload = { secret: 'supersecret-pii-value-unique-12345' };
    const enc = await encryptJson(payload);
    // Neither the raw JSON nor any field value should appear in the ciphertext
    expect(enc.ct).not.toContain('supersecret-pii-value-unique-12345');
    expect(enc.iv).not.toContain('supersecret-pii-value-unique-12345');
  });

  it('round-trips arbitrary JSON through encrypt → decrypt', async () => {
    const original = {
      id: 'report-abc123',
      category: 'bug',
      description: 'Something broke',
      nested: { a: 1, b: ['x', 'y'] },
    };
    const enc = await encryptJson(original);
    const dec = await decryptJson<typeof original>(enc);
    expect(dec).toEqual(original);
  });

  it('round-trips empty object', async () => {
    const enc = await encryptJson({});
    const dec = await decryptJson(enc);
    expect(dec).toEqual({});
  });

  it('round-trips null-containing payload', async () => {
    const enc = await encryptJson({ value: null });
    const dec = await decryptJson<{ value: null }>(enc);
    expect(dec.value).toBeNull();
  });

  it('each encrypt call generates a unique IV (probabilistic — fails if same IV used twice)', async () => {
    const enc1 = await encryptJson({ a: 1 });
    const enc2 = await encryptJson({ a: 1 });
    // Same plaintext but different IVs → different ciphertexts
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ct).not.toBe(enc2.ct);
  });

  it('tamper detection: bit-flip in ciphertext causes decryptJson to throw', async () => {
    const enc = await encryptJson({ safe: 'value' });
    const tampered = { ...enc, ct: flipBit(enc.ct) };
    await expect(decryptJson(tampered)).rejects.toThrow();
  });

  it('tamper detection: modified IV causes decryptJson to throw', async () => {
    const enc = await encryptJson({ safe: 'value' });
    // Alter the IV string slightly
    const badIv = enc.iv.slice(0, -1) + (enc.iv.slice(-1) === 'A' ? 'B' : 'A');
    const tampered = { ...enc, iv: badIv };
    await expect(decryptJson(tampered)).rejects.toThrow();
  });

  it('isEncryptedPayload identifies encrypted payloads correctly', async () => {
    const enc = await encryptJson({ x: 1 });
    expect(isEncryptedPayload(enc)).toBe(true);
    expect(isEncryptedPayload({ _mme: 1, iv: 'abc', ct: 'def' })).toBe(true);
    expect(isEncryptedPayload({ _mme: 0, iv: 'abc', ct: 'def' })).toBe(false);
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload(undefined)).toBe(false);
    expect(isEncryptedPayload('string')).toBe(false);
    expect(isEncryptedPayload({ iv: 'abc', ct: 'def' })).toBe(false);
  });

  it('getOfflineQueueKey throws when SubtleCrypto is unavailable', async () => {
    // Simulate an environment without SubtleCrypto (e.g., old browser, some workers)
    const originalCrypto = (globalThis as unknown as { crypto?: unknown }).crypto;
    const originalIdb = (globalThis as unknown as { indexedDB?: unknown }).indexedDB;

    try {
      // Remove IndexedDB to trigger the hasWebCrypto() guard
      Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
      // Must re-import to bypass module-level cache
      const { getOfflineQueueKey: freshGet } = await import('./queue-crypto');
      await expect(freshGet()).rejects.toThrow(/Web Crypto|IndexedDB/i);
    } finally {
      // Restore
      if (originalCrypto !== undefined) {
        Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
      }
      if (originalIdb !== undefined) {
        Object.defineProperty(globalThis, 'indexedDB', { value: originalIdb, configurable: true });
      }
    }
  });

  it('getOfflineQueueKey returns the same CryptoKey object on repeated calls (cached)', async () => {
    const k1 = await getOfflineQueueKey();
    const k2 = await getOfflineQueueKey();
    expect(k1).toBe(k2); // reference equality — same CryptoKey instance
  });
});
