/**
 * Release-banner version label must clear WCAG AA on Nextra's bar.
 *
 * `.docs-banner-eyebrow` used `--mushi-vermillion-ink` (#7a1f15). Nextra's
 * `<Banner>` paints `.nextra-banner` with `bg-neutral-900` (oklch 20.5% 0,
 * #171717) and `text-slate-50`, and in `.dark` white text over
 * #212121–#383838. That ink is 1.74:1 on the bar. The label inherits the
 * banner's own text colour instead. The `.dark` override is gone so a
 * theme-only mix cannot put a dark red back on the same bar.
 *
 * Colour maths lives in this file, so a move of the server edge-function
 * colour module leaves this test alone.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Rgba = { r: number; g: number; b: number; a: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`. */
function parseHex(input: string): Rgba | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

const linearToSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const srgbToLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * Hex, or space-separated `oklch(L C H)` (percent L, unitless C and H).
 * Those are the only literals this test reads from brand CSS and Nextra.
 */
function parseCssColor(input: string): Rgba | null {
  const s = input.trim();
  if (s.startsWith('#')) return parseHex(s);
  const fn = /^oklch\(\s*([^()]+)\)$/i.exec(s);
  if (!fn) return null;
  const parts = fn[1].trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const channel = (token: string, scale: number): number | null => {
    const pct = /^(-?[\d.]+)%$/.exec(token);
    if (pct) return (Number(pct[1]) / 100) * scale;
    const v = Number(token);
    return Number.isFinite(v) ? v : null;
  };
  const L = channel(parts[0], 1);
  const C = channel(parts[1], 0.4);
  const H = channel(parts[2], 360);
  if (L == null || C == null || H == null) return null;
  const rad = (H * Math.PI) / 180;
  const [r, g, b] = oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: 1 };
}

function relativeLuminance(c: Rgba): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** WCAG 2.x contrast, 1..21. Opaque colours only; rounded to 2 decimals. */
function contrastRatio(fg: Rgba, bg: Rgba): number {
  const ratio =
    (Math.max(relativeLuminance(fg), relativeLuminance(bg)) + 0.05) /
    (Math.min(relativeLuminance(fg), relativeLuminance(bg)) + 0.05);
  return Math.round(ratio * 100) / 100;
}

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
const brand = readFileSync(join(here, '../../../packages/brand/src/editorial.css'), 'utf8');

const requireFromDocs = createRequire(join(here, '../package.json'));
const nextraRoot = dirname(requireFromDocs.resolve('nextra/package.json'));
const banner = readFileSync(join(nextraRoot, 'dist/client/components/banner/index.js'), 'utf8');
const nextraCss = readFileSync(requireFromDocs.resolve('nextra-theme-docs/style.css'), 'utf8');

function ruleBody(source: string, selector: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return lines.slice(start + 1, i).join('\n');
      }
    }
  }
  throw new Error(`unclosed ${selector}`);
}

function decl(block: string, prop: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*${prop}\\s*:\\s*([^;]+);`).exec(`\n${block}`);
  if (!match) throw new Error(`missing ${prop}`);
  return match[1].trim();
}

function color(input: string): Rgba {
  const parsed = parseCssColor(input);
  if (!parsed) throw new Error(`unparsed colour: ${input}`);
  return parsed;
}

describe('docs banner eyebrow contrast', () => {
  const eyebrow = ruleBody(css, '.docs-banner-eyebrow');
  const root = ruleBody(brand, ':root');
  const neutral900 = color(decl(nextraCss, '--x-color-neutral-900'));
  const slate50 = color(decl(nextraCss, '--x-color-slate-50'));
  const white = color(decl(nextraCss, '--x-color-white'));
  const vermillionInk = color(decl(root, '--mushi-vermillion-ink'));
  const darkEnd = color('#212121');
  const lightEnd = color('#383838');

  it('inherits the banner text colour instead of vermillion ink', () => {
    expect(decl(eyebrow, 'color')).toBe('inherit');
    expect(eyebrow).not.toContain('--mushi-vermillion');
    expect(css.split('\n').some((line) => line.trim() === '.dark .docs-banner-eyebrow {')).toBe(
      false,
    );
  });

  it('paints the banner with neutral-900 and slate-50, in any class order', () => {
    expect(banner).toContain('bg-neutral-900');
    expect(banner).toContain('text-slate-50');
  });

  it('clears WCAG AA for the text the label inherits, on every bar colour', () => {
    for (const background of [neutral900, darkEnd, lightEnd]) {
      expect(contrastRatio(slate50, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(white, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rejects vermillion ink on the neutral-900 bar the report measured', () => {
    expect(contrastRatio(neutral900, color('#171717'))).toBe(1);
    expect(contrastRatio(vermillionInk, color('#171717'))).toBeCloseTo(1.74, 2);
    expect(contrastRatio(vermillionInk, neutral900)).toBeLessThan(4.5);
  });

  it('accepts the measured ink ratio without two-decimal rounding', () => {
    // #7a1f15 on #171717 is 1.7367… before rounding. Closeness to that value
    // still passes when the helper returns 1.74, and when it returns the raw ratio.
    expect(contrastRatio(vermillionInk, color('#171717'))).toBeCloseTo(1.7367281193892272, 2);
  });

  it('keeps colour maths in this file', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const serverColor = [
      'packages',
      'server',
      'supabase',
      'functions',
      '_shared',
      'design-color',
    ].join('/');
    expect(source).not.toContain(serverColor);
  });

  it('does not pin one exact Nextra banner class string', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const exactClasses = ['x:text-slate-50', 'x:dark:text-white', 'x:bg-neutral-900'].join(' ');
    expect(source).not.toContain(exactClasses);
  });

  it('compares the measured ink ratio with closeness, not exact equality', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.toBe\(1\.74\)/);
    expect(source).toMatch(/toBeCloseTo\(1\.74,\s*2\)/);
  });
});
