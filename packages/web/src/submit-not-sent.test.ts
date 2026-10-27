/**
 * A report stopped on the device (pre-filter, on-device classifier, the
 * SDK's send limiter, the host's beforeSend) must never show "Sent". The
 * reporter stays on the report step with their text and a plain "not sent"
 * line, and nothing reaches POST /v1/reports. A real send still shows the
 * receipt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as Core from '@mushi-mushi/core';
import type { MushiConfig, MushiOnDeviceClassifier } from '@mushi-mushi/core';

const limiter = vi.hoisted(() => ({ allow: true }));
vi.mock('@mushi-mushi/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return {
    ...actual,
    createRateLimiter: (...args: Parameters<typeof actual.createRateLimiter>) => {
      const real = actual.createRateLimiter(...args);
      return { ...real, tryConsume: () => limiter.allow && real.tryConsume() };
    },
  };
});

import { Mushi } from './mushi';

const CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
};
const WAIT = { timeout: 5000 };
const NOT_SENT_BLOCKED = 'Not sent. This report was filtered out before sending.';
const NOT_SENT_THROTTLED = 'Not sent. Too many reports in a short time.';

function shadow(): ShadowRoot {
  return document.getElementById('mushi-mushi-widget')!.shadowRoot!;
}

function typeAndSend(text: string): void {
  const ta = shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
  ta.value = text;
  ta.dispatchEvent(new Event('input'));
  (shadow().querySelector('[data-action="submit"]') as HTMLButtonElement).click();
}

function classifier(verdict: 'pass' | 'block', delayMs = 0): MushiOnDeviceClassifier {
  return {
    modelId: 'test-classifier',
    classify: () => new Promise((resolve) => setTimeout(() => resolve({
      verdict, confidence: 0.99, reason: 'test', modelId: 'test-classifier', durationMs: delayMs,
    }), delayMs)),
    destroy: () => {},
  };
}

describe('widget submit outcome', { timeout: 15_000 }, () => {
  let reportPosts: number;

  beforeEach(() => {
    try { Mushi.destroy(); } catch { /* no instance */ }
    limiter.allow = true;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    reportPosts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/v1/reports')) reportPosts += 1;
      const data = url.endsWith('/v1/reports') ? { reportId: 'r-1' } : {};
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    });
  });

  afterEach(() => {
    try { Mushi.destroy(); } catch { /* no instance */ }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function expectNotSent(text: string, message: string): Promise<void> {
    await vi.waitFor(() => {
      expect(shadow().querySelector('[data-role="not-sent"]')?.textContent).toContain(message);
    }, WAIT);
    expect(shadow().querySelector('.mushi-success')).toBeNull();
    expect((shadow().querySelector('textarea.mushi-textarea') as HTMLTextAreaElement).value).toBe(text);
    expect(reportPosts).toBe(0);
  }

  it('pre-filter block: says not sent and keeps the text', async () => {
    Mushi.init(CONFIG).report();
    typeAndSend('zzzzzzzzzzzzzzz');
    await expectNotSent('zzzzzzzzzzzzzzz', NOT_SENT_BLOCKED);
  });

  it('on-device classifier block: says not sent and keeps the text', async () => {
    Mushi.init({ ...CONFIG, preFilter: { wasmClassifier: classifier('block') } }).report();
    typeAndSend('The checkout button does nothing');
    await expectNotSent('The checkout button does nothing', NOT_SENT_BLOCKED);
  });

  it('a classifier that blocks after the receipt showed still reverts to not sent', async () => {
    Mushi.init({ ...CONFIG, preFilter: { wasmClassifier: classifier('block', 900) } }).report();
    typeAndSend('The checkout button does nothing');
    await vi.waitFor(() => expect(shadow().querySelector('.mushi-success')).not.toBeNull(), WAIT);
    await expectNotSent('The checkout button does nothing', NOT_SENT_BLOCKED);
  });

  it('send limiter refusal: says not sent (throttled) and keeps the text', async () => {
    limiter.allow = false;
    Mushi.init(CONFIG).report();
    typeAndSend('The checkout button does nothing');
    await expectNotSent('The checkout button does nothing', NOT_SENT_THROTTLED);
  });

  it('beforeSend returning null: says not sent and keeps the text', async () => {
    Mushi.init({ ...CONFIG, beforeSend: () => null }).report();
    typeAndSend('The checkout button does nothing');
    await expectNotSent('The checkout button does nothing', NOT_SENT_BLOCKED);
  });

  it('keeps an attached screenshot when the report is not sent', async () => {
    const shot = 'data:image/jpeg;base64,U0NSRUVOU0hPVA==';
    Mushi.init({ ...CONFIG, capture: { screenshot: 'on-report', screenshotProvider: async () => shot } }).report();
    (shadow().querySelector('[data-action="screenshot"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow().querySelector('.mushi-screenshot-preview img')).not.toBeNull(), WAIT);
    typeAndSend('zzzzzzzzzzzzzzz');
    await expectNotSent('zzzzzzzzzzzzzzz', NOT_SENT_BLOCKED);
    expect(shadow().querySelector('.mushi-screenshot-preview img')?.getAttribute('src')).toBe(shot);
  });

  it('a delivered report still shows the receipt', async () => {
    Mushi.init({ ...CONFIG, preFilter: { wasmClassifier: classifier('pass') } }).report();
    typeAndSend('The checkout button does nothing');
    await vi.waitFor(() => {
      expect(shadow().querySelector('.mushi-success-receipt-id')?.textContent).toBe('#r-1');
    }, WAIT);
    expect(shadow().querySelector('[data-role="not-sent"]')).toBeNull();
    expect(reportPosts).toBe(1);
  });

  it('the not-sent line clears when the next send goes through', async () => {
    Mushi.init(CONFIG).report();
    typeAndSend('zzzzzzzzzzzzzzz');
    await expectNotSent('zzzzzzzzzzzzzzz', NOT_SENT_BLOCKED);
    typeAndSend('The checkout button does nothing');
    await vi.waitFor(() => expect(shadow().querySelector('.mushi-success')).not.toBeNull(), WAIT);
    expect(reportPosts).toBe(1);
  });
});
