import { describe, expect, it } from 'vitest';
import {
  MUSHI_COLORS_LIGHT,
  MUSHI_COLORS_DARK,
  MUSHI_GEOMETRY,
  MUSHI_Z,
} from '@mushi-mushi/core';
import { getWidgetStyles } from './styles';
import { contrastingInk, safeCssColor } from './build-widget-theme';

/** A declaration (not a read) of a public theming token. */
const DECLARES_PUBLIC_TOKEN = /[{;]\s*--mushi-(bg|fg|muted|surface|border|accent|accent-fg|font|font-size|success|error|radius|shadow)\s*:/;

describe('getWidgetStyles', () => {
  it('defaults the panel to the host font and system colours (light)', () => {
    const css = getWidgetStyles('light');
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('var(--mushi-font, inherit)');
    expect(css).toContain('var(--mushi-bg, Canvas)');
    expect(css).toContain('var(--mushi-fg, CanvasText)');
    // No configured accent: the accent is the ink, its text the paper.
    expect(css).toContain('var(--mushi-accent, var(--_fg))');
    expect(css).toContain('var(--mushi-accent-fg, var(--_bg))');
    // The brand palette still colours the `brand` banner variant.
    expect(css).toContain(MUSHI_COLORS_LIGHT.accent);
    expect(css).toContain(String(MUSHI_GEOMETRY.fabSize));
    expect(css).toContain(String(MUSHI_GEOMETRY.panelWidth));
    expect(css).toContain(String(MUSHI_Z.banner));
  });

  it('follows the dark scheme', () => {
    const css = getWidgetStyles('dark');
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain(MUSHI_COLORS_DARK.accent);
  });

  it('only reads public --mushi-* tokens, so host CSS on :root or the host element wins', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(getWidgetStyles(theme, '#112233')).not.toMatch(DECLARES_PUBLIC_TOKEN);
    }
  });

  it('honours a safe custom accent and picks readable text for it', () => {
    const css = getWidgetStyles('light', '#112233', 'white');
    expect(css).toContain('var(--mushi-accent, #112233)');
    expect(css).toContain('var(--mushi-accent-fg, white)');
    expect(getWidgetStyles('light', 'rgb(10 20 30)')).toContain('var(--mushi-accent, rgb(10 20 30))');
  });

  it('rejects unsafe accent values from config or the host page', () => {
    for (const bad of ['javascript:alert(1)', 'red;} body{display:none', 'url(x)"', '</style><script>']) {
      const css = getWidgetStyles('light', bad, bad);
      expect(css).toContain('var(--mushi-accent, var(--_fg))');
      expect(css).not.toContain('javascript');
      expect(css).not.toContain('<script');
      expect(css).not.toContain('display:none');
      expect(safeCssColor(bad)).toBe('');
    }
  });

  it('measures contrast for the page-accent guard', () => {
    expect(contrastingInk([255, 255, 255], [255, 255, 255]).ratio).toBeCloseTo(1, 5);
    expect(contrastingInk([0, 0, 0], [255, 255, 255]).ratio).toBeCloseTo(21, 0);
    expect(contrastingInk([17, 34, 51]).ink).toBe('white');
    expect(contrastingInk([250, 220, 120]).ink).toBe('black');
  });

  it('matches stable CSS snapshot markers', () => {
    const css = getWidgetStyles('light');
    expect(css).toMatchSnapshot();
  });
});
