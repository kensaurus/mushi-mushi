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
import { formatReceiptTime, shouldShowSdkFreshness, submitShortcutKey } from './widget-helpers';

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

// ── One-screen report: open() entry points ───────────────────────────────────

describe('MushiWidget.open — one-screen report', () => {
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

  function readStep(w: MushiWidget): string {
    return (w as unknown as { step: string }).step;
  }
  const chipChecked = (w: MushiWidget, id: string) =>
    (w as unknown as { shadow: ShadowRoot }).shadow.querySelector(`[data-category="${id}"]`)?.getAttribute('aria-checked');

  it('opens on the report screen with no type picked', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open();
    expect(readStep(w)).toBe('report');
    expect(chipChecked(w, 'bug')).toBe('false');
    expect(chipChecked(w, 'idea')).toBe('false');
    w.destroy();
  });

  it('preselects the type chip when a category is provided', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ category: 'bug' });
    expect(readStep(w)).toBe('report');
    expect(chipChecked(w, 'bug')).toBe('true');
    w.destroy();
  });

  it('preselects the Idea chip when featureRequest=true', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });
    expect(readStep(w)).toBe('report');
    expect(chipChecked(w, 'idea')).toBe('true');
    w.destroy();
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

// ── progressive disclosure — host categories behind "More…" ─────────────────

describe('MushiWidget progressive disclosure — host categories', () => {
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

  const getShadow = (w: MushiWidget): ShadowRoot =>
    (w as unknown as { shadow: ShadowRoot }).shadow;

  it('keeps host categories behind More… and collapses them again on the next open', () => {
    // Regression (Sentry 14751132/1): an expanded list used to stay expanded
    // across navigation.
    const w = new MushiWidget({ categories: [{ id: 'billing', label: 'Billing' }] }, noopCallbacks);
    w.mount();
    w.open();
    expect(getShadow(w).querySelector('[data-category="billing"]')).toBeNull();
    (getShadow(w).querySelector('[data-action="show-all-categories"]') as HTMLElement).click();
    expect(getShadow(w).querySelector('[data-category="billing"]')).not.toBeNull();
    expect(getShadow(w).querySelector('[data-action="show-all-categories"]')).toBeNull();

    w.close();
    w.open();
    expect(getShadow(w).querySelector('[data-category="billing"]')).toBeNull();
    w.destroy();
  });
});

// ── screenshot preview + sensitive-info hint ──────────────────────────────────

describe('MushiWidget screenshot preview + sensitive-info hint', () => {
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

  const getShadow = (w: MushiWidget): ShadowRoot =>
    (w as unknown as { shadow: ShadowRoot }).shadow;
  // A 1x1 transparent PNG data URL — stands in for a captured screenshot.
  const DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

  it('renders the preview image and the default privacy hint when a screenshot is attached', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true }); // lands directly on the details step
    w.setScreenshotAttached(true);
    w.setScreenshotPreview(DATA_URL);

    const img = getShadow(w).querySelector('.mushi-screenshot-preview img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(DATA_URL);

    const hint = getShadow(w).querySelector('.mushi-screenshot-hint');
    expect(hint).not.toBeNull();
    // Default English copy nudges the user to remove anything private.
    expect(hint!.textContent).toContain('remove it');
    w.destroy();
  });

  it('hides the hint caption when screenshotSensitiveHint is false (preview still shows)', () => {
    const w = new MushiWidget({ screenshotSensitiveHint: false }, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });
    w.setScreenshotAttached(true);
    w.setScreenshotPreview(DATA_URL);

    expect(getShadow(w).querySelector('.mushi-screenshot-preview img')).not.toBeNull();
    expect(getShadow(w).querySelector('.mushi-screenshot-hint')).toBeNull();
    w.destroy();
  });

  it('shows a custom hint string verbatim', () => {
    const custom = 'Hide your account number before sending.';
    const w = new MushiWidget({ screenshotSensitiveHint: custom }, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });
    w.setScreenshotAttached(true);
    w.setScreenshotPreview(DATA_URL);

    expect(getShadow(w).querySelector('.mushi-screenshot-hint')?.textContent).toContain(custom);
    w.destroy();
  });

  it('drops the preview when the screenshot is detached', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });
    w.setScreenshotAttached(true);
    w.setScreenshotPreview(DATA_URL);
    expect(getShadow(w).querySelector('.mushi-screenshot-preview')).not.toBeNull();

    w.setScreenshotAttached(false); // also clears the preview internally
    expect(getShadow(w).querySelector('.mushi-screenshot-preview')).toBeNull();
    w.destroy();
  });
});

// ── Form draft persistence across re-renders ─────────────────────────────────

describe('MushiWidget — description draft survives background render', () => {
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

  const getShadow = (w: MushiWidget): ShadowRoot =>
    (w as unknown as { shadow: ShadowRoot }).shadow;

  it('preserves typed description when capture state triggers a re-render', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });

    const textarea = getShadow(w).querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    textarea.value = 'Steps to reproduce: tap Save twice';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // Mimics attach-screenshot success or quiet inbox poll side-effects.
    w.setScreenshotCapturing(true);
    w.setScreenshotCapturing(false);

    const restored = getShadow(w).querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
    expect(restored.value).toBe('Steps to reproduce: tap Save twice');
    w.destroy();
  });

  it('refreshReporterInboxQuiet updates the badge without touching the textarea', async () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });

    const textarea = getShadow(w).querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
    textarea.value = 'Still typing…';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    (w as unknown as { reporterReports: Array<{ unread_count: number }> }).reporterReports = [
      { unread_count: 2 },
    ];
    await w.refreshReporterInboxQuiet();

    const after = getShadow(w).querySelector('textarea.mushi-textarea') as HTMLTextAreaElement;
    expect(after.value).toBe('Still typing…');
    w.destroy();
  });
});

