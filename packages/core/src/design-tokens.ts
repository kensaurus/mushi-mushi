/**
 * FILE: packages/core/src/design-tokens.ts
 * PURPOSE: The single cross-platform source of truth for Mushi widget design.
 *
 * Every platform SDK (web Shadow-DOM CSS, React Native components, Capacitor
 * native sheet) reads its colours, spacing, radii, typography, z-index scale,
 * motion, launcher geometry, and default copy from this module so the widget
 * renders coherently everywhere. `@mushi-mushi/core` is already a dependency
 * of every platform package, which is why the tokens live here rather than in
 * a separate published package — one import path, no extra build wiring.
 *
 * Colour values mirror the historical washi/vermillion palette previously
 * inlined in `@mushi-mushi/web`'s styles.ts so the visual identity is
 * unchanged; the difference is that RN and Capacitor now share the exact
 * same constants instead of re-deriving their own.
 */

export type MushiThemeMode = 'light' | 'dark';

export interface MushiColorPalette {
  /** washi cream / dark wash — primary surface */
  paper: string;
  /** elevated surface (panels, sheets) */
  paperRaised: string;
  /** sumi black / cream type — primary text */
  ink: string;
  /** captions, descriptions */
  inkMuted: string;
  /** disabled, separators */
  inkFaint: string;
  /** dim text */
  inkDim: string;
  /** hairline rules */
  rule: string;
  /** stronger rules / borders */
  ruleStrong: string;
  /** 朱 hanko red — signature accent */
  accent: string;
  /** ~8–12% accent wash */
  accentWash: string;
  /** accessible text on the accent wash */
  accentInk: string;
  /** success */
  ok: string;
  /** danger / destructive */
  danger: string;
}

/** Light-mode palette. */
export const MUSHI_COLORS_LIGHT: MushiColorPalette = {
  paper: '#F8F4ED',
  paperRaised: '#FFFFFF',
  ink: '#0E0D0B',
  inkMuted: '#5C5852',
  inkFaint: '#9A9489',
  inkDim: '#6E6760',
  rule: 'rgba(14,13,11,0.10)',
  ruleStrong: 'rgba(14,13,11,0.16)',
  accent: '#E03C2C',
  accentWash: 'rgba(224,60,44,0.08)',
  accentInk: '#7A1F15',
  ok: '#16A34A',
  danger: '#DC2626',
};

/** Dark-mode palette. */
export const MUSHI_COLORS_DARK: MushiColorPalette = {
  paper: '#0F0E0C',
  paperRaised: '#1A1815',
  ink: '#F2EBDD',
  inkMuted: '#928B7E',
  inkFaint: '#5A5650',
  inkDim: '#7A7268',
  rule: 'rgba(242,235,221,0.10)',
  ruleStrong: 'rgba(242,235,221,0.18)',
  accent: '#FF5A47',
  accentWash: 'rgba(255,90,71,0.12)',
  accentInk: '#FFE5E0',
  ok: '#4ADE80',
  danger: '#F87171',
};

/** Resolve the palette for a theme mode. */
export function mushiPalette(mode: MushiThemeMode): MushiColorPalette {
  return mode === 'dark' ? MUSHI_COLORS_DARK : MUSHI_COLORS_LIGHT;
}

/**
 * Spacing scale (px). Named by feel, matching the editorial design system so
 * the same rhythm reads across web and native.
 */
export const MUSHI_SPACING = {
  hairline: 2,
  tight: 4,
  snug: 8,
  comfy: 12,
  roomy: 16,
  lounge: 20,
  open: 24,
  wide: 32,
} as const;

/** Corner radii (px). Tables/strips stay sharp; controls get soft corners. */
export const MUSHI_RADIUS = {
  none: 0,
  control: 4,
  card: 10,
  sheet: 16,
  pill: 999,
} as const;

/** Typography stacks shared by every platform (system-first, no web-font fetch). */
export const MUSHI_TYPE = {
  fontDisplay: `'Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Book Antiqua', 'Cambria', Georgia, 'Times New Roman', serif`,
  fontBody: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', sans-serif`,
  fontMono: `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace`,
  sizeBody: 14,
  sizeLabel: 12,
  sizeTitle: 16,
  lineBody: 1.55,
} as const;

/**
 * z-index scale. The host element is pass-through; only interactive surfaces
 * opt back into pointer events. Banner sits just under the FAB; panel above.
 */
export const MUSHI_Z = {
  base: 99999,
  /** banner sits one below the trigger so an open FAB overlaps it */
  banner: 99998,
  /** report/assistant panel sits one above the trigger */
  panel: 100000,
  /** element-selector overlay — always on top */
  overlay: 2147483647,
} as const;

/** Motion signature — a soft back-out "stamp press". */
export const MUSHI_MOTION = {
  easeStamp: 'cubic-bezier(0.22, 1, 0.36, 1)',
  durationFast: 200,
  durationPanel: 300,
} as const;

/**
 * Launcher geometry — the numbers that previously diverged between platforms
 * (banner height, FAB size, default gutter, panel width). Centralising them
 * is what fixes the "different on every app" + safe-area bleed problems.
 */
export const MUSHI_GEOMETRY = {
  bannerHeight: 36,
  fabSize: 52,
  edgeTabWidth: 28,
  /** default gutter from the screen edge (added on top of safe-area insets) */
  gutter: 24,
  panelWidth: 384,
  /** below this viewport width the panel becomes a full-width bottom sheet */
  panelSheetBreakpoint: 480,
} as const;

/**
 * Default user-facing copy. Centralised so apps stop drifting on the banner
 * label / CTA wording (seen as inconsistent across the four host apps).
 */
export const MUSHI_COPY = {
  bannerLabel: 'Beta',
  bannerMessage: 'Help us improve — your feedback shapes what we ship.',
  bugCta: 'Report a bug',
  featureCta: 'Feature request',
  triggerText: '🐛',
  panelTitle: 'Send feedback',
  myReportsTab: 'My reports',
  assistantTab: 'Ask',
} as const;

/** A flat, serialisable snapshot of every token for a given theme mode. */
export interface MushiTokenSnapshot {
  mode: MushiThemeMode;
  colors: MushiColorPalette;
  spacing: typeof MUSHI_SPACING;
  radius: typeof MUSHI_RADIUS;
  type: typeof MUSHI_TYPE;
  z: typeof MUSHI_Z;
  motion: typeof MUSHI_MOTION;
  geometry: typeof MUSHI_GEOMETRY;
  copy: typeof MUSHI_COPY;
}

/** Build a full token snapshot for a theme mode (used by RN/Capacitor). */
export function mushiTokens(mode: MushiThemeMode): MushiTokenSnapshot {
  return {
    mode,
    colors: mushiPalette(mode),
    spacing: MUSHI_SPACING,
    radius: MUSHI_RADIUS,
    type: MUSHI_TYPE,
    z: MUSHI_Z,
    motion: MUSHI_MOTION,
    geometry: MUSHI_GEOMETRY,
    copy: MUSHI_COPY,
  };
}
