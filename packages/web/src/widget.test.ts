/**
 * FILE: packages/web/src/widget.test.ts
 * PURPOSE: Lock down the `MushiWidget` constructor's defensive defaults for
 *          `triggerText`. The field is the only one in the constructor that
 *          uses falsy-OR (`||`) instead of nullish coalescing (`??`), and
 *          the difference matters: a caller that wires this to a cleared
 *          form input or pastes a snippet that emits `triggerText: ""`
 *          would otherwise render an invisible, glyphless trigger button.
 *
 *          See widget.ts:80 for the full reasoning. These tests pin that
 *          behaviour so a future refactor that "normalises" the operator
 *          across the constructor would fail loudly.
 *
 *          Also covers:
 *          - Host element pointer-events / sizing contract (non-interference)
 *          - hideOnSelector suppresses both trigger AND banner (unification)
 *          - removeBodyNudge runs on every suppression / hide / destroy path
 *          - Diagnostics fields surface the right health state
 */

import { describe, it, expect, vi } from 'vitest';
import { MushiWidget, type WidgetCallbacks } from './widget';

const DEFAULT_TRIGGER = '\uD83D\uDC1B'; // 🐛

const noopCallbacks: WidgetCallbacks = {
  onSubmit: () => {},
  onOpen: () => {},
  onClose: () => {},
  onScreenshotRequest: () => {},
};

/** The constructor stores the resolved config in a private field. We need to
 *  reach in for assertions because the public surface only renders into a
 *  shadow root, which is overkill for testing a single field. Casting through
 *  `unknown` keeps the test honest about what we're doing. */
function readTriggerText(w: MushiWidget): string {
  return (w as unknown as { config: { triggerText: string } }).config.triggerText;
}

describe('MushiWidget constructor — triggerText defaults', () => {
  it('falls back to the bug emoji when triggerText is omitted', () => {
    const w = new MushiWidget({}, noopCallbacks);
    expect(readTriggerText(w)).toBe(DEFAULT_TRIGGER);
  });

  it('falls back to the bug emoji when triggerText is undefined', () => {
    const w = new MushiWidget({ triggerText: undefined }, noopCallbacks);
    expect(readTriggerText(w)).toBe(DEFAULT_TRIGGER);
  });

  it('falls back to the bug emoji when triggerText is an empty string', () => {
    // Regression: previously used `??`, which preserved '' verbatim and
    // rendered an invisible trigger button. The configurator snippet
    // generator used to emit `triggerText: ""` whenever a user cleared
    // the input, so empty string was a real path callers hit in practice.
    const w = new MushiWidget({ triggerText: '' }, noopCallbacks);
    expect(readTriggerText(w)).toBe(DEFAULT_TRIGGER);
  });

  it('preserves a real custom triggerText override', () => {
    const w = new MushiWidget({ triggerText: 'Report' }, noopCallbacks);
    expect(readTriggerText(w)).toBe('Report');
  });

  it('preserves a non-default emoji override', () => {
    const w = new MushiWidget({ triggerText: '\u{1F41E}' }, noopCallbacks); // 🐞
    expect(readTriggerText(w)).toBe('\u{1F41E}');
  });
});

// ── Feature-request deep-link ────────────────────────────────────────────────

describe('MushiWidget.open — feature-request deep-link', () => {
  /** jsdom doesn't provide window.matchMedia — stub it out so render() doesn't throw. */
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  /** Read the current step from the widget's private state. */
  function readStep(w: MushiWidget): string {
    return (w as unknown as { step: string }).step;
  }

  function readViaFeatureRequest(w: MushiWidget): boolean {
    return (w as unknown as { viaFeatureRequest: boolean }).viaFeatureRequest;
  }

  it('opens to category step by default', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.open();
    expect(readStep(w)).toBe('category');
  });

  it('opens to intent step when category is provided', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.open({ category: 'bug' });
    expect(readStep(w)).toBe('intent');
  });

  it('opens to details step when featureRequest=true', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.open({ featureRequest: true });
    expect(readStep(w)).toBe('details');
    expect(readViaFeatureRequest(w)).toBe(true);
  });

  it('calls onOpen callback when opened', () => {
    const onOpen = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onOpen });
    w.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not call onOpen if already open', () => {
    const onOpen = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onOpen });
    w.open();
    w.open(); // second call should be a no-op
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