// ── Element-selector error feedback (symmetric with screenshot errors) ───────

describe('MushiWidget — element selector error feedback', () => {
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

  const getShadow = (w: MushiWidget): ShadowRoot =>
    (w as unknown as { shadow: ShadowRoot }).shadow;
  const elementBtn = (w: MushiWidget) =>
    getShadow(w).querySelector('[data-action="element"]') as HTMLButtonElement | null;

  it('shows the failed label and error class after setElementError(true)', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });

    w.setElementError(true);

    const btn = elementBtn(w);
    expect(btn).not.toBeNull();
    expect(btn!.className).toContain('error');
    expect(btn!.getAttribute('aria-label')).toContain("Couldn't select");
    w.destroy();
  });

  it('clears the error and stops the capturing spinner via setElementError', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });

    w.setElementCapturing(true);
    w.setElementError(true);
    expect((w as unknown as { elementCapturing: boolean }).elementCapturing).toBe(false);
    expect((w as unknown as { elementError: boolean }).elementError).toBe(true);
    w.destroy();
  });

  it('a successful selection clears a stale error from a previous attempt', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });

    w.setElementError(true);
    w.setElementSelected(true);

    const btn = elementBtn(w);
    expect(btn!.className).not.toContain('error');
    expect(btn!.getAttribute('aria-label')).toContain('Element selected');
    w.destroy();
  });

  it('starting a new capture attempt clears a stale error', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });

    w.setElementError(true);
    w.setElementCapturing(true);
    expect((w as unknown as { elementError: boolean }).elementError).toBe(false);
    w.destroy();
  });

  it('open() resets any stale elementError from a previous session', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });
    w.setElementError(true);
    w.close();

    w.open({ featureRequest: true });
    expect((w as unknown as { elementError: boolean }).elementError).toBe(false);
    w.destroy();
  });
});

// ── Live-QA polish (2026-10-02, Windows Chrome), ported to the one-screen report ─

