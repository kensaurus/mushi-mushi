/**
 * End to end through the SDK: the screenshot that reaches POST /v1/reports is
 * the capture of the REDACTED page — passwords, card fields, [data-private]
 * and [data-mushi-mask] are blacked out before any pixel exists — and the tab
 * share fallback asks for the stream synchronously inside the click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mushi } from './mushi';
import type { MushiConfig } from '@mushi-mushi/core';

// In a browser the tab-share chunk arrives over the network, after an instant
// getDisplayMedia rejection; reproduce that gap.
vi.mock('./capture/display-capture', async (importOriginal) => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return importOriginal();
});

const CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
  capture: { screenshot: 'on-report' },
};

const SECRETS = ['hunter2-secret', '4111111111111111', '123-45-6789', 'mask-me-token'];
const MASKED_JPEG = 'data:image/jpeg;base64,TUFTS0VELUNBUFRVUkU=';
// The widget mounts lazily; on a loaded CI runner that takes longer than
// vi.waitFor's 1 s default, so give it a real deadline instead. The release
// job runs every package's tests at once: on 2026-11-22 this file took 24 s
// there (3.5 s alone) and a 5 s wait ran out between two captures. The
// assertions are unchanged; only how long a slow runner may take.
const WAIT = { timeout: 12_000 };

function shadow(): ShadowRoot {
  return document.getElementById('mushi-mushi-widget')!.shadowRoot!;
}

describe('screenshot submission', { timeout: 30_000 }, () => {
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
    await vi.waitFor(() => expect(shadow().querySelector('.mushi-screenshot-preview img')).not.toBeNull(), WAIT);

    for (const secret of SECRETS) expect(svgSource).not.toContain(secret);
    expect(svgSource).toContain('Checkout page');
    expect(svgSource).toContain('data-mushi-redacted="true"');

    const ta = shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
    ta.value = 'Checkout button does nothing on submit';
    ta.dispatchEvent(new Event('input'));
    (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(posts.some((p) => p.url.endsWith('/v1/reports'))).toBe(true), WAIT);
    const report = posts.find((p) => p.url.endsWith('/v1/reports'))!.body;
    expect(report.screenshotDataUrl).toBe(MASKED_JPEG);
    for (const secret of SECRETS) expect(JSON.stringify(report)).not.toContain(secret);
  });

  describe('a screenshot the reporter did not take is shown before it is sent', () => {
    let captures: number;

    beforeEach(() => {
      captures = 0;
      vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, v: string) {
        if (!v.startsWith('data:image/svg+xml')) return;
        setTimeout(() => this.onload?.(new Event('load')), 0);
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        scale: vi.fn(),
        drawImage: vi.fn(),
        getImageData: () => ({ data: [0, 0, 0, 255] }),
      } as never);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
        captures++;
        return MASKED_JPEG;
      });
    });

    const reports = () => posts.filter((p) => p.url.endsWith('/v1/reports'));
    const send = () => (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();
    async function describeBug(): Promise<void> {
      await vi.waitFor(() => expect(shadow().querySelector('textarea.mushi-textarea')).not.toBeNull(), WAIT);
      const ta = shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
      ta.value = 'Checkout button does nothing on submit';
      ta.dispatchEvent(new Event('input'));
    }

    it('on-report: the first Send captures and shows it, only the second Send sends it', async () => {
      const sdk = Mushi.init(CONFIG);
      sdk.report();
      await describeBug();
      send();

      await vi.waitFor(() => expect(shadow().querySelector('[data-role="screenshot-review"]')).not.toBeNull(), WAIT);
      expect(shadow().querySelector('.mushi-screenshot-preview.open img')).not.toBeNull();
      expect(captures).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(reports()).toHaveLength(0);

      send();
      await vi.waitFor(() => expect(reports()).toHaveLength(1), WAIT);
      expect(reports()[0]!.body.screenshotDataUrl).toBe(MASKED_JPEG);
      expect(captures).toBe(1);
    });

    it('on-report: Remove during review sends no screenshot and takes no new one', async () => {
      const sdk = Mushi.init(CONFIG);
      sdk.report();
      await describeBug();
      send();
      await vi.waitFor(() => expect(shadow().querySelector('[data-action="remove-screenshot"]')).not.toBeNull(), WAIT);

      (shadow().querySelector('[data-action="remove-screenshot"]') as HTMLButtonElement).click();
      expect(shadow().querySelector('[data-role="screenshot-review"]')).toBeNull();
      send();

      await vi.waitFor(() => expect(reports()).toHaveLength(1), WAIT);
      expect(reports()[0]!.body.screenshotDataUrl).toBeUndefined();
      expect(captures).toBe(1);
    });

    it('auto: a screenshot removed after the open capture is not taken again at Send', async () => {
      const sdk = Mushi.init({ ...CONFIG, capture: { screenshot: 'auto' } });
      sdk.report();
      await vi.waitFor(() => expect(shadow().querySelector('[data-action="remove-screenshot"]')).not.toBeNull(), WAIT);
      expect(captures).toBe(1);

      (shadow().querySelector('[data-action="remove-screenshot"]') as HTMLButtonElement).click();
      await describeBug();
      send();

      await vi.waitFor(() => expect(reports()).toHaveLength(1), WAIT);
      expect(reports()[0]!.body.screenshotDataUrl).toBeUndefined();
      expect(captures).toBe(1);
    });

    it('auto: a screenshot shown since open is sent on the first Send', async () => {
      const sdk = Mushi.init({ ...CONFIG, capture: { screenshot: 'auto' } });
      sdk.report();
      await vi.waitFor(() => expect(shadow().querySelector('.mushi-screenshot-preview img')).not.toBeNull(), WAIT);
      await describeBug();
      send();

      await vi.waitFor(() => expect(reports()).toHaveLength(1), WAIT);
      expect(reports()[0]!.body.screenshotDataUrl).toBe(MASKED_JPEG);
      expect(shadow().querySelector('[data-role="screenshot-review"]')).toBeNull();
      expect(captures).toBe(1);
    });

    it('the next report starts fresh after one sent without a screenshot', async () => {
      const sdk = Mushi.init(CONFIG);
      sdk.report();
      await describeBug();
      send();
      await vi.waitFor(() => expect(shadow().querySelector('[data-action="remove-screenshot"]')).not.toBeNull(), WAIT);
      (shadow().querySelector('[data-action="remove-screenshot"]') as HTMLButtonElement).click();
      send();
      await vi.waitFor(() => expect(reports()).toHaveLength(1), WAIT);

      sdk.close();
      sdk.report();
      await describeBug();
      send();
      await vi.waitFor(() => expect(shadow().querySelector('[data-role="screenshot-review"]')).not.toBeNull(), WAIT);
      expect(captures).toBe(2);
    });

    it('on-report: closing at the review step sends nothing, and the next report shows its own new one', async () => {
      const sdk = Mushi.init(CONFIG);
      sdk.report();
      await describeBug();
      send();
      await vi.waitFor(() => expect(shadow().querySelector('[data-role="screenshot-review"]')).not.toBeNull(), WAIT);

      // The reporter cancels with the ✕ at the preview.
      (shadow().querySelector('[data-action="close"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(posts.some((p) => p.url.endsWith('/v1/reports'))).toBe(false);

      // Reopening does not carry the unseen screenshot into the next report.
      sdk.report();
      await describeBug();
      send();
      await vi.waitFor(() => expect(shadow().querySelector('[data-role="screenshot-review"]')).not.toBeNull(), WAIT);
      expect(reports()).toHaveLength(0);
      expect(captures).toBe(2);
    });
  });

  it('on-report: a capture that finishes after the reporter closed is never sent', async () => {
    const STALE = 'data:image/png;base64,U1RBTEU=';
    const FRESH = 'data:image/png;base64,RlJFU0g=';
    let finishFirst: (v: string) => void = () => {};
    let calls = 0;
    const screenshotProvider = () => {
      calls++;
      return calls === 1 ? new Promise<string>((resolve) => { finishFirst = resolve; }) : Promise.resolve(FRESH);
    };
    const sdk = Mushi.init({ ...CONFIG, capture: { screenshot: 'on-report', screenshotProvider } });
    sdk.report();
    await vi.waitFor(() => expect(shadow().querySelector('textarea.mushi-textarea')).not.toBeNull(), WAIT);
    const describeBug = () => {
      const ta = shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
      ta.value = 'Checkout button does nothing on submit';
      ta.dispatchEvent(new Event('input'));
    };
    const send = () => (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();
    describeBug();
    send();
    await vi.waitFor(() => expect(calls).toBe(1), WAIT);

    // A host provider keeps the panel on screen while it captures: the
    // reporter closes it, then the capture comes back.
    (shadow().querySelector('[data-action="close"]') as HTMLButtonElement).click();
    finishFirst(STALE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    sdk.report();
    await vi.waitFor(() => expect(shadow().querySelector('textarea.mushi-textarea')).not.toBeNull(), WAIT);
    describeBug();
    send();
    // A new screenshot is taken and shown; nothing went out yet.
    await vi.waitFor(() => expect(shadow().querySelector('[data-role="screenshot-review"]')).not.toBeNull(), WAIT);
    expect(posts.some((p) => p.url.endsWith('/v1/reports'))).toBe(false);

    send();
    await vi.waitFor(() => expect(posts.some((p) => p.url.endsWith('/v1/reports'))).toBe(true), WAIT);
    const report = posts.find((p) => p.url.endsWith('/v1/reports'))!.body;
    expect(report.screenshotDataUrl).toBe(FRESH);
    expect(JSON.stringify(report)).not.toContain(STALE);
  });

  it('on-report: a Send from a panel closed and reopened mid-capture sends nothing', async () => {
    let finishFirst: (v: string) => void = () => {};
    let calls = 0;
    const screenshotProvider = () => {
      calls++;
      return calls === 1
        ? new Promise<string>((resolve) => { finishFirst = resolve; })
        : Promise.resolve('data:image/png;base64,RlJFU0g=');
    };
    const sdk = Mushi.init({ ...CONFIG, capture: { screenshot: 'on-report', screenshotProvider } });
    const type = (text: string) => {
      const ta = shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    sdk.report();
    await vi.waitFor(() => expect(shadow().querySelector('textarea.mushi-textarea')).not.toBeNull(), WAIT);
    type('Checkout button does nothing on submit');
    (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls).toBe(1), WAIT);

    // Closed and reopened before the capture returns; the reporter starts typing again.
    (shadow().querySelector('[data-action="close"]') as HTMLButtonElement).click();
    sdk.report();
    await vi.waitFor(() => expect(shadow().querySelector('textarea.mushi-textarea')).not.toBeNull(), WAIT);
    type('A different problem, still being written');
    finishFirst('data:image/png;base64,U1RBTEU=');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(posts.some((p) => p.url.endsWith('/v1/reports'))).toBe(false);
    expect(shadow().querySelector('textarea.mushi-textarea')).not.toBeNull();
    expect(shadow().querySelector('[data-role="screenshot-review"]')).toBeNull();
  });

  it('on-report: the image sent is the one shown, captured from the redacted page', async () => {
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
    sdk.report();
    await vi.waitFor(() => expect(shadow().querySelector('textarea.mushi-textarea')).not.toBeNull(), WAIT);
    const ta = shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
    ta.value = 'Checkout button does nothing on submit';
    ta.dispatchEvent(new Event('input'));
    (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow().querySelector('[data-role="screenshot-review"]')).not.toBeNull(), WAIT);

    // What was rasterised for this Send had the private parts blacked out.
    for (const secret of SECRETS) expect(svgSource).not.toContain(secret);
    expect(svgSource).toContain('data-mushi-redacted="true"');
    const shown = shadow().querySelector<HTMLImageElement>('.mushi-screenshot-preview img')!.getAttribute('src');

    (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(posts.some((p) => p.url.endsWith('/v1/reports'))).toBe(true), WAIT);
    const report = posts.find((p) => p.url.endsWith('/v1/reports'))!.body;
    // The bytes sent are the bytes the reporter reviewed, not a second capture.
    expect(report.screenshotDataUrl).toBe(shown);
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
    await vi.waitFor(() => expect(shadow().querySelector('[data-action="screenshot-share-tab"]')).not.toBeNull(), WAIT);

    (shadow().querySelector('[data-action="screenshot-share-tab"]') as HTMLButtonElement).click();
    // No await between the click and the request: the user activation holds.
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(getDisplayMedia.mock.calls[0][0]).toMatchObject({ video: { displaySurface: 'browser' }, audio: false });
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it('a share refused at once shows the permission reason, with no unhandled rejection', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    // A plain function, not vi.fn: vitest's spy subscribes to returned
    // promises (settledResults), which would mark the rejection as handled.
    const getDisplayMedia = () => Promise.reject(denied);
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const sdk = Mushi.init(CONFIG);
      sdk.report({ featureRequest: true });
      (shadow().querySelector('[data-action="screenshot"]') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(shadow().querySelector('[data-action="screenshot-share-tab"]')).not.toBeNull(), WAIT);
      (shadow().querySelector('[data-action="screenshot-share-tab"]') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(shadow().querySelector('[data-role="screenshot-reason"]')?.textContent).toContain('Allow it');
      }, WAIT);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
      // The panel comes back after the attempt.
      expect(document.getElementById('mushi-mushi-widget')!.style.visibility).toBe('');
    } finally {
      process.off('unhandledRejection', unhandled);
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });
});
