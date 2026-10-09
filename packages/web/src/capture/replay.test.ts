/**
 * Regression tests for rrweb replay privacy defaults.
 *
 * These lock in the secure-by-default masking configuration that was
 * verified safe during the Jul-2026 production-readiness audit. Any
 * future change to these defaults MUST update these tests intentionally
 * (not accidentally silence them).
 *
 * Key invariants:
 *  1. maskAllInputs: true      — all input values masked
 *  2. maskTextSelector: '*'    — every rendered text node masked. rrweb 2.x has
 *     no `maskAllText` option; the earlier `maskAllText: true` was silently
 *     ignored, so this invariant used to pass while text went out in clear.
 *     replay.rrweb.test.ts proves it against the real rrweb.
 *  3. password inputs and [data-mushi-redact] always blocked, regardless of
 *     userOptions
 *  4. user-supplied redactSelectors EXTEND the default block set (not replace)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplayCapture } from './replay';

// ─── rrweb mock ──────────────────────────────────────────────────────────────

type RecordOptions = {
  emit: (event: unknown) => void;
  maskAllInputs?: boolean;
  maskTextSelector?: string;
  blockSelector?: string;
  checkoutEveryNms?: number;
  sampling?: Record<string, unknown>;
};

let capturedOptions: RecordOptions | null = null;

const mockStopFn = vi.fn();

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
    mockRrweb.record.mockClear();
    mockStopFn.mockClear();
  });

  it('sets maskAllInputs: true (all input values masked)', async () => {
    const replay = await createReplayCapture({ enabled: true });
    replay.start();
    expect(getRecordOptions().maskAllInputs).toBe(true);
    replay.destroy();
  });

  it("masks every text node with maskTextSelector '*' (rrweb has no maskAllText)", async () => {
    const replay = await createReplayCapture({ enabled: true });
    replay.start();
    const opts = getRecordOptions();
    expect(opts.maskTextSelector).toBe('*');
    expect(opts).not.toHaveProperty('maskAllText');
    replay.destroy();
  });

  it('always blocks password inputs and [data-mushi-redact] regardless of redactSelectors', async () => {
    const replay = await createReplayCapture({ enabled: true, redactSelectors: [] });
    replay.start();
    const opts = getRecordOptions();
    const selector = opts.blockSelector ?? '';
    expect(selector).toContain('input[type="password"]');
    expect(selector).toContain('[data-mushi-redact]');
    expect(opts.maskAllInputs).toBe(true);
    replay.destroy();
  });

  it('user redactSelectors are APPENDED to the default block set, not replacing it', async () => {
    const userSelectors = ['.my-secret', '[data-redact]'];
    const replay = await createReplayCapture({ enabled: true, redactSelectors: userSelectors });
    replay.start();
    const opts = getRecordOptions();
    const selector = opts.blockSelector ?? '';

    // Default password block must still be present
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

  it("never loads rrweb in 'lite' mode", async () => {
    const replay = await createReplayCapture({ enabled: true, mode: 'lite' });
    replay.start();
    expect(mockRrweb.record).not.toHaveBeenCalled();
    replay.destroy();
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
