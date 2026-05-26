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