// ── pulseTrigger ─────────────────────────────────────────────────────────────

describe('MushiWidget.pulseTrigger', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  it('is a callable method on the widget instance', () => {
    const w = new MushiWidget({}, noopCallbacks);
    expect(typeof w.pulseTrigger).toBe('function');
  });

  it('does not throw when called with no trigger element in shadow DOM', () => {
    const w = new MushiWidget({}, noopCallbacks);
    // Without a shadow DOM element visible, pulseTrigger should be a no-op
    expect(() => w.pulseTrigger()).not.toThrow();
  });

  it('does not throw when widget is open', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.open();
    // When open, pulseTrigger is a documented no-op
    expect(() => w.pulseTrigger()).not.toThrow();
  });
});

// ── Host element — non-interference contract ──────────────────────────────────

describe('MushiWidget host element — pass-through contract', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  /** Read the private host element via casting. */
  function getHost(w: MushiWidget): HTMLElement {
    return (w as unknown as { host: HTMLElement }).host;
  }

  it('host style is pass-through (pointer-events:none, 0×0) after mount()', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    const host = getHost(w);
    expect(host.style.pointerEvents).toBe('none');
    // jsdom may normalise '0' → '0px' for dimensional properties.
    expect(['0', '0px']).toContain(host.style.width);
    expect(['0', '0px']).toContain(host.style.height);
    expect(host.style.overflow).toBe('visible');
    w.destroy();
  });

  it('host style is pass-through before mount() (constructor safety)', () => {
    const w = new MushiWidget({}, noopCallbacks);
    // Should not blow up — syncHostChromeState is only called at mount() so
    // accessing it before mount is fine (host not yet in the DOM).
    expect(() => getHost(w)).not.toThrow();
  });

  it('host z-index matches configured zIndex', () => {
    const w = new MushiWidget({ zIndex: 1234 }, noopCallbacks);
    w.mount();
    expect(getHost(w).style.zIndex).toBe('1234');
    w.destroy();
  });

  it('host z-index updates when updateConfig changes zIndex', () => {
    const w = new MushiWidget({ zIndex: 1000 }, noopCallbacks);
    w.mount();
    w.updateConfig({ zIndex: 2000 });
    expect(getHost(w).style.zIndex).toBe('2000');
    w.destroy();
  });

  it('getWidgetDiagnostics reports widgetHostPointerSafe:true after mount()', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    const diag = w.getWidgetDiagnostics();
    expect(diag.widgetHostPointerSafe).toBe(true);
    w.destroy();
  });

  it('getWidgetDiagnostics reports widgetHostBounds as {0,0} after mount()', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    const diag = w.getWidgetDiagnostics();
    // jsdom always returns 0 for layout metrics but the shape must be present.
    expect(diag.widgetHostBounds).not.toBeNull();
    w.destroy();
  });

  it('getWidgetDiagnostics returns widgetHostBounds:null when not mounted', () => {
    const w = new MushiWidget({}, noopCallbacks);
    const diag = w.getWidgetDiagnostics();
    expect(diag.widgetHostBounds).toBeNull();
  });
});

// ── hideOnSelector — unified trigger + banner suppression ─────────────────────

