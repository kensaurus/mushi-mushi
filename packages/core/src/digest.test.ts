/**
 * FILE: packages/core/src/digest.test.ts
 * PURPOSE: Verify sha256Hex and hmacSha256Hex produce correct, consistent output.
 */

import { describe, it, expect, vi } from 'vitest';
import { sha256Hex, hmacSha256Hex } from './digest';

describe('sha256Hex', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const result = await sha256Hex('test');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', async () => {
    const a = await sha256Hex('hello world');
    const b = await sha256Hex('hello world');
    expect(a).toBe(b);
  });

  it('different inputs produce different hashes', async () => {
    const a = await sha256Hex('input-a');
    const b = await sha256Hex('input-b');
    expect(a).not.toBe(b);
  });

  it('uses noble fallback when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const result = await sha256Hex('abc');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
      // Correct NIST SHA-256('abc') value
      expect(result).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('noble fallback matches NIST vector for empty string', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const result = await sha256Hex('');
      expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('hmacSha256Hex', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const result = await hmacSha256Hex('secret', 'message');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different secrets produce different MACs', async () => {
    const a = await hmacSha256Hex('key-a', 'same message');
    const b = await hmacSha256Hex('key-b', 'same message');
    expect(a).not.toBe(b);
  });

  it('different messages produce different MACs', async () => {
    const a = await hmacSha256Hex('key', 'message-a');
    const b = await hmacSha256Hex('key', 'message-b');
    expect(a).not.toBe(b);
  });

  it('uses noble fallback when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const result = await hmacSha256Hex('secret', 'message');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('noble fallback matches the RFC 4231 test-case-2 vector', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      // RFC 4231 §4.3: key="Jefe", data="what do ya want for nothing?"
      const result = await hmacSha256Hex('Jefe', 'what do ya want for nothing?');
      expect(result).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('noble and native paths produce byte-identical output', async () => {
    // Native (Web Crypto) path — crypto.subtle is present in the test runtime.
    const nativeResult = await hmacSha256Hex('test-key', 'test-message');
    expect(nativeResult).toMatch(/^[0-9a-f]{64}$/);

    // Noble fallback path — force native crypto absent so getSubtle() returns null.
    vi.stubGlobal('crypto', undefined);
    let nobleResult: string;
    try {
      nobleResult = await hmacSha256Hex('test-key', 'test-message');
    } finally {
      vi.unstubAllGlobals();
    }

    // The whole point of this module is cross-runtime consistency: the pure-JS
    // fallback must agree byte-for-byte with the hardware-accelerated path.
    expect(nobleResult).toBe(nativeResult);
  });
});
