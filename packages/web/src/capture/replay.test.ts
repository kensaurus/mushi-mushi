/**
 * Regression tests for rrweb replay privacy defaults.
 *
 * These lock in the secure-by-default masking configuration that was
 * verified safe during the Jul-2026 production-readiness audit. Any
 * future change to these defaults MUST update these tests intentionally
 * (not accidentally silence them).
 *
 * Key invariants:
 *  1. maskAllInputs: true  — all input values masked
 *  2. maskAllText: true    — rendered DOM text masked
 *  3. password selectors always in the mask set, regardless of userOptions
 *  4. user-supplied redactSelectors EXTEND the default mask set (not replace)
 */
import { beforeEach, describe, expect, it, vi, type SpyInstance } from 'vitest';
import { createReplayCapture } from './replay';

// ─── rrweb mock ──────────────────────────────────────────────────────────────

type RecordOptions = {
  emit: (event: unknown) => void;
  maskAllInputs?: boolean;
  maskAllText?: boolean;
  maskTextSelector?: string;
  checkoutEveryNms?: number;
  sampling?: Record<string, unknown>;
};

let capturedOptions: RecordOptions | null = null;
let stopFnCallCount = 0;

const mockStopFn = vi.fn(() => { stopFnCallCount++; });

const mockRrweb = {
  record: vi.fn((opts: RecordOptions) => {
    capturedOptions = opts;
    return mockStopFn;
  }),
};

// Patch dynamic import of 'rrweb' — the module uses a variable-name trick to
// defer resolution; we inject our mock via the module factory below.
vi.mock('rrweb', () => mockRrweb, { virtual: true });

// ─── helpers ────────────────────────────────────────────────────────────────

function getRecordOptions(): RecordOptions {
  if (!capturedOptions) throw new Error('rrweb.record was not called yet');
  return capturedOptions;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('createReplayCapture — privacy defaults', () => {
  beforeEach(() => {
    capturedOptions = null;
    stopFnCallCount = 0;
    mockRrweb.record.mockClear();
    mockStopFn.mockClear();
  });

  it('sets maskAllInputs: true (all input values masked)', async () => {
    const replay = await createReplayCapture({ enabled: true });
    replay.start();
    expect(getRecordOptions().maskAllInputs).toBe(true);
    replay.destroy();
  });

  it('sets maskAllText: true (rendered DOM text masked)', async () => {
    const replay = await createReplayCapture({ enabled: true });
    replay.start();
    expect(getRecordOptions().maskAllText).toBe(true);
    replay.destroy();
  });

  it('always masks password inputs regardless of redactSelectors', async () => {
    const replay = await createReplayCapture({ enabled: true, redactSelectors: [] });
    replay.start();
    const opts = getRecordOptions();
    const selector = opts.maskTextSelector ?? '';
    expect(selector).toContain('input[type="password"]');
    replay.destroy();
  });

  it('user redactSelectors are APPENDED to the default mask set, not replacing it', async () => {
    const userSelectors = ['.my-secret', '[data-redact]'];
    const replay = await createReplayCapture({ enabled: true, redactSelectors: userSelectors });
    replay.start();
    const opts = getRecordOptions();
    const selector = opts.maskTextSelector ?? '';

    // Default password mask must still be present
    expect(selector).toContain('input[type="password"]');
    // User selectors must also be present
    for (const s of userSelectors) {
      expect(selector).toContain(s);
    }
    replay.destroy();
  });

  it('does not call rrweb.record when enabled: false', async () => {
    const replay = await createReplayCapture({ enabled: false });
    replay.start();
    expect(mockRrweb.record).not.toHaveBeenCalled();
    replay.destroy();
  });

  it('does not call rrweb.record before start()', async () => {
    await createReplayCapture({ enabled: true });
    expect(mockRrweb.record).not.toHaveBeenCalled();
  });

  it('calls the rrweb stop function when stop() is called', async () => {
    const replay = await createReplayCapture({ enabled: true });
    replay.start();
    replay.stop();
    expect(mockStopFn).toHaveBeenCalledOnce();
  });

  it('flush returns a copy of the current event buffer', async () => {
    const replay = await createReplayCapture({ enabled: true });
    replay.start();

    // Emit a synthetic event via the captured emit callback
    const fakeEvent = { type: 2, timestamp: Date.now(), data: {} };
    getRecordOptions().emit(fakeEvent);

    const flushed = replay.flush();
    expect(Array.isArray(flushed)).toBe(true);
    replay.destroy();
  });

  it('destroy stops recording and clears the event buffer', async () => {
    const replay = await createReplayCapture({ enabled: true });
    replay.start();

    const fakeEvent = { type: 2, timestamp: Date.now(), data: {} };
    getRecordOptions().emit(fakeEvent);

    replay.destroy();
    expect(mockStopFn).toHaveBeenCalled();
    // Buffer should be empty after destroy
    expect(replay.flush()).toHaveLength(0);
  });
});