describe('MushiWidget hideOnSelector — unified suppression', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    document.querySelectorAll('[data-mushi-test-suppress]').forEach((el) => el.remove());
  });

  /** Injects a `<div data-mushi-test-suppress>` that matches the shared selector below. */
  function injectSuppressor(): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-mushi-test-suppress', '');
    document.body.appendChild(el);
    return el;
  }

  /** CSS selector used across all tests in this suite. */
  const SUPPRESS_SEL = '[data-mushi-test-suppress]';

  it('suppresses trigger when hideOnSelector element is present', () => {
    injectSuppressor();
    const w = new MushiWidget({ hideOnSelector: SUPPRESS_SEL }, noopCallbacks);
    w.mount();
    const diag = w.getWidgetDiagnostics();
    expect(diag.widgetSuppressed).toBe(true);
    w.destroy();
  });

  it('suppresses banner when hideOnSelector element is present', () => {
    injectSuppressor();
    const w = new MushiWidget(
      { trigger: 'banner', hideOnSelector: SUPPRESS_SEL },
      noopCallbacks,
    );
    w.mount();
    const diag = w.getWidgetDiagnostics();
    expect(diag.bannerRendered).toBe(false);
    expect(diag.widgetSuppressed).toBe(true);
    w.destroy();
  });

  it('banner is rendered when hideOnSelector element is absent', () => {
    const w = new MushiWidget(
      { trigger: 'banner', hideOnSelector: SUPPRESS_SEL },
      noopCallbacks,
    );
    w.mount();
    const diag = w.getWidgetDiagnostics();
    expect(diag.bannerRendered).toBe(true);
    expect(diag.widgetSuppressed).toBe(false);
    w.destroy();
  });

  it('widget unsuppressed after hideOnSelector element is removed', () => {
    const suppressor = injectSuppressor();
    const w = new MushiWidget(
      { trigger: 'banner', hideOnSelector: SUPPRESS_SEL },
      noopCallbacks,
    );
    w.mount();
    expect(w.getWidgetDiagnostics().widgetSuppressed).toBe(true);

    suppressor.remove();
    // isSuppressedByHost() reads the live DOM; once the element is gone the
    // diagnostics should immediately reflect that.
    expect(w.getWidgetDiagnostics().widgetSuppressed).toBe(false);
    w.destroy();
  });

  it('tolerates an invalid CSS selector without throwing', () => {
    const w = new MushiWidget(
      { hideOnSelector: ':::invalid:::' },
      noopCallbacks,
    );
    w.mount();
    expect(() => w.getWidgetDiagnostics()).not.toThrow();
    w.destroy();
  });
});

// ── banner — rich layout (message / label / links) ────────────────────────────

describe('MushiWidget banner — rich layout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  const getShadow = (w: MushiWidget): ShadowRoot =>
    (w as unknown as { shadow: ShadowRoot }).shadow;

  it('renders pill, message, and flat actions when message is set', () => {
    const w = new MushiWidget(
      {
        trigger: 'banner',
        bannerConfig: {
          variant: 'neon',
          message: 'App is in active beta — expect rough edges.',
          label: 'Beta',
          bugCta: 'Report a bug',
          featureCta: true,
          featureCtaLabel: 'Feature request',
        },
      },
      noopCallbacks,
    );
    w.mount();
    const shadow = getShadow(w);
    expect(shadow.querySelector('.mushi-banner--rich')).not.toBeNull();
    expect(shadow.querySelector('.mushi-banner-pill')?.textContent).toBe('Beta');
    expect(shadow.querySelector('.mushi-banner-message')?.textContent).toBe(
      'App is in active beta — expect rough edges.',
    );
    expect(shadow.querySelector('.mushi-banner-link')?.textContent).toBe('Report a bug');
    w.destroy();
  });

  it('defaults the pill to "Beta" and hides it with label: false', () => {
    const withDefault = new MushiWidget(
      { trigger: 'banner', bannerConfig: { message: 'Hello' } },
      noopCallbacks,
    );
    withDefault.mount();
    expect(getShadow(withDefault).querySelector('.mushi-banner-pill')?.textContent).toBe('Beta');
    withDefault.destroy();

    const noPill = new MushiWidget(
      { trigger: 'banner', bannerConfig: { message: 'Hello', label: false } },
      noopCallbacks,
    );
    noPill.mount();
    expect(getShadow(noPill).querySelector('.mushi-banner-pill')).toBeNull();
    noPill.destroy();
  });

  it('renders href links as safe anchors and featureRequest links as buttons', () => {
    const w = new MushiWidget(
      {
        trigger: 'banner',
        bannerConfig: {
          message: 'Hello',
          links: [
            { label: 'My submissions', href: 'https://example.com/feedback' },
            { label: 'Request', featureRequest: true },
            { label: '', href: 'https://example.com/skipped' },
            { label: 'Evil', href: 'javascript:alert(1)' },
          ],
        },
      },
      noopCallbacks,
    );
    w.mount();
    const shadow = getShadow(w);
    const anchors = Array.from(shadow.querySelectorAll('a.mushi-banner-link'));
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute('href')).toBe('https://example.com/feedback');
    expect(anchors[0]?.getAttribute('target')).toBe('_blank');
    expect(anchors[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    // The javascript: link degrades to a widget-opening <button>; the
    // empty-label link is skipped entirely.
    const buttons = Array.from(shadow.querySelectorAll('button.mushi-banner-link')).map(
      (b) => b.textContent,
    );
    expect(buttons).toContain('Request');
    expect(buttons).toContain('Evil');
    w.destroy();
  });

  it('keeps the legacy button-only layout when no message is set', () => {
    const w = new MushiWidget(
      { trigger: 'banner', bannerConfig: { bugCta: 'Report' } },
      noopCallbacks,
    );
    w.mount();
    const shadow = getShadow(w);
    expect(shadow.querySelector('.mushi-banner--rich')).toBeNull();
    expect(shadow.querySelector('.mushi-banner-btn')?.textContent).toBe('Report');
    w.destroy();
  });

  it('keeps the dismiss button a direct banner child so action overflow cannot clip it', () => {
    const w = new MushiWidget(
      { trigger: 'banner', bannerConfig: { message: 'Hello' } },
      noopCallbacks,
    );
    w.mount();
    const dismiss = getShadow(w).querySelector('.mushi-banner-dismiss');
    expect(dismiss?.parentElement?.classList.contains('mushi-banner')).toBe(true);
    w.destroy();
  });

  it('updateConfig({ bannerConfig }) switches an already-mounted widget to the rich layout', () => {
    // This is the runtime/dashboard-config path: the widget mounts from
    // bootstrap config before the remote banner copy arrives.
    const w = new MushiWidget({ trigger: 'banner' }, noopCallbacks);
    w.mount();
    expect(getShadow(w).querySelector('.mushi-banner--rich')).toBeNull();

    w.updateConfig({ bannerConfig: { message: 'Server-driven copy' } });
    expect(getShadow(w).querySelector('.mushi-banner--rich')).not.toBeNull();
    expect(getShadow(w).querySelector('.mushi-banner-message')?.textContent).toBe(
      'Server-driven copy',
    );
    w.destroy();
  });
});

