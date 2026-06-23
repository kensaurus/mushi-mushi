/**
 * FILE: packages/web/src/build-widget-theme.ts
 * PURPOSE: Resolve Shadow-DOM CSS variables from @mushi-mushi/core tokens.
 *
 * All widget hex literals live here (or in core/design-tokens.ts) so
 * packages/web/src/styles.ts stays a template-only stylesheet and
 * scripts/check-design-tokens.mjs can enforce the single-source rule.
 */
import {
  MUSHI_ACCENT_SHADOW,
  MUSHI_BANNER_BRAND_BORDER,
  MUSHI_BANNER_NEON,
  MUSHI_GEOMETRY,
  MUSHI_INVERSE,
  MUSHI_MOTION,
  MUSHI_ON_ACCENT,
  MUSHI_REPORTER_STATUS,
  MUSHI_TYPE,
  MUSHI_Z,
  mushiPalette,
  resolveWidgetAccent,
  type MushiThemeMode,
} from '@mushi-mushi/core';

export interface WidgetThemeVars {
  isDark: boolean;
  paper: string;
  paperRaised: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  inkDim: string;
  rule: string;
  ruleStrong: string;
  widgetAccent: string;
  widgetAccentWash: string;
  widgetAccentInk: string;
  widgetAccentShadow: string;
  ok: string;
  danger: string;
  onAccent: string;
  inverse: string;
  neonBannerBg: string;
  neonBannerFg: string;
  neonBannerBorder: string;
  brandBannerBorder: string;
  statusSent: { fg: string; bg: string; border: string };
  statusReview: { fg: string; bg: string; border: string };
  statusFixing: { fg: string; bg: string; border: string };
  statusFixed: { fg: string; bg: string; border: string };
  statusClosedBg: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  easeStamp: string;
  zBanner: number;
  zPanel: number;
  zOverlay: number;
  fabSize: number;
  panelWidth: number;
  panelSheetBreakpoint: number;
}

export function getWidgetThemeVars(
  theme: 'light' | 'dark',
  accent = '',
  accentText = '',
): WidgetThemeVars {
  const isDark = theme === 'dark';
  const mode: MushiThemeMode = isDark ? 'dark' : 'light';
  const pal = mushiPalette(mode);
  const accentResolved = resolveWidgetAccent(mode, accent, accentText);
  const status = MUSHI_REPORTER_STATUS[mode];

  return {
    isDark,
    paper: pal.paper,
    paperRaised: pal.paperRaised,
    ink: pal.ink,
    inkMuted: pal.inkMuted,
    inkFaint: pal.inkFaint,
    inkDim: pal.inkDim,
    rule: pal.rule,
    ruleStrong: pal.ruleStrong,
    widgetAccent: accentResolved.accent,
    widgetAccentWash: accentResolved.accentWash,
    widgetAccentInk: accentResolved.accentInk,
    widgetAccentShadow: isDark ? MUSHI_ACCENT_SHADOW.dark : MUSHI_ACCENT_SHADOW.light,
    ok: pal.ok,
    danger: pal.danger,
    onAccent: MUSHI_ON_ACCENT,
    inverse: MUSHI_INVERSE,
    neonBannerBg: MUSHI_BANNER_NEON.bg,
    neonBannerFg: MUSHI_BANNER_NEON.fg,
    neonBannerBorder: MUSHI_BANNER_NEON.border,
    brandBannerBorder: isDark ? MUSHI_BANNER_BRAND_BORDER.dark : MUSHI_BANNER_BRAND_BORDER.light,
    statusSent: status.sent,
    statusReview: status.review,
    statusFixing: status.fixing,
    statusFixed: status.fixed,
    statusClosedBg: isDark ? 'rgba(242,235,221,0.06)' : 'rgba(14,13,11,0.05)',
    fontDisplay: MUSHI_TYPE.fontDisplay,
    fontBody: MUSHI_TYPE.fontBody,
    fontMono: MUSHI_TYPE.fontMono,
    easeStamp: MUSHI_MOTION.easeStamp,
    zBanner: MUSHI_Z.banner,
    zPanel: MUSHI_Z.panel,
    zOverlay: MUSHI_Z.overlay,
    fabSize: MUSHI_GEOMETRY.fabSize,
    panelWidth: MUSHI_GEOMETRY.panelWidth,
    panelSheetBreakpoint: MUSHI_GEOMETRY.panelSheetBreakpoint,
  };
}

/** Preview subset for admin SdkInstallCard — same palette as the live widget. */
export function getWidgetPreviewTokens(theme: 'light' | 'dark') {
  const v = getWidgetThemeVars(theme);
  return {
    paper: v.paper,
    paperRaised: v.paperRaised,
    ink: v.ink,
    inkMuted: v.inkMuted,
    rule: v.ruleStrong,
    vermillion: v.widgetAccent,
    vermillionShadow: v.widgetAccentShadow,
    accentWash: v.widgetAccentWash,
    onAccent: v.onAccent,
    neonBannerBg: v.neonBannerBg,
    neonBannerFg: v.neonBannerFg,
    neonBannerBorder: v.neonBannerBorder,
    brandBannerBorder: v.brandBannerBorder,
  };
}
