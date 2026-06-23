import { describe, expect, it } from 'vitest';
import {
  MUSHI_COLORS_LIGHT,
  MUSHI_GEOMETRY,
  resolveWidgetAccent,
  safeWidgetHex,
  mushiPalette,
} from './design-tokens';

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