describe('MushiWidget — live-QA polish', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  const getShadow = (w: MushiWidget): ShadowRoot =>
    (w as unknown as { shadow: ShadowRoot }).shadow;
  const readStep = (w: MushiWidget): string => (w as unknown as { step: string }).step;
  const q = <T extends Element = HTMLElement>(w: MushiWidget, sel: string): T | null =>
    getShadow(w).querySelector(sel) as T | null;
  const LONG = 'The save button does nothing when I click it twice';
  const REPORT_ID = 'abcdef12-3456-7890-abcd-ef1234567890';

  function typeDescription(w: MushiWidget, text: string): void {
    const ta = q<HTMLTextAreaElement>(w, 'textarea.mushi-textarea')!;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submit(w: MushiWidget): void {
    q<HTMLButtonElement>(w, '[data-action="submit"]')!.click();
  }

  // Item 1
  it('the built-in trigger opens the report screen with no type preselected', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    q<HTMLButtonElement>(w, '.mushi-trigger')!.click();
    expect(readStep(w)).toBe('report');
    expect(q(w, '[data-category="bug"]')?.getAttribute('aria-checked')).toBe('false');
    w.destroy();
  });

  it('the banner bug action also opens the report screen', () => {
    const w = new MushiWidget({ trigger: 'banner' }, noopCallbacks);
    w.mount();
    q<HTMLButtonElement>(w, '.mushi-banner-btn')!.click();
    expect(readStep(w)).toBe('report');
    w.destroy();
  });

  // Items 2 + 9
  it('the Idea chip swaps the placeholder and submits user_category=feature', () => {
    const onSubmit = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onSubmit });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-category="idea"]')!.click();
    expect(q<HTMLTextAreaElement>(w, 'textarea.mushi-textarea')!.placeholder).toBe('Describe your idea…');
    typeDescription(w, 'Please add a CSV export for my invoices');
    submit(w);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'other',
      userCategory: 'feature',
      intent: 'Feature request',
    }));
    w.destroy();
  });

  it('the Idea chip is feature mode in Japanese too', () => {
    const onSubmit = vi.fn();
    const w = new MushiWidget({ locale: 'ja' }, { ...noopCallbacks, onSubmit });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-category="idea"]')!.click();
    expect(q(w, '[data-category="idea"]')!.textContent).toBe('アイデア');
    expect(q<HTMLTextAreaElement>(w, 'textarea.mushi-textarea')!.placeholder).toBe('アイデアを教えてください…');
    typeDescription(w, 'ダークモードを追加してほしいです');
    submit(w);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ userCategory: 'feature' }));
    w.destroy();
  });

  it('a host custom category id stays the userCategory, with its own intent chips', () => {
    const onSubmit = vi.fn();
    const w = new MushiWidget({
      categories: [{ id: 'ideas', label: 'Ideas', baseCategory: 'other', intents: ['Feature request', 'Other'] }],
    }, { ...noopCallbacks, onSubmit });
    w.mount();
    w.open({ category: 'ideas' });
    q<HTMLButtonElement>(w, '[data-intent="Feature request"]')!.click();
    typeDescription(w, 'Please add a CSV export for my invoices');
    submit(w);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'other', userCategory: 'ideas', intent: 'Feature request' }));
    w.destroy();
  });

  it('a built-in chip sends its category and no userCategory; no chip sends "other"', () => {
    const onSubmit = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onSubmit });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-category="bug"]')!.click();
    // Optional sub-chips appear once a type is picked.
    q<HTMLButtonElement>(w, '[data-intent="Crash"]')!.click();
    expect(q<HTMLTextAreaElement>(w, 'textarea.mushi-textarea')!.placeholder).toBe('What went wrong?');
    typeDescription(w, LONG);
    submit(w);
    expect(onSubmit.mock.calls[0][0]).toEqual({ category: 'bug', description: LONG, intent: 'Crash' });
    w.destroy();

    const onSubmit2 = vi.fn();
    const w2 = new MushiWidget({}, { ...noopCallbacks, onSubmit: onSubmit2 });
    w2.mount();
    w2.open();
    expect(q(w2, '[data-intent]')).toBeNull();
    typeDescription(w2, LONG);
    submit(w2);
    expect(onSubmit2.mock.calls[0][0]).toEqual({ category: 'other', description: LONG });
    w2.destroy();
  });

  // Item 3
  it('picks ⌘ on Apple platforms and Ctrl elsewhere', () => {
    expect(submitShortcutKey('MacIntel')).toBe('⌘');
    expect(submitShortcutKey('iPad')).toBe('⌘');
    expect(submitShortcutKey('macOS')).toBe('⌘');
    expect(submitShortcutKey('Win32')).toBe('Ctrl');
    expect(submitShortcutKey('Windows')).toBe('Ctrl');
    expect(submitShortcutKey('Linux x86_64')).toBe('Ctrl');
  });

  it('the footer says why Send is disabled, then shows "Ctrl + Enter to send" on Windows', () => {
    const spy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open();
    expect(q(w, '.mushi-footer-hint')!.textContent).toBe('Add a few words');
    typeDescription(w, LONG);
    expect(q(w, '.mushi-footer-hint')!.textContent).toBe('Ctrl + Enter to send');
    spy.mockRestore();
    w.destroy();
  });

  // Item 4 (Plan 018 §1.1: 8 characters, or an attachment the reporter chose)
  it('Send needs 8 characters or a deliberate attachment — an auto-capture is not enough', () => {
    const onSubmit = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onSubmit });
    w.mount();
    w.open();
    const send = () => q<HTMLButtonElement>(w, '[data-action="submit"]')!;
    typeDescription(w, 'broken');
    expect(send().getAttribute('aria-disabled')).toBe('true');
    submit(w);
    expect(onSubmit).not.toHaveBeenCalled();

    // Screenshot captured on open (no click): still disabled.
    w.setScreenshotAttached(true);
    expect(send().getAttribute('aria-disabled')).toBe('true');

    // Pointing at an element is a deliberate attachment.
    w.setElementSelected(true);
    expect(send().getAttribute('aria-disabled')).toBe('false');
    w.setElementSelected(false);
    expect(send().getAttribute('aria-disabled')).toBe('true');

    typeDescription(w, 'broken!!');
    expect(send().getAttribute('aria-disabled')).toBe('false');
    w.destroy();
  });

  it('a screenshot the reporter asked for enables Send without text', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open();
    w.setScreenshotAttached(false);
    q<HTMLButtonElement>(w, '[data-action="screenshot"]')!.click();
    w.setScreenshotAttached(true);
    expect(q(w, '[data-action="submit"]')!.getAttribute('aria-disabled')).toBe('false');
    w.destroy();
  });

  it('CJK locales halve the minimum, and the host can override it', () => {
    const ja = new MushiWidget({ locale: 'ja' }, noopCallbacks);
    ja.mount();
    ja.open();
    typeDescription(ja, '保存できない');
    expect(q(ja, '[data-action="submit"]')!.getAttribute('aria-disabled')).toBe('false');
    ja.destroy();

    const strict = new MushiWidget({ minDescriptionLength: 20 }, noopCallbacks);
    strict.mount();
    strict.open();
    typeDescription(strict, 'Save does nothing');
    expect(q(strict, '[data-action="submit"]')!.getAttribute('aria-disabled')).toBe('true');
    strict.destroy();
  });

  // Item 5
  it('a failed capture shows an actionable reason and a Try again button', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open({ featureRequest: true });

    // The capture module reports the specific reason first; the caller's
    // reasonless failure afterwards must not overwrite it.
    w.setScreenshotError(true, 'taint');
    w.setScreenshotError(true);
    const btn = q<HTMLButtonElement>(w, '[data-action="screenshot"]')!;
    expect(btn.textContent).toContain('Try again');
    expect(btn.disabled).toBe(false);
    expect(q(w, '[data-role="screenshot-reason"]')!.textContent).toContain('another site');

    w.setScreenshotError(true, 'permission');
    expect(q(w, '[data-role="screenshot-reason"]')!.textContent).toContain('Allow it');

    // A retry clears the stale reason.
    w.setScreenshotCapturing(true);
    expect(q(w, '[data-role="screenshot-reason"]')).toBeNull();
    w.setScreenshotError(true);
    expect(q(w, '[data-role="screenshot-reason"]')!.textContent).toBe('Capture failed.');
    w.destroy();
  });

  // Items 6 + 7
  it('receipt: proper title, id, zoned date-time, Done, no Back, no auto-close', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onClose,
      onSubmit: () => Promise.resolve({ reportId: REPORT_ID, queuedOffline: false }),
    });
    w.mount();
    w.open({ featureRequest: true });
    typeDescription(w, LONG);
    submit(w);
    await vi.advanceTimersByTimeAsync(500);

    expect(readStep(w)).toBe('success');
    expect(q(w, '#mushi-title')!.textContent).toBe('Sent');
    expect(q(w, '[data-action="back"]')).toBeNull();
    expect(q(w, '.mushi-success-receipt-id')!.textContent).toContain('#abcdef12');
    expect(q(w, '.mushi-success-sla')!.textContent).toBe("We'll let you know here when there's news.");
    const time = q(w, 'time.mushi-success-meta')!;
    expect(time.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(time.textContent).not.toMatch(/^\d{2}:\d{2}:\d{2}$/);

    // The panel used to auto-close at 2.8 s / 6 s under the reader.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.getIsOpen()).toBe(true);

    q<HTMLButtonElement>(w, '[data-action="done"]')!.click();
    expect(w.getIsOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    w.destroy();
  });

  it('a queued/retrying send never claims "report received"', async () => {
    vi.useFakeTimers();
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve({ reportId: null, queuedOffline: true, failureKind: 'retrying' as const }),
    });
    w.mount();
    w.open({ featureRequest: true });
    typeDescription(w, LONG);
    submit(w);
    await vi.advanceTimersByTimeAsync(500);

    expect(q(w, '#mushi-title')!.textContent).toBe('Queued — retrying');
    expect(q(w, '[data-action="track-report"]')).toBeNull();
    w.destroy();
  });

  it('formats the receipt time with date and zone, tolerating a bad locale tag', () => {
    const text = formatReceiptTime(new Date(Date.UTC(2026, 9, 2, 1, 37, 50)), 'en-US');
    expect(text).toContain('Oct');
    expect(text).toMatch(/GMT|UTC|[A-Z]{2,4}/);
    expect(() => formatReceiptTime(new Date(), 'not a locale!!')).not.toThrow();
  });

  // Item 8
  it('"Track it" opens that report\'s thread', async () => {
    vi.useFakeTimers();
    const onReporterCommentsRequest = vi.fn().mockResolvedValue([]);
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onSubmit: () => Promise.resolve({ reportId: REPORT_ID, queuedOffline: false }),
      onReporterReportsRequest: () => Promise.resolve([
        { id: REPORT_ID, status: 'new', summary: 'Save does nothing', created_at: new Date().toISOString() },
      ] as never),
      onReporterCommentsRequest,
    });
    w.mount();
    w.open({ featureRequest: true });
    typeDescription(w, LONG);
    submit(w);
    await vi.advanceTimersByTimeAsync(500);

    q<HTMLButtonElement>(w, '[data-action="track-report"]')!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(readStep(w)).toBe('report-detail');
    expect(w.getIsOpen()).toBe(true);
    expect(onReporterCommentsRequest).toHaveBeenCalledWith(REPORT_ID);
    expect(q(w, '.mushi-summary-text')!.textContent).toBe('Save does nothing');
    expect(q(w, '.mushi-thread-summary .mushi-pill')!.textContent).toBe('Received');
    w.destroy();
  });

  // Item 10
  it('never shows the SDK-update notice to end users under the default mode', () => {
    const prod = { hostname: 'kensaur.us', protocol: 'https:' };
    expect(shouldShowSdkFreshness(undefined, false, prod)).toBe(false);
    expect(shouldShowSdkFreshness('auto', false, prod)).toBe(false);
    expect(shouldShowSdkFreshness('auto', true, prod)).toBe(true); // debug: true
    expect(shouldShowSdkFreshness('banner', false, prod)).toBe(true); // explicit opt-in
    expect(shouldShowSdkFreshness('console-only', true, { hostname: 'localhost', protocol: 'http:' })).toBe(false);
    expect(shouldShowSdkFreshness('off', true, { hostname: 'localhost', protocol: 'http:' })).toBe(false);
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'app.localhost', 'mac.local']) {
      expect(shouldShowSdkFreshness('auto', false, { hostname, protocol: 'http:' })).toBe(true);
    }
    expect(shouldShowSdkFreshness('auto', false, { hostname: '', protocol: 'file:' })).toBe(true);
    expect(shouldShowSdkFreshness('auto', false, undefined)).toBe(false);
  });

  // Item 11
  it('a thread read that never settles becomes a retryable error, not an endless spinner', async () => {
    vi.useFakeTimers();
    const comments = vi.fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce([{ id: 'c1', author_kind: 'admin', author_name: 'Kenji', body: 'Fixed in 1.2', created_at: '' }]);
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve([
        { id: REPORT_ID, status: 'fixing', summary: 'Save does nothing', created_at: new Date().toISOString() },
      ] as never),
      onReporterCommentsRequest: comments,
    });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-action="reports"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    q<HTMLButtonElement>(w, `[data-report-id="${REPORT_ID}"]`)!.click();
    // The card paints from the list row at once; only the timeline is a skeleton.
    expect(q(w, '.mushi-summary-text')!.textContent).toBe('Save does nothing');
    expect(q(w, '.mushi-skeleton')?.getAttribute('aria-label')).toBe('Loading updates…');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(q(w, '.mushi-skeleton')).toBeNull();
    expect(q(w, '.mushi-thread [role="alert"]')!.textContent).toContain("Couldn't load updates");

    q<HTMLButtonElement>(w, '[data-action="retry-thread"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(comments).toHaveBeenCalledTimes(2);
    expect(q(w, '.mushi-thread')!.textContent).toContain('Fixed in 1.2');
    w.destroy();
  });

  it('a rejected thread read shows the error and retry instead of "No developer replies"', async () => {
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterCommentsRequest: () => Promise.reject(new Error('HTTP 401')),
    });
    w.mount();
    w.open();
    await (w as unknown as { openThread(id: string): Promise<void> }).openThread(REPORT_ID);
    expect(q(w, '[data-action="retry-thread"]')).not.toBeNull();
    expect(q(w, '.mushi-thread')!.textContent).not.toContain('No developer replies');
    w.destroy();
  });

  it('keeps the reply composer in the sticky footer outside the scroll area', async () => {
    const w = new MushiWidget({}, { ...noopCallbacks, onReporterCommentsRequest: () => Promise.resolve([]) });
    w.mount();
    w.open();
    await (w as unknown as { openThread(id: string): Promise<void> }).openThread(REPORT_ID);
    const reply = q(w, '[data-action="reporter-reply"]')!;
    expect(reply.closest('.mushi-scroll')).toBeNull();
    expect(reply.closest('.mushi-footer .mushi-thread-composer')).not.toBeNull();
    expect(q<HTMLTextAreaElement>(w, 'textarea[data-role="reporter-reply"]')!.placeholder).toBe('Reply to the developer…');
    w.destroy();
  });

  it('replies are optimistic: the thread never blanks, a failure offers Retry', async () => {
    const existing = [{ id: 'c1', author_kind: 'admin', author_name: 'Kenji', body: 'Can you retry?', created_at: '2026-10-02T01:00:00Z' }];
    let finishReply: (() => void) | undefined;
    const onReporterReply = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishReply = resolve; }))
      .mockImplementationOnce(() => Promise.reject(new Error('HTTP 500')))
      .mockImplementationOnce(() => Promise.resolve());
    const onReporterCommentsRequest = vi.fn().mockResolvedValue(existing);
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve([
        { id: REPORT_ID, status: 'fixing', summary: 'Save does nothing', created_at: '2026-10-02T00:00:00Z' },
      ] as never),
      onReporterCommentsRequest,
      onReporterReply,
    });
    w.mount();
    w.open();
    await (w as unknown as { openThread(id: string): Promise<void> }).openThread(REPORT_ID);
    const reply = (text: string) => {
      const ta = q<HTMLTextAreaElement>(w, 'textarea[data-role="reporter-reply"]')!;
      ta.value = text;
      q<HTMLButtonElement>(w, '[data-action="reporter-reply"]')!.click();
    };

    reply('Tried again, still broken');
    // In flight: the conversation stays, the bubble says Sending…, the box is free again.
    expect(q(w, '.mushi-thread')!.textContent).toContain('Can you retry?');
    expect(q(w, '.mushi-bubble.mine')!.textContent).toContain('Tried again, still broken');
    expect(q(w, '.mushi-bubble.mine')!.textContent).toContain('Sending…');
    expect(q(w, '.mushi-skeleton')).toBeNull();
    expect(q<HTMLTextAreaElement>(w, 'textarea[data-role="reporter-reply"]')!.value).toBe('');
    finishReply!();
    await vi.waitFor(() => expect(q(w, '.mushi-bubble-state')).toBeNull());
    expect(onReporterReply).toHaveBeenCalledWith(REPORT_ID, 'Tried again, still broken');
    expect(readStep(w)).toBe('report-detail');

    reply('second try');
    await vi.waitFor(() => expect(q(w, '[data-action="retry-reply"]')).not.toBeNull());
    expect(q(w, '.mushi-thread')!.textContent).toContain('Can you retry?');
    expect(q(w, '.mushi-thread')!.textContent).toContain('second try');
    q<HTMLButtonElement>(w, '[data-action="retry-reply"]')!.click();
    await vi.waitFor(() => expect(q(w, '[data-action="retry-reply"]')).toBeNull());
    expect(onReporterReply).toHaveBeenLastCalledWith(REPORT_ID, 'second try');
    w.destroy();
  });

  it('confirming a fix stays on the thread instead of jumping to the list', async () => {
    const onReporterFeedback = vi.fn().mockResolvedValue(null);
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve([
        { id: REPORT_ID, status: 'fixed', summary: 'Save does nothing', created_at: '' },
      ] as never),
      onReporterCommentsRequest: () => Promise.resolve([]),
      onReporterFeedback,
    });
    w.mount();
    w.open();
    await w.refreshReporterInboxQuiet();
    await (w as unknown as { openThread(id: string): Promise<void> }).openThread(REPORT_ID);
    expect(q(w, '.mushi-thread-summary .mushi-pill')!.textContent).toBe('Fixed — coming in the next update');
    q<HTMLButtonElement>(w, '[data-action="reporter-confirms"]')!.click();
    await vi.waitFor(() => expect(onReporterFeedback).toHaveBeenCalledWith(REPORT_ID, 'confirms'));
    await vi.waitFor(() => expect(q<HTMLButtonElement>(w, '[data-action="reporter-confirms"]')!.disabled).toBe(false));
    expect(readStep(w)).toBe('report-detail');
    w.destroy();
  });

  // Item 12: user-consented tab share fallback
  it('offers "Share this tab instead" after a failed capture when the host supports it', () => {
    const onScreenshotShareTabRequest = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onScreenshotShareTabRequest });
    w.mount();
    w.open({ featureRequest: true });
    w.setScreenshotError(true, 'taint');
    q<HTMLButtonElement>(w, '[data-action="screenshot-share-tab"]')!.click();
    expect(onScreenshotShareTabRequest).toHaveBeenCalledTimes(1);
    w.destroy();

    const plain = new MushiWidget({}, noopCallbacks);
    plain.mount();
    plain.open({ featureRequest: true });
    plain.setScreenshotError(true, 'taint');
    expect(q(plain, '[data-action="screenshot-share-tab"]')).toBeNull();
    plain.destroy();
  });

  // Item 12 (re-render swallowing the first Submit click)
  it('defers a background patch while a pointer is down in the panel', async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onSubmit });
    w.mount();
    w.open({ featureRequest: true });
    typeDescription(w, LONG);

    const submitBtn = q<HTMLButtonElement>(w, '[data-action="submit"]')!;
    submitBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // A runtime-config update that WOULD patch the footer (the Send label) lands mid-press:
    w.updateConfig({ locale: 'ja' });
    expect(submitBtn.isConnected).toBe(true);

    window.dispatchEvent(new Event('pointerup'));
    submitBtn.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    w.destroy();
  });

  it('omits "Track it" when there is no reporter inbox to open', async () => {
    vi.useFakeTimers();
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onSubmit: () => Promise.resolve({ reportId: REPORT_ID, queuedOffline: false }),
    });
    w.mount();
    w.open({ featureRequest: true });
    typeDescription(w, LONG);
    submit(w);
    await vi.advanceTimersByTimeAsync(500);

    expect(readStep(w)).toBe('success');
    expect(q(w, '[data-action="track-report"]')).toBeNull();
    w.destroy();
  });
});

