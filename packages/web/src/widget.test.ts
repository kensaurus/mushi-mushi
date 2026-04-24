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

import { describe, it, expect } from 'vitest';
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
