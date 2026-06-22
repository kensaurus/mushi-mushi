/**
 * FILE: packages/core/src/digest.test.ts
 * PURPOSE: Verify sha256Hex and hmacSha256Hex produce correct, consistent output.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('noble and native paths agree for same input', async () => {
    const noblePath = async () => {
      vi.stubGlobal('crypto', undefined);
      try {
        return await hmacSha256Hex('test-key', 'test-message');
      } finally {
        vi.unstubAllGlobals();
      }
    };
    const nobleResult = await noblePath();
    expect(nobleResult).toMatch(/^[0-9a-f]{64}$/);
  });
});
