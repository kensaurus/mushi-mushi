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
    // jsdom never fires load/error for the SVG image — exactly the WebKit limbo case.
    const onFailed = vi.fn();

    const pending = createScreenshotCapture({ onFailed }).take();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('timeout');
  });

  /** Capture the <img> the capturer creates instead of letting jsdom load it. */
  function interceptImage(): { img: () => HTMLImageElement; src: () => string } {
    let img: HTMLImageElement | null = null;
    let src = '';
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, v: string) {
      img = this;
      src = v;
    });
    return { img: () => img!, src: () => src };
  }

  it('loads the page as a data: URL — Chrome taints a foreignObject SVG from a blob: URL', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();

    void createScreenshotCapture().take();
    await vi.advanceTimersByTimeAsync(0);
    expect(spy.src()).toMatch(/^data:image\/svg\+xml;charset=utf-8,(%0A|%20)*%3Csvg/i);
    expect(spy.src()).not.toMatch(/^blob:/);
  });

  it("reports 'csp' when the host's img-src blocks data: images", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();
    const onFailed = vi.fn();

    const pending = createScreenshotCapture({ onFailed }).take();
    await vi.advanceTimersByTimeAsync(0);
    // Browser order is unspecified: error first, violation event right after.
    spy.img().onerror?.(new Event('error'));
    document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), {
      violatedDirective: 'img-src',
      blockedURI: 'data',
    }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('csp');
  });

  it("an image error without a CSP violation stays 'error'", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();
    const onFailed = vi.fn();

    const pending = createScreenshotCapture({ onFailed }).take();
    await vi.advanceTimersByTimeAsync(0);
    spy.img().onerror?.(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('error');
  });
});
