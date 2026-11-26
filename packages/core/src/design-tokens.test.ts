import { describe, expect, it } from 'vitest';
import {
  MUSHI_COLORS_LIGHT,
  MUSHI_DURATION,
  MUSHI_GEOMETRY,
  MUSHI_MOTION,
  MUSHI_REPORT_TYPE_COLORS,
  MUSHI_REPORT_TYPE_WASH,
  mushiTokens,
  resolveWidgetAccent,
  safeWidgetHex,
  mushiPalette,
} from './design-tokens';

type Rgb = [number, number, number];
const fromHex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const over = ({ rgb, a }: { rgb: Rgb; a: number }, bg: Rgb): Rgb => rgb.map((c, i) => c * a + bg[i]! * (1 - a)) as Rgb;
const lum = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (x: Rgb, y: Rgb) => {
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (a! + 0.05) / (b! + 0.05);
};

describe('MUSHI_REPORT_TYPE_COLORS (WCAG AA in both modes)', () => {
  // The panel defaults to system Canvas: white in light mode, #121212 in Chrome's dark mode.
  const canvas: Record<'light' | 'dark', Rgb> = { light: [255, 255, 255], dark: [18, 18, 18] };
  for (const mode of ['light', 'dark'] as const) {
    for (const [id, tone] of Object.entries(MUSHI_REPORT_TYPE_COLORS[mode])) {
      it(`${mode} ${id}: border ≥ 3:1 on the panel, ink ≥ 4.5:1 on both washes`, () => {
        const bg = canvas[mode];
        expect(contrast(fromHex(tone.solid), bg)).toBeGreaterThanOrEqual(3);
        const { wash, strong } = MUSHI_REPORT_TYPE_WASH[mode];
        for (const a of [wash, strong]) {
          expect(contrast(fromHex(tone.ink), over({ rgb: fromHex(tone.solid), a }, bg))).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it('gives every type a distinct hue', () => {
    for (const mode of ['light', 'dark'] as const) {
      const solids = Object.values(MUSHI_REPORT_TYPE_COLORS[mode]).map((t) => t.solid);
      expect(new Set(solids).size).toBe(solids.length);
    }
  });
});

describe('safeWidgetHex', () => {
  it('accepts valid hex colours', () => {
    expect(safeWidgetHex('#E03C2C')).toBe('#E03C2C');
    expect(safeWidgetHex('#abc')).toBe('#abc');
  });

  it('rejects injection attempts', () => {
    expect(safeWidgetHex('red')).toBe('');
    expect(safeWidgetHex('#E03C2C; background: url(evil)')).toBe('');
  });
});

describe('resolveWidgetAccent', () => {
  it('falls back to palette accent when override absent', () => {
    const resolved = resolveWidgetAccent('light');
    expect(resolved.accent).toBe(MUSHI_COLORS_LIGHT.accent);
    expect(resolved.accentWash).toBe(MUSHI_COLORS_LIGHT.accentWash);
    expect(resolved.accentInk).toBe(MUSHI_COLORS_LIGHT.accentInk);
  });

  it('honours safe custom accent hex', () => {
    const resolved = resolveWidgetAccent('light', '#112233');
    expect(resolved.accent).toBe('#112233');
    expect(resolved.accentWash).toBe('#11223314');
  });
});

describe('MUSHI_GEOMETRY', () => {
  it('matches shipped web widget dimensions', () => {
    expect(MUSHI_GEOMETRY.panelWidth).toBe(360);
    expect(MUSHI_GEOMETRY.fabSize).toBe(52);
    expect(MUSHI_GEOMETRY.bannerHeight).toBe(36);
  });
});

describe('mushiPalette', () => {
  it('returns light paper token used by web styles', () => {
    expect(mushiPalette('light').paper).toBe('#F8F4ED');
  });
});

describe('MUSHI_DURATION / mushiTokens', () => {
  it('exposes the full duration vocabulary', () => {
    expect(MUSHI_DURATION).toEqual({
      instant: 120,
      fast: 200,
      base: 220,
      panel: 300,
      slow: 420,
      ring: 700,
    });
    expect(MUSHI_MOTION.easeStamp).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('includes duration on the token snapshot', () => {
    const snap = mushiTokens('light');
    expect(snap.duration).toBe(MUSHI_DURATION);
    expect(snap.motion).toBe(MUSHI_MOTION);
  });
});
