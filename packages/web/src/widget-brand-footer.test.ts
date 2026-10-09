/**
 * FILE: packages/web/src/widget-brand-footer.test.ts
 * PURPOSE: Pin the "Bug reports by Mushi" mark (docs/plan-gtm.md Workstream C §5):
 *          - link href carries the UTM pair and the anonymous project ref
 *          - `brandFooter: false` / omitted hides it; runtime `updateConfig` shows it
 *          - the impression callback fires once per widget instance, the click
 *            callback fires on every activation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MushiWidget, type WidgetCallbacks } from './widget';
import { buildBrandFooterHref } from './widget-helpers';

const REF = 'a1b2c3d4e5f6';
const EXPECTED_HREF = `https://kensaur.us/mushi-mushi/?utm_source=widget&utm_medium=powered-by&ref=${REF}`;

function callbacks(extra: Partial<WidgetCallbacks> = {}): WidgetCallbacks {
  return {
    onSubmit: () => {},
    onOpen: () => {},
    onClose: () => {},
    onScreenshotRequest: () => {},
    ...extra,
  };
}

function shadow(w: MushiWidget): ShadowRoot {
  return (w as unknown as { shadow: ShadowRoot }).shadow;
}

function footerLink(w: MushiWidget): HTMLAnchorElement | null {
  return shadow(w).querySelector<HTMLAnchorElement>('.mushi-brand-footer a.mushi-brand-link');
}

describe('buildBrandFooterHref', () => {
  it('appends the ref only when it looks like a hex hash prefix', () => {
    expect(buildBrandFooterHref(REF)).toBe(EXPECTED_HREF);
    expect(buildBrandFooterHref(null)).toBe('https://kensaur.us/mushi-mushi/?utm_source=widget&utm_medium=powered-by');
    expect(buildBrandFooterHref('not a hash')).toBe('https://kensaur.us/mushi-mushi/?utm_source=widget&utm_medium=powered-by');
  });
});

describe('MushiWidget — "Bug reports by Mushi" mark', () => {
  const widgets: MushiWidget[] = [];

  beforeEach(() => {
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
  });

  afterEach(() => {
    for (const w of widgets.splice(0)) w.destroy();
  });

  function mountOpen(config: ConstructorParameters<typeof MushiWidget>[0], cb: WidgetCallbacks): MushiWidget {
    const w = new MushiWidget(config, cb);
    widgets.push(w);
    w.mount();
    w.setBrandRef(REF);
    w.open();
    return w;
  }

  it('renders a new-tab link with the UTM pair, the hashed ref and the localized copy', () => {
    const w = mountOpen({ brandFooter: true, locale: 'en' }, callbacks());
    const a = footerLink(w);
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe(EXPECTED_HREF);
    expect(a!.getAttribute('target')).toBe('_blank');
    expect(a!.getAttribute('rel')).toContain('noopener');
    expect(a!.textContent).toContain('Bug reports by Mushi');
  });

  it('localizes the copy (ja)', () => {
    const w = mountOpen({ brandFooter: true, locale: 'ja' }, callbacks());
    expect(footerLink(w)!.textContent).toContain('バグ報告は Mushi で');
  });

  it('renders the link without ref until the hash resolves, then adds it', () => {
    const w = new MushiWidget({ brandFooter: true }, callbacks());
    widgets.push(w);
    w.mount();
    w.open();
    expect(footerLink(w)!.getAttribute('href')).toBe(
      'https://kensaur.us/mushi-mushi/?utm_source=widget&utm_medium=powered-by',
    );
    w.setBrandRef(REF);
    expect(footerLink(w)!.getAttribute('href')).toBe(EXPECTED_HREF);
  });

  it('is hidden when brandFooter is false or omitted (default)', () => {
    const off = mountOpen({ brandFooter: false }, callbacks());
    expect(shadow(off).querySelector('.mushi-brand-footer')).toBeNull();
    const dflt = mountOpen({}, callbacks());
    expect(shadow(dflt).querySelector('.mushi-brand-footer')).toBeNull();
  });

  it('appears when the runtime config turns it on after mount', () => {
    const w = mountOpen({}, callbacks());
    expect(shadow(w).querySelector('.mushi-brand-footer')).toBeNull();
    w.updateConfig({ brandFooter: true });
    expect(footerLink(w)!.getAttribute('href')).toBe(EXPECTED_HREF);
  });

  it('fires the impression once per widget instance and the click on every activation', () => {
    const onBrandFooterImpression = vi.fn();
    const onBrandFooterClick = vi.fn();
    const w = mountOpen({ brandFooter: true }, callbacks({ onBrandFooterImpression, onBrandFooterClick }));
    expect(onBrandFooterImpression).toHaveBeenCalledTimes(1);

    // Re-renders and a second open/close cycle must not double count.
    w.setBrandRef('ffffffffffff');
    w.close();
    w.open();
    expect(onBrandFooterImpression).toHaveBeenCalledTimes(1);

    footerLink(w)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    footerLink(w)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onBrandFooterClick).toHaveBeenCalledTimes(2);
  });

  it('never fires the impression while the mark is hidden', () => {
    const onBrandFooterImpression = vi.fn();
    const w = mountOpen({ brandFooter: false }, callbacks({ onBrandFooterImpression }));
    w.close();
    w.open();
    expect(onBrandFooterImpression).not.toHaveBeenCalled();
  });
});