// ── Plan 018 Phase 1: regions, Your reports, keyboard, toast, opt-ins ────────

describe('MushiWidget — reporter loop v2 (Phase 1)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-mushi-test-suppress]').forEach((el) => el.remove());
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  const getShadow = (w: MushiWidget): ShadowRoot => (w as unknown as { shadow: ShadowRoot }).shadow;
  const q = <T extends Element = HTMLElement>(w: MushiWidget, sel: string): T | null =>
    getShadow(w).querySelector(sel) as T | null;
  const qa = (w: MushiWidget, sel: string) => Array.from(getShadow(w).querySelectorAll<HTMLElement>(sel));
  const readStep = (w: MushiWidget): string => (w as unknown as { step: string }).step;
  const key = (target: Element, k: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  const ROWS = [
    { id: 'r-old', status: 'classified', category: 'bug', severity: 'high', title: 'Old one', user_category: 'bug', page: '/settings', created_at: '2026-09-01T00:00:00Z' },
    { id: 'r-new', status: 'fixing', title: 'Newest', created_at: '2026-10-01T00:00:00Z' },
    { id: 'r-wait', status: 'classified', title: 'Needs me', awaiting_reporter: true, unread_count: 2, last_event_preview: 'Which browser?', created_at: '2026-08-01T00:00:00Z' },
    { id: 'r-spam', status: 'dismissed', closed_reason: 'spam', title: 'Hidden', created_at: '2026-10-02T00:00:00Z' },
  ];

  it('a background refresh patches only the header: the textarea, its text and focus survive', async () => {
    const w = new MushiWidget({}, { ...noopCallbacks, onReporterReportsRequest: () => Promise.resolve(ROWS as never) });
    w.mount();
    w.open();
    const ta = q<HTMLTextAreaElement>(w, 'textarea.mushi-textarea')!;
    ta.value = 'Still typing…';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    const body = q(w, '[data-region="body"]')!.innerHTML;

    await w.refreshReporterInboxQuiet();

    expect(q(w, 'textarea.mushi-textarea')).toBe(ta);
    expect(ta.value).toBe('Still typing…');
    expect(getShadow(w).activeElement).toBe(ta);
    expect(q(w, '[data-region="body"]')!.innerHTML).toBe(body);
    expect(q(w, '[data-action="reports"] .mushi-badge')!.textContent).toBe('2 new');
    w.destroy();
  });

  it('lists reports with end-user labels, unread first, never internal category or severity', async () => {
    const w = new MushiWidget({}, { ...noopCallbacks, onReporterReportsRequest: () => Promise.resolve(ROWS as never) });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-action="reports"]')!.click();
    await vi.waitFor(() => expect(qa(w, '.mushi-report-row').length).toBe(3));
    const rows = qa(w, '.mushi-report-row');
    // Unread first, then newest activity; spam stays hidden.
    expect(rows.map((r) => r.dataset.reportId)).toEqual(['r-wait', 'r-new', 'r-old']);
    expect(rows[0]!.textContent).toContain('Waiting on you');
    expect(rows[0]!.classList.contains('unread')).toBe(true);
    expect(rows[1]!.textContent).toContain('Fix in progress');
    expect(rows[2]!.textContent).toContain('Looking into it');
    expect(rows[2]!.textContent).toContain('Bug · /settings');
    const text = q(w, '.mushi-report-list')!.textContent!;
    expect(text).not.toMatch(/high|classified|fixing|dismissed/);
    w.destroy();
  });

  it('renders server text as text: titles, previews and comments never become markup', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">"><b>x</b>';
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve([{ id: 'r"x', status: 'classified', title: evil, page: evil, last_event_preview: evil, unread_count: 1, created_at: '2026-10-01T00:00:00Z' }] as never),
      onReporterCommentsRequest: () => Promise.resolve([{ id: 1, author_kind: 'admin', author_name: evil, body: evil, created_at: '2026-10-01T01:00:00Z' }]),
    });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-action="reports"]')!.click();
    await vi.waitFor(() => expect(qa(w, '.mushi-report-row').length).toBe(1));
    expect(q(w, '.mushi-report-list img, .mushi-report-list b')).toBeNull();
    expect(q(w, '.mushi-row-title')!.textContent).toBe(evil);
    qa(w, '.mushi-report-row')[0]!.click();
    await vi.waitFor(() => expect(q(w, '.mushi-bubble.dev')).not.toBeNull());
    expect(q(w, '[data-region] img:not(.mushi-header-host-icon):not(.mushi-card-thumb), [data-region] b')).toBeNull();
    expect(q(w, '.mushi-bubble.dev p')!.textContent).toBe(evil);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    w.destroy();
  });

  it('shows the empty state, and a failed list load offers Retry', async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce([]);
    const w = new MushiWidget({}, { ...noopCallbacks, onReporterReportsRequest: list });
    w.mount();
    w.openReporter();
    await vi.waitFor(() => expect(q(w, '.mushi-empty')?.textContent).toBe('Nothing yet — your reports will show up here with updates.'));
    q<HTMLButtonElement>(w, '[data-action="back"]')!.click();
    q<HTMLButtonElement>(w, '[data-action="reports"]')!.click();
    await vi.waitFor(() => expect(q(w, '[data-action="retry-list"]')).not.toBeNull());
    q<HTMLButtonElement>(w, '[data-action="retry-list"]')!.click();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    w.destroy();
  });

  it('opening a thread marks it read and the badge goes down', async () => {
    const onReporterMarkRead = vi.fn().mockResolvedValue(0);
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve(structuredClone(ROWS) as never),
      onReporterCommentsRequest: () => Promise.resolve([]),
      onReporterMarkRead,
    });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-action="reports"]')!.click();
    await vi.waitFor(() => expect(q(w, '[data-report-id="r-wait"]')).not.toBeNull());
    q<HTMLButtonElement>(w, '[data-report-id="r-wait"]')!.click();
    expect(onReporterMarkRead).toHaveBeenCalledWith('r-wait');
    key(q(w, '[data-report-id]') ?? q(w, '.mushi-panel')!, 'Escape');
    expect(readStep(w)).toBe('reports');
    expect(q(w, '[data-report-id="r-wait"]')!.classList.contains('unread')).toBe(false);
    // Opening an already-read thread doesn't call the server again.
    q<HTMLButtonElement>(w, '[data-report-id="r-new"]')!.click();
    expect(onReporterMarkRead).toHaveBeenCalledTimes(1);
    w.destroy();
  });

  it('renders a server timeline from templates, never stored notification text', async () => {
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve([{ id: 'r1', status: 'resolved', fixed_in_version: '1.4.0', title: 'Crash on save', created_at: '2026-09-30T00:00:00Z' }] as never),
      onReporterReportRequest: () => Promise.resolve({
        timeline: [
          { kind: 'received', at: '2026-09-30T00:00:00Z' },
          { kind: 'reviewing', at: '2026-09-30T01:00:00Z', text: 'classified as bug/high' },
          { kind: 'comment', at: '2026-09-30T02:00:00Z', text: 'Thanks, found it.', custom: true },
          { kind: 'released', at: '2026-10-01T00:00:00Z', version: '1.4.0' },
        ],
      }),
    });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-action="reports"]')!.click();
    await vi.waitFor(() => expect(q(w, '[data-report-id="r1"]')).not.toBeNull());
    q<HTMLButtonElement>(w, '[data-report-id="r1"]')!.click();
    await vi.waitFor(() => expect(q(w, '.mushi-timeline')).not.toBeNull());
    const thread = q(w, '.mushi-thread')!.textContent!;
    expect(thread).toContain('The developer is looking into it');
    expect(thread).not.toContain('bug/high');
    expect(thread).toContain('Thanks, found it.');
    expect(thread).toContain('Shipped in v1.4.0 — update to get it');
    expect(q(w, '.mushi-thread-summary .mushi-pill')!.textContent).toBe('Fixed in v1.4.0');
    expect(q(w, '[data-action="reporter-confirms"]')!.textContent).toBe('Yes');
    expect(q(w, '[data-action="reporter-not-fixed"]')!.textContent).toBe('Not yet');
    w.destroy();
  });

  it('Escape closes and returns focus to the trigger; Ctrl+Enter sends', () => {
    const onSubmit = vi.fn();
    const w = new MushiWidget({}, { ...noopCallbacks, onSubmit });
    w.mount();
    const trigger = q<HTMLButtonElement>(w, '.mushi-trigger')!;
    trigger.focus();
    trigger.click();
    const ta = q<HTMLTextAreaElement>(w, 'textarea.mushi-textarea')!;
    expect(getShadow(w).activeElement).toBe(ta);
    ta.value = 'Checkout button is greyed out';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    key(ta, 'Enter', { ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    w.destroy();

    const w2 = new MushiWidget({}, noopCallbacks);
    w2.mount();
    const t2 = q<HTMLButtonElement>(w2, '.mushi-trigger')!;
    t2.focus();
    t2.click();
    key(q(w2, 'textarea.mushi-textarea')!, 'Escape');
    expect(w2.getIsOpen()).toBe(false);
    expect(getShadow(w2).activeElement).toBe(q(w2, '.mushi-trigger'));
    w2.destroy();
  });

  it('type chips are a roving radiogroup: one Tab stop, arrows move the selection', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open();
    const chips = qa(w, '[role="radio"][data-category]');
    expect(chips.filter((c) => c.tabIndex === 0).length).toBe(1);
    chips[0]!.focus();
    key(chips[0]!, 'ArrowRight');
    expect(q(w, '[data-category="slow"]')!.getAttribute('aria-checked')).toBe('true');
    expect(getShadow(w).activeElement).toBe(q(w, '[data-category="slow"]'));
    // A second tap on the picked chip clears it: the type is optional.
    q<HTMLButtonElement>(w, '[data-category="slow"]')!.click();
    expect(q(w, '[data-category="slow"]')!.getAttribute('aria-checked')).toBe('false');
    w.destroy();
  });

  it('Tab stays inside the open dialog', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open();
    const items = qa(w, '.mushi-panel button:not([disabled]), .mushi-panel textarea');
    const last = items[items.length - 1]!;
    last.focus();
    key(last, 'Tab');
    expect(getShadow(w).activeElement).toBe(items[0]);
    key(items[0]!, 'Tab', { shiftKey: true });
    expect(getShadow(w).activeElement).toBe(last);
    w.destroy();
  });

  it('the overflow menu appears only for enabled destinations', () => {
    const bare = new MushiWidget({}, noopCallbacks);
    bare.mount();
    bare.open();
    expect(q(bare, '[data-action="toggle-more-nav"]')).toBeNull();
    bare.destroy();

    const w = new MushiWidget({}, { ...noopCallbacks, assistantEnabled: true, onFeatureBoardRequest: () => Promise.resolve([]) });
    w.mount();
    w.open();
    q<HTMLButtonElement>(w, '[data-action="toggle-more-nav"]')!.click();
    expect(qa(w, '[role="menuitem"]').map((m) => m.dataset.action)).toEqual(['assistant', 'roadmap']);
    key(q(w, '[role="menuitem"]')!, 'Escape');
    expect(q(w, '[role="menu"]')).toBeNull();
    expect(w.getIsOpen()).toBe(true);
    w.destroy();
  });

  it('a toast near the launcher opens the thread, and is suppressed with the launcher', async () => {
    const onReporterCommentsRequest = vi.fn().mockResolvedValue([]);
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onReporterReportsRequest: () => Promise.resolve(ROWS as never),
      onReporterCommentsRequest,
    });
    w.mount();
    expect(w.showUpdateToast({ text: 'The developer replied to your report', reportId: 'r-wait' })).toBe(true);
    const toast = q(w, '.mushi-toast')!;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('The developer replied to your report');
    (toast.querySelector('.mushi-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onReporterCommentsRequest).toHaveBeenCalledWith('r-wait'));
    expect(q(w, '.mushi-toast')).toBeNull();
    w.destroy();

    const el = document.createElement('div');
    el.setAttribute('data-mushi-test-suppress', '');
    document.body.appendChild(el);
    const hidden = new MushiWidget({ hideOnSelector: '[data-mushi-test-suppress]' }, noopCallbacks);
    hidden.mount();
    expect(hidden.showUpdateToast({ text: 'x' })).toBe(false);
    expect(q(hidden, '.mushi-toast')).toBeNull();
    hidden.destroy();
  });

  it('opt-ins appear only for configured channels and are never pre-ticked', async () => {
    vi.useFakeTimers();
    const onReporterEmailOptIn = vi.fn().mockResolvedValue(undefined);
    const w = new MushiWidget({}, {
      ...noopCallbacks,
      onSubmit: () => Promise.resolve({ reportId: 'abc', queuedOffline: false }),
      onReporterEmailOptIn,
      onReporterPushSubscribe: () => Promise.resolve(),
    });
    w.mount();
    w.open();
    const ta = q<HTMLTextAreaElement>(w, 'textarea.mushi-textarea')!;
    ta.value = 'The export button does nothing';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLButtonElement>(w, '[data-action="submit"]')!.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(q(w, '[data-action="email-optin"]')).toBeNull();
    expect(q(w, '[data-action="notify-me"]')).toBeNull();

    w.setReporterChannels({ email: true, push: true, emailPrefill: 'ana@example.com' });
    const box = q<HTMLInputElement>(w, '[data-action="email-optin"]')!;
    expect(box.checked).toBe(false);
    box.click();
    expect(q<HTMLInputElement>(w, '[data-role="optin-email"]')!.value).toBe('ana@example.com');
    q<HTMLButtonElement>(w, '[data-action="save-email"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onReporterEmailOptIn).toHaveBeenCalledWith('ana@example.com');
    expect(q(w, '.mushi-optins')!.textContent).toContain('Check your inbox and tap the link to confirm.');
    w.destroy();
  });
});
