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

const SECRETS_HTML = `
  <input type="password" value="hunter2-secret">
  <input autocomplete="cc-number" value="4111111111111111">
  <input autocomplete="cc-csc" value="737">
  <div data-private><span>SSN 123-45-6789</span></div>
  <p data-mushi-mask>mask-me-token</p>
  <p class="ssn">host-listed-999</p>
  <p>Visible copy</p>`;
const SECRETS = ['hunter2-secret', '4111111111111111', '737', '123-45-6789', 'mask-me-token'];

describe('screenshot redaction before capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('blacks out passwords, card fields, [data-private] and [data-mushi-mask] even with a custom redact list', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = SECRETS_HTML;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    let src = '';
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation((v: string) => { src = v; });

    void createScreenshotCapture({ privacy: { redactSelectors: ['.ssn'] } }).take();
    await vi.advanceTimersByTimeAsync(0);
    const svg = decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    for (const secret of [...SECRETS, 'host-listed-999']) expect(svg).not.toContain(secret);
    expect(svg).toContain('Visible copy');
    // The live page is untouched — only the serialized clone is redacted.
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('hunter2-secret');
  });
});

describe('tab-share frame grab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('masks sensitive selectors on the page while the frame is drawn, then stops the share', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    let maskDuringDraw = '';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => { maskDuringDraw = document.querySelector('style[data-mushi-capture-mask]')?.textContent ?? ''; },
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,VEFC');
    const { grabMaskedTabFrame } = await import('./display-capture');

    const pending = grabMaskedTabFrame(Promise.resolve(stream), ['input[type="password"]', '[data-private]']);
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toBe('data:image/jpeg;base64,VEFC');
    expect(maskDuringDraw).toContain(':is(input[type="password"],[data-private])');
    expect(document.querySelector('style[data-mushi-capture-mask]')).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a cancelled share rejects and leaves no mask behind', async () => {
    const { grabMaskedTabFrame } = await import('./display-capture');
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    await expect(grabMaskedTabFrame(Promise.reject(denied), ['[data-private]'])).rejects.toBe(denied);
    expect(document.querySelector('style[data-mushi-capture-mask]')).toBeNull();
  });
});