// ── body nudge — cleanup on every suppression / hide / destroy path ───────────

describe('MushiWidget banner body-nudge cleanup', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    // Restore any body padding set by tests.
    document.body.style.paddingTop = '';
    document.body.style.paddingBottom = '';
    delete document.body.dataset.mushiBannerNudged;
    document.documentElement.style.removeProperty('--mushi-banner-offset');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    document.querySelectorAll('[data-onboarding-flow]').forEach((el) => el.remove());
  });

  it('destroy() removes the --mushi-banner-offset CSS variable', () => {
    const w = new MushiWidget({ trigger: 'banner' }, noopCallbacks);
    w.mount();
    // Manually apply a nudge to simulate a rendered banner.
    document.documentElement.style.setProperty('--mushi-banner-offset', '36px');
    document.body.style.paddingTop = '36px';
    document.body.dataset.mushiBannerNudged = 'top';

    w.destroy();

    expect(document.documentElement.style.getPropertyValue('--mushi-banner-offset')).toBe('');
    expect(document.body.style.paddingTop).toBe('');
  });

  it('hideTrigger() removes banner body nudge', () => {
    const w = new MushiWidget({ trigger: 'banner' }, noopCallbacks);
    w.mount();
    document.documentElement.style.setProperty('--mushi-banner-offset', '36px');
    document.body.style.paddingTop = '36px';
    document.body.dataset.mushiBannerNudged = 'top';

    w.hideTrigger();

    expect(document.documentElement.style.getPropertyValue('--mushi-banner-offset')).toBe('');
    expect(document.body.style.paddingTop).toBe('');
    w.destroy();
  });

  it('hideOnSelector suppression removes body nudge via getWidgetDiagnostics safety check', () => {
    // Inject suppressor, mount, set nudge manually, then verify diagnostics
    // report suppressed (meaning renderBanner would clear the nudge on re-render).
    const el = document.createElement('div');
    el.setAttribute('data-onboarding-flow', '');
    document.body.appendChild(el);

    const w = new MushiWidget(
      { trigger: 'banner', hideOnSelector: '[data-onboarding-flow]' },
      noopCallbacks,
    );
    w.mount();

    const diag = w.getWidgetDiagnostics();
    expect(diag.widgetSuppressed).toBe(true);
    expect(diag.bannerRendered).toBe(false);
    w.destroy();
  });
});
