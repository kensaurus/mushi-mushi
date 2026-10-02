/**
 * End to end through the SDK: the screenshot that reaches POST /v1/reports is
 * the capture of the REDACTED page — passwords, card fields, [data-private]
 * and [data-mushi-mask] are blacked out before any pixel exists — and the tab
 * share fallback asks for the stream synchronously inside the click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mushi } from './mushi';
import type { MushiConfig } from '@mushi-mushi/core';

const CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
  capture: { screenshot: 'on-report' },
};

const SECRETS = ['hunter2-secret', '4111111111111111', '123-45-6789', 'mask-me-token'];
const MASKED_JPEG = 'data:image/jpeg;base64,TUFTS0VELUNBUFRVUkU=';

function shadow(): ShadowRoot {
  return document.getElementById('mushi-mushi-widget')!.shadowRoot!;
}

describe('screenshot submission', () => {
  let posts: Array<{ url: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    try { Mushi.destroy(); } catch { /* no instance */ }
    document.body.innerHTML = `
      <input type="password" value="hunter2-secret">
      <input autocomplete="cc-number" value="4111111111111111">
      <div data-private><span>SSN 123-45-6789</span></div>
      <p data-mushi-mask>mask-me-token</p>
      <p>Checkout page</p>`;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    if (typeof requestAnimationFrame !== 'function') {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    }
    posts = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && typeof init.body === 'string') {
        posts.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      }
      const data = url.endsWith('/v1/reports') ? { reportId: 'r-1' } : {};
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    });
  });

  afterEach(() => {
    try { Mushi.destroy(); } catch { /* no instance */ }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('submits the capture of the redacted page, never the secrets', async () => {
    // Rasterising is stubbed (jsdom has no canvas); what matters is WHAT gets
    // rasterised (the SVG) and that its output is what's submitted.
    let svgSource = '';
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, v: string) {
      if (!v.startsWith('data:image/svg+xml')) return;
      svgSource = decodeURIComponent(v.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
      setTimeout(() => this.onload?.(new Event('load')), 0);
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      drawImage: vi.fn(),
      getImageData: () => ({ data: [0, 0, 0, 255] }),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(MASKED_JPEG);

    const sdk = Mushi.init(CONFIG);
    sdk.report({ featureRequest: true });
    (shadow().querySelector('[data-action="screenshot"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow().querySelector('.mushi-screenshot-preview img')).not.toBeNull());

    for (const secret of SECRETS) expect(svgSource).not.toContain(secret);
    expect(svgSource).toContain('Checkout page');
    expect(svgSource).toContain('data-mushi-redacted="true"');

    const ta = shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
    ta.value = 'Checkout button does nothing on submit';
    ta.dispatchEvent(new Event('input'));
    (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(posts.some((p) => p.url.endsWith('/v1/reports'))).toBe(true));
    const report = posts.find((p) => p.url.endsWith('/v1/reports'))!.body;
    expect(report.screenshotDataUrl).toBe(MASKED_JPEG);
    for (const secret of SECRETS) expect(JSON.stringify(report)).not.toContain(secret);
  });

  it('tab share calls getDisplayMedia synchronously inside the click', async () => {
    const getDisplayMedia = vi.fn().mockReturnValue(new Promise(() => {}));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
    // jsdom has no 2D canvas, so the DOM capture fails ('unsupported').
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const sdk = Mushi.init(CONFIG);
    sdk.report({ featureRequest: true });
    // A failed DOM capture surfaces the fallback.
    (shadow().querySelector('[data-action="screenshot"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow().querySelector('[data-action="screenshot-share-tab"]')).not.toBeNull());

    (shadow().querySelector('[data-action="screenshot-share-tab"]') as HTMLButtonElement).click();
    // No await between the click and the request: the user activation holds.
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(getDisplayMedia.mock.calls[0][0]).toMatchObject({ video: { displaySurface: 'browser' }, audio: false });
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });
});
