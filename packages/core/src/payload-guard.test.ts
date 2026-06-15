import { describe, it, expect } from 'vitest';
import {
  checkReportPayloadSize,
  estimateJsonBytes,
  formatBytes,
  MAX_REPORT_PAYLOAD_BYTES,
} from './payload-guard';

describe('checkReportPayloadSize', () => {
  it('passes a small payload', () => {
    const result = checkReportPayloadSize({ description: 'a tiny report' });
    expect(result.ok).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.bytes).toBeLessThanOrEqual(result.maxBytes);
    expect(result.reason).toBeUndefined();
    expect(result.serializeFailed).toBeUndefined();
  });

  it('rejects a payload over the limit', () => {
    // A string just past the limit serialises to > maxBytes.
    const big = 'x'.repeat(MAX_REPORT_PAYLOAD_BYTES + 1024);
    const result = checkReportPayloadSize({ blob: big });
    expect(result.ok).toBe(false);
    expect(result.serializeFailed).toBeUndefined();
    expect(result.bytes).toBeGreaterThan(result.maxBytes);
    expect(result.reason).toMatch(/exceeds limit/);
  });

  it('honours a custom maxBytes boundary', () => {
    const payload = { description: 'boundary' };
    const bytes = estimateJsonBytes(payload);
    expect(checkReportPayloadSize(payload, bytes).ok).toBe(true);
    expect(checkReportPayloadSize(payload, bytes - 1).ok).toBe(false);
  });

  it('flags an unserialisable payload as serializeFailed, not too-large', () => {
    const circular: Record<string, unknown> = { description: 'loop' };
    circular.self = circular;
    const result = checkReportPayloadSize(circular);
    expect(result.ok).toBe(false);
    expect(result.serializeFailed).toBe(true);
    expect(result.reason).toMatch(/could not be serialized/);
  });
});

describe('estimateJsonBytes', () => {
  it('measures UTF-8 byte length', () => {
    // "é" is 2 bytes in UTF-8; JSON.stringify wraps the string in quotes.
    expect(estimateJsonBytes('é')).toBe(4);
  });

  it('returns MAX_SAFE_INTEGER for a circular reference', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateJsonBytes(circular)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('formatBytes', () => {
  it('formats B / KB / MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
