/**
 * FILE: packages/web/src/mushi-loop-events.test.ts
 * PURPOSE: End-to-end (SDK → tracker → wire) check of the growth-loop events
 *          behind the "Bug reports by Mushi" mark: `loop_impression` is sent
 *          once per page session with the hashed project ref, `loop_click`
 *          flushes immediately, and both stay silent when the mark is off.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mushi } from './mushi';
import { flushEvents, sha256Hex, type MushiConfig, type MushiProductEventPayload } from '@mushi-mushi/core';

const PROJECT_ID = '00000000-0000-0000-0000-000000000042';
const CONFIG: MushiConfig = {
  projectId: PROJECT_ID,
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
  widget: { brandFooter: true },
};

function destroyQuietly(): void {
  try {
    Mushi.destroy();
  } catch {
    /* no instance */
  }
}

type FetchCall = { url: string; body: MushiProductEventPayload };

function eventCalls(spy: ReturnType<typeof vi.fn>): FetchCall[] {
  return spy.mock.calls
    .map(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const raw = (init as RequestInit | undefined)?.body;
      return { url, body: typeof raw === 'string' ? (JSON.parse(raw) as MushiProductEventPayload) : ({ events: [] } as MushiProductEventPayload) };
    })
    .filter((c) => c.url.includes('/v1/sdk/events'));
}

function shadowLink(): HTMLAnchorElement | null {
  const host = document.getElementById('mushi-mushi-widget');
  return host?.shadowRoot?.querySelector<HTMLAnchorElement>('a.mushi-brand-link') ?? null;
}

/** Let the sha256 promise and the tracker's `.then` chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('growth loop events (loop_impression / loop_click)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    destroyQuietly();
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: { accepted: 1, dropped: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    destroyQuietly();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends loop_impression once per session with the hashed ref, then loop_click on click', async () => {
    const sdk = Mushi.init(CONFIG);
    const expectedRef = (await sha256Hex(PROJECT_ID)).slice(0, 12);

    sdk.open();
    await settle();
    sdk.close();
    sdk.open();
    await settle();

    // The rendered link carries the same ref the events do.
    expect(shadowLink()?.getAttribute('href')).toBe(
      `https://kensaur.us/mushi-mushi/?utm_source=widget&utm_medium=powered-by&ref=${expectedRef}`,
    );

    await flushEvents();
    const afterImpression = eventCalls(fetchSpy);
    expect(afterImpression).toHaveLength(1);
    const impressions = afterImpression[0]!.body.events.filter((e) => e.name === 'loop_impression');
    expect(impressions).toHaveLength(1);
    expect(impressions[0]!.properties).toMatchObject({ placement: 'widget', $surface: 'web', $ref: expectedRef });
    expect(afterImpression[0]!.body.events.some((e) => e.name === 'loop_click')).toBe(false);

    shadowLink()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    await settle();

    const afterClick = eventCalls(fetchSpy);
    expect(afterClick.length).toBeGreaterThanOrEqual(2);
    const clicks = afterClick.flatMap((c) => c.body.events).filter((e) => e.name === 'loop_click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.properties).toMatchObject({ placement: 'widget', $ref: expectedRef });
    // Still exactly one impression across the whole session.
    expect(afterClick.flatMap((c) => c.body.events).filter((e) => e.name === 'loop_impression')).toHaveLength(1);
  });

  it('sends nothing when the mark is off', async () => {
    const sdk = Mushi.init({ ...CONFIG, widget: { brandFooter: false } });
    sdk.open();
    await settle();
    expect(shadowLink()).toBeNull();
    await flushEvents();
    expect(eventCalls(fetchSpy)).toHaveLength(0);
  });

  it('sends nothing when analytics is disabled even though the mark renders', async () => {
    const sdk = Mushi.init({ ...CONFIG, analytics: { enabled: false } });
    sdk.open();
    await settle();
    expect(shadowLink()).not.toBeNull();
    shadowLink()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    await flushEvents();
    expect(eventCalls(fetchSpy)).toHaveLength(0);
  });
});
