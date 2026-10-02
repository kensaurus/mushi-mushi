import { describe, it, expect, vi, afterEach } from 'vitest';
import { createScreenshotCapture } from './screenshot';

/**
 * The widget turns these reasons into actionable copy ("blocked by another
 * site", "timed out"…), so each failure path must report its own reason —
 * a timeout used to arrive as a generic 'error'.
 */
describe('createScreenshotCapture failure reasons', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reports 'unsupported' when the browser has no 2D canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onFailed = vi.fn();
    const events: unknown[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    document.addEventListener('mushi:screenshot_failed', listener);

    await expect(createScreenshotCapture({ onFailed }).take()).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('unsupported');
    expect(events).toEqual([{ reason: 'unsupported' }]);
    document.removeEventListener('mushi:screenshot_failed', listener);
  });

  it("reports 'timeout' when the page image never loads", async () => {
    vi.useFakeTimers();
    const ctx = { scale: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    // jsdom never fires load/error for an SVG blob URL — exactly the WebKit limbo case.
    URL.createObjectURL ??= () => 'blob:mushi-test';
    URL.revokeObjectURL ??= () => {};
    const onFailed = vi.fn();

    const pending = createScreenshotCapture({ onFailed }).take();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('timeout');
  });
});
