/**
 * FILE: packages/web/src/styles.ts
 * PURPOSE: The widget's stylesheet, scoped to its shadow root.
 *
 * DESIGN (Plan 018 §1.4 — "looks like part of the host app"):
 * - Neutral by default: the host page's font, system Canvas / CanvasText for
 *   paper and ink, hairline borders mixed from the ink, and an accent that
 *   falls back to the ink. Light and dark follow `color-scheme`.
 * - Theming contract: every colour reads a public `--mushi-*` token
 *   (`--mushi-font`, `--mushi-bg`, `--mushi-fg`, `--mushi-muted`,
 *   `--mushi-surface`, `--mushi-border`, `--mushi-accent`, `--mushi-accent-fg`,
 *   `--mushi-success`, `--mushi-error`, `--mushi-radius`, `--mushi-shadow`).
 *   A host sets them on `:root` or on `#mushi-mushi-widget`; they are only
 *   READ here (into private `--_*` names), so CSS always beats JS config.
 * - One accent-filled action per view (Send, Done). Chips and badges use ink.
 * - 44px targets for primary controls, focus-visible everywhere, and every
 *   animation collapses under prefers-reduced-motion.
 * - The banner keeps its three variants (`subtle` default, `brand`, `neon`);
 *   the panel never takes the banner's colour.
 */

import { getWidgetThemeVars, safeCssColor } from './build-widget-theme';
import {
  MUSHI_DURATION,
  MUSHI_GEOMETRY,
  MUSHI_MOTION,
  MUSHI_RADIUS,
  MUSHI_SPACING,
  MUSHI_Z,
  type MushiThemeMode,
} from '@mushi-mushi/core';

/**
 * @param accent    Resolved panel accent (any CSS colour; unsafe values are dropped). '' = the ink.
 * @param accentText Text colour on the accent; '' = auto (white on a custom accent, paper on ink).
 */
export function getWidgetStyles(theme: MushiThemeMode, accent = '', accentText = ''): string {
  // The brand palette still colours the `brand` / `neon` banner variants.
  const v = getWidgetThemeVars(theme);
  const panelAccent = safeCssColor(accent);
  const panelAccentFg = safeCssColor(accentText);
  const {
    isDark,
    ink,
    ruleStrong,
    widgetAccent,
    shadowInk,
    ok,
    danger,
    inverse,
    neonBannerBg,
    neonBannerFg,
    neonBannerBorder,
    brandBannerBorder,
    statusSent,
    statusReview,
    statusFixing,
    statusFixed,
    fontMono,
    easeStamp,
    zBanner,
    fabSize,
  } = v;

  const { durationFast } = MUSHI_MOTION;
  const { instant: durInstant, panel: durPanel } = MUSHI_DURATION;
  const { bannerHeight, gutter, panelWidth, panelMaxHeight, panelSheetBreakpoint, edgeTabWidth } = MUSHI_GEOMETRY;
  const panelLauncherGap = fabSize + MUSHI_SPACING.comfy;
  const controlRadius = MUSHI_RADIUS.control;

  return `
    :host {
      all: initial;
      color-scheme: ${isDark ? 'dark' : 'light'};
      font-family: var(--mushi-font, inherit);
      font-size: var(--mushi-font-size, 14px);
      line-height: 1.45;
      --_bg: var(--mushi-bg, Canvas);
      --_fg: var(--mushi-fg, CanvasText);
      --_muted: var(--mushi-muted, color-mix(in oklab, var(--_fg) 64%, transparent));
      --_surface: var(--mushi-surface, color-mix(in oklab, var(--_bg) 94%, var(--_fg)));
      --_border: var(--mushi-border, color-mix(in oklab, var(--_fg) 16%, transparent));
      --_accent: var(--mushi-accent, ${panelAccent || 'var(--_fg)'});
      --_accent-fg: var(--mushi-accent-fg, ${panelAccent ? panelAccentFg || 'white' : 'var(--_bg)'});
      --_ok: var(--mushi-success, ${ok});
      --_err: var(--mushi-error, ${danger});
      --_radius: var(--mushi-radius, 12px);
      --_shadow: var(--mushi-shadow, 0 12px 40px rgb(0 0 0 / .18));
      color: var(--_fg);
      -webkit-font-smoothing: antialiased;
      /* SDK contract: the host element is always pass-through. Only the
         interactive surfaces opt back into pointer events so the widget never
         creates an invisible touch blocker over host-app UI. */
      pointer-events: none;
    }
    /* Only actual widget controls receive touch/mouse events. */
    .mushi-trigger,
    .mushi-banner,
    .mushi-panel,
    .mushi-toast {
      pointer-events: auto;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    button { font-family: inherit; }

    .mushi-trigger {
      position: fixed;
      width: ${fabSize}px;
      height: ${fabSize}px;
      min-width: 44px;
      min-height: 44px;
      border: 1px solid var(--_border);
      border-radius: ${controlRadius}px;
      background: var(--_bg);
      color: var(--_fg);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      
      font-size: 22px;
      line-height: 1;
      box-shadow:
        0 1px 0 var(--_border),
        0 6px 14px -8px rgba(${shadowInk},0.35),
        inset 0 -3px 0 var(--_accent);
      transition: transform ${durationFast}ms ${easeStamp}, opacity ${durationFast}ms ${easeStamp};
      overflow: visible;
      isolation: isolate;
    }
    .mushi-trigger::after {
      content: '';
      position: absolute;
      top: 6px;
      right: 6px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--_accent);
      box-shadow: 0 0 0 0 var(--_accent);
      animation: mushi-pulse 2.4s ${easeStamp} infinite;
    }
    .mushi-trigger:hover {
      transform: translateY(-2px) rotate(-1.5deg);
      box-shadow:
        0 1px 0 var(--_border),
        0 14px 24px -10px rgba(${shadowInk},0.45),
        0 0 20px -6px color-mix(in oklab, var(--_accent) 22%, transparent),
        inset 0 -3px 0 var(--_accent);
    }
    .mushi-trigger:active {
      transform: translateY(0) rotate(0);
      box-shadow:
        0 1px 0 var(--_border),
        0 2px 4px -2px rgba(${shadowInk},0.35),
        inset 0 -2px 0 var(--_accent);
    }
    .mushi-trigger:focus-visible {
      outline: 2px solid var(--_accent);
      outline-offset: 3px;
    }
    /* First-session welcome pulse. Three soft halos at 800ms each, then
       auto-clear. Uses a box-shadow ring rather than transform/scale so it
       can compose with the hover transform without fighting it. Respects
       prefers-reduced-motion. */
    @keyframes mushi-trigger-pulse {
      0%   { box-shadow: 0 0 0 0 color-mix(in oklab, var(--_accent) 55%, transparent), 0 1px 0 var(--_border), 0 10px 24px -14px rgba(${shadowInk},0.45); }
      70%  { box-shadow: 0 0 0 16px color-mix(in oklab, var(--_accent) 0%, transparent), 0 1px 0 var(--_border), 0 10px 24px -14px rgba(${shadowInk},0.45); }
      100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--_accent) 0%, transparent), 0 1px 0 var(--_border), 0 10px 24px -14px rgba(${shadowInk},0.45); }
    }
    .mushi-trigger-pulse {
      animation: mushi-trigger-pulse 800ms ${easeStamp} 3;
    }
    @media (prefers-reduced-motion: reduce) {
      .mushi-trigger-pulse { animation: none; }
    }
    .mushi-trigger.bottom-right {
      bottom: var(--mushi-bottom, calc(${gutter}px + env(safe-area-inset-bottom, 0px)));
      right: var(--mushi-right, calc(${gutter}px + env(safe-area-inset-right, 0px)));
    }
    .mushi-trigger.bottom-left  {
      bottom: var(--mushi-bottom, calc(${gutter}px + env(safe-area-inset-bottom, 0px)));
      left: var(--mushi-left, calc(${gutter}px + env(safe-area-inset-left, 0px)));
    }
    .mushi-trigger.top-right    {
      top: var(--mushi-top, calc(${gutter}px + env(safe-area-inset-top, 0px)));
      right: var(--mushi-right, calc(${gutter}px + env(safe-area-inset-right, 0px)));
    }
    .mushi-trigger.top-left     {
      top: var(--mushi-top, calc(${gutter}px + env(safe-area-inset-top, 0px)));
      left: var(--mushi-left, calc(${gutter}px + env(safe-area-inset-left, 0px)));
    }
    .mushi-trigger.edge-tab {
      width: ${edgeTabWidth}px;
      height: 88px;
      border-radius: ${controlRadius}px 0 0 ${controlRadius}px;
      writing-mode: vertical-rl;
      text-orientation: upright;
      font-size: 16px;
      box-shadow:
        0 1px 0 var(--_border),
        0 10px 24px -14px rgba(${shadowInk},0.45),
        inset -3px 0 0 var(--_accent);
    }
    .mushi-trigger.edge-tab.bottom-right,
    .mushi-trigger.edge-tab.top-right {
      right: var(--mushi-right, 0);
    }
    .mushi-trigger.edge-tab.bottom-left,
    .mushi-trigger.edge-tab.top-left {
      left: var(--mushi-left, 0);
      border-radius: 0 ${controlRadius}px ${controlRadius}px 0;
      box-shadow:
        0 1px 0 var(--_border),
        0 10px 24px -14px rgba(${shadowInk},0.45),
        inset 3px 0 0 var(--_accent);
    }
    .mushi-trigger.shrunk {
      width: ${bannerHeight}px;
      height: ${bannerHeight}px;
      opacity: 0.82;
      transform: scale(0.92);
    }

    /* ── Draggable FAB ──────────────────────────────────────────────────────
       When draggable is enabled the trigger uses CSS translate to apply the
       drag offset ON TOP of the existing inset positioning, so snapping and
       safe-area clamp still work correctly via the inset vars.
       --mushi-drag-active 0|1 gates the transform so non-draggable FABs are
       completely unaffected. touch-action: none prevents browser pan/scroll
       from racing the pointer capture. */
    .mushi-trigger {
      touch-action: none;
      translate:
        calc(var(--mushi-drag-active, 0) * var(--mushi-drag-x, 0px))
        calc(var(--mushi-drag-active, 0) * var(--mushi-drag-y, 0px));
    }
    .mushi-trigger.dragging {
      cursor: grabbing !important;
      z-index: calc(var(--z, ${MUSHI_Z.base}) + 2);
      transition: none !important;
      box-shadow:
        0 1px 0 var(--_border),
        0 20px 40px -12px rgba(${shadowInk},0.55),
        inset 0 -3px 0 var(--_accent);
      opacity: 0.92;
    }
    @media (prefers-reduced-motion: reduce) {
      .mushi-trigger { transition: none !important; }
    }

    @keyframes mushi-pulse {
      0%   { box-shadow: 0 0 0 0 var(--_accent); opacity: 1; }
      70%  { box-shadow: 0 0 0 8px transparent; opacity: 0.5; }
      100% { box-shadow: 0 0 0 0 transparent; opacity: 1; }
    }

    /* ── Panel (Plan 018 §1) ─────────────────────────────────────────
       Neutral by default: the host's font, system Canvas/CanvasText, and an
       accent that falls back to the ink colour. Every colour reads a
       --mushi-* token the host can set on :root or #mushi-mushi-widget. One
       accent-filled action per view. */
    .mushi-panel {
      position: fixed;
      /* One screen, free text first: wider and taller than the old 3-step
         card so the whole report fits without an inner scroll on desktop. */
      width: calc(${panelWidth}px + 40px);
      max-width: calc(100vw - 32px);
      max-height: min(calc(${panelMaxHeight}px + 160px), calc(100dvh - 96px - var(--mushi-keyboard-inset, 0px)));
      background: var(--_bg);
      color: var(--_fg);
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      box-shadow: var(--_shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform-origin: var(--mushi-origin, bottom right);
    }
    .mushi-panel.open { animation: mushi-open 180ms cubic-bezier(.2,.8,.2,1) both; }
    .mushi-panel.closed { display: none; }
    .mushi-panel.mushi-swap .mushi-scroll, .mushi-panel.mushi-swap .mushi-footer { animation: mushi-fade 120ms ease-out both; }
    @keyframes mushi-open { from { opacity: 0; transform: translateY(8px); } }
    @keyframes mushi-fade { from { opacity: 0; } }
    .mushi-panel.bottom-right {
      bottom: var(--mushi-panel-bottom, calc(var(--mushi-bottom, ${gutter}px) + ${panelLauncherGap}px));
      right: var(--mushi-right, calc(${gutter}px + env(safe-area-inset-right, 0px)));
      --mushi-origin: bottom right;
    }
    .mushi-panel.bottom-left {
      bottom: var(--mushi-panel-bottom, calc(var(--mushi-bottom, ${gutter}px) + ${panelLauncherGap}px));
      left: var(--mushi-left, calc(${gutter}px + env(safe-area-inset-left, 0px)));
      --mushi-origin: bottom left;
    }
    .mushi-panel.top-right {
      top: var(--mushi-panel-top, calc(var(--mushi-top, ${gutter}px) + ${panelLauncherGap}px));
      right: var(--mushi-right, calc(${gutter}px + env(safe-area-inset-right, 0px)));
      --mushi-origin: top right;
    }
    .mushi-panel.top-left {
      top: var(--mushi-panel-top, calc(var(--mushi-top, ${gutter}px) + ${panelLauncherGap}px));
      left: var(--mushi-left, calc(${gutter}px + env(safe-area-inset-left, 0px)));
      --mushi-origin: top left;
    }
    /* Keyboard-safe: lift above the on-screen keyboard (layout, not decoration). */
    .mushi-panel.keyboard-open { bottom: calc(var(--mushi-keyboard-inset, 0px) + 8px) !important; }
    /* Phones: a bottom sheet across the full width. */
    @media (max-width: ${panelSheetBreakpoint}px) {
      .mushi-panel {
        left: 0 !important;
        right: 0 !important;
        top: auto !important;
        width: 100% !important;
        max-width: 100% !important;
        max-height: calc(100dvh - 24px - var(--mushi-keyboard-inset, 0px));
        border-radius: var(--_radius) var(--_radius) 0 0;
        bottom: var(--mushi-keyboard-inset, 0px) !important;
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }
    }
    .mushi-panel :focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
    .mushi-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .mushi-notice:empty, .mushi-lead:empty, .mushi-footer:empty, .mushi-brand:empty { display: none; }
    .mushi-outdated { margin: 8px 12px 0; padding: 8px 10px; border-radius: 8px; background: var(--_surface); font-size: 12px; }

    .mushi-header { display: flex; align-items: center; gap: 2px; min-height: 56px; padding: 6px 6px 6px 16px; border-bottom: 1px solid var(--_border); }
    .mushi-title { flex: 1; min-width: 0; margin: 0; font-size: 16px; font-weight: 600; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .mushi-title:focus { outline: none; }
    .mushi-header-host-icon { width: 20px; height: 20px; margin-right: 8px; border-radius: 4px; object-fit: contain; }
    .mushi-header .mushi-icon-btn:first-child { margin-left: -10px; }
    .mushi-icon-btn { display: inline-flex; align-items: center; justify-content: center; flex: none; min-width: 44px; min-height: 44px; border: 0; border-radius: 10px; background: none; color: var(--_muted); font: inherit; font-size: 17px; cursor: pointer; }
    .mushi-icon-btn:hover { background: var(--_surface); color: var(--_fg); }
    .mushi-pill-btn { display: inline-flex; align-items: center; gap: 6px; flex: none; min-height: 36px; margin: 4px; padding: 0 12px; border: 1px solid var(--_border); border-radius: 999px; background: none; color: var(--_fg); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
    .mushi-pill-btn:hover { background: var(--_surface); }
    .mushi-badge { padding: 1px 7px; border-radius: 999px; background: var(--_fg); color: var(--_bg); font-size: 11px; font-weight: 600; }
    .mushi-menu-wrap { position: relative; }
    .mushi-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 2; display: flex; flex-direction: column; min-width: 210px; padding: 4px; background: var(--_bg); border: 1px solid var(--_border); border-radius: 10px; box-shadow: var(--_shadow); }
    .mushi-menu-item { min-height: 44px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--_fg); font: inherit; text-align: left; cursor: pointer; }
    .mushi-menu-item:hover { background: var(--_surface); }

    .mushi-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; scrollbar-width: thin; }
    .mushi-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .mushi-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 10px 12px 12px 16px; border-top: 1px solid var(--_border); }
    .mushi-footer-hint { flex: 1; min-width: 0; font-size: 12px; color: var(--_muted); }
    .mushi-brand-footer { padding: 6px 12px 8px; text-align: center; font-size: 11px; color: var(--_muted); }
    .mushi-brand-link { color: inherit; text-decoration: none; }
    .mushi-brand-link:hover { text-decoration: underline; }

    .mushi-textarea, .mushi-input { width: 100%; border: 1px solid var(--_border); border-radius: 10px; background: var(--_bg); color: var(--_fg); font: inherit; }
    .mushi-textarea { display: block; min-height: 88px; max-height: 40vh; padding: 12px; font-size: 15px; line-height: 1.45; resize: vertical; }
    .mushi-input { flex: 1; min-width: 0; min-height: 44px; padding: 10px 12px; resize: none; }
    .mushi-textarea:focus, .mushi-input:focus { outline: 2px solid var(--_accent); outline-offset: 1px; border-color: transparent; }
    .mushi-textarea::placeholder, .mushi-input::placeholder { color: var(--_muted); opacity: 1; }
    .mushi-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .mushi-chip-group { display: contents; }
    .mushi-chip { min-height: 40px; padding: 0 14px; border: 1px solid var(--_border); border-radius: 999px; background: none; color: var(--_fg); font: inherit; font-size: 13px; cursor: pointer; }
    .mushi-chip:hover { background: var(--_surface); }
    .mushi-chip[aria-checked="true"] { background: var(--_fg); border-color: var(--_fg); color: var(--_bg); }
    .mushi-chip-more { border-style: dashed; color: var(--_muted); }
    .mushi-chip-sm { min-height: 36px; padding: 0 12px; font-size: 12px; }
    .mushi-attachments { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
    .mushi-attach-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border: 1px solid var(--_border); border-radius: 10px; background: var(--_surface); color: var(--_fg); font: inherit; font-size: 13px; cursor: pointer; }
    .mushi-attach-btn:hover { border-color: var(--_muted); }
    .mushi-attach-btn.active { border-color: var(--_ok); }
    .mushi-attach-btn.error { border-color: var(--_err); color: var(--_err); }
    .mushi-attach-btn[disabled] { cursor: progress; opacity: .75; }
    .mushi-screenshot-preview { display: flex; align-items: flex-start; gap: 10px; width: 100%; margin: 0; }
    .mushi-screenshot-preview.open { flex-direction: column; }
    .mushi-thumb { flex: none; padding: 0; border: 1px solid var(--_border); border-radius: 8px; background: var(--_surface); line-height: 0; overflow: hidden; cursor: zoom-in; }
    .mushi-thumb img { display: block; width: 72px; height: 54px; object-fit: cover; }
    .mushi-screenshot-preview.open .mushi-thumb { cursor: zoom-out; }
    .mushi-screenshot-preview.open .mushi-thumb img { width: 100%; height: auto; max-height: 40vh; object-fit: contain; }
    .mushi-screenshot-preview figcaption { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
    .mushi-screenshot-hint { font-size: 12px; color: var(--_muted); }
    .mushi-attach-actions { display: flex; gap: 14px; }
    .mushi-annotate-host { width: 100%; }
    .mushi-annotate-host:empty { display: none; }
    .mushi-note { margin: 0; font-size: 12px; line-height: 1.45; color: var(--_muted); }
    .mushi-error-inline, .mushi-warn { color: var(--_err); }
    .mushi-empty { margin: 0; padding: 24px 8px; text-align: center; color: var(--_muted); }
    .mushi-link-btn { min-height: 24px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
    .mushi-btn, .mushi-submit { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
    .mushi-btn { border: 1px solid var(--_border); background: none; color: var(--_fg); }
    .mushi-btn:hover { background: var(--_surface); }
    .mushi-submit { min-width: 88px; padding: 0 20px; border: 0; background: var(--_accent); color: var(--_accent-fg); font-weight: 600; }
    .mushi-submit:hover { filter: brightness(1.08); }
    .mushi-submit[aria-disabled="true"] { opacity: .45; cursor: not-allowed; }
    .mushi-submit[aria-busy="true"], .mushi-btn[aria-busy="true"] { cursor: progress; opacity: .75; }
    .mushi-check { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; cursor: pointer; }
    .mushi-check input { width: 18px; height: 18px; margin: 0; accent-color: var(--_fg); }
    .mushi-inline-form { display: flex; gap: 8px; width: 100%; }
    .mushi-optins { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; margin-top: 4px; text-align: left; }
    .mushi-beta-strip { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; background: var(--_surface); font-size: 13px; }
    .mushi-beta-strip p { margin: 0; }
    .mushi-beta-tag { padding: 0 6px; border-radius: 4px; background: var(--_fg); color: var(--_bg); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .mushi-beta-perks, .mushi-changelog ul { margin: 0; padding-left: 18px; font-size: 12px; }
    .mushi-changelog summary { font-size: 12px; color: var(--_muted); cursor: pointer; }
    .mushi-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; vertical-align: -2px; animation: mushi-spin .8s linear infinite; }
    @keyframes mushi-spin { to { transform: rotate(360deg); } }

    .mushi-success { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0 4px; text-align: center; }
    .mushi-success-stamp { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; color: var(--_accent); }
    .mushi-success-stamp svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .mushi-success-stamp circle { fill: none; stroke: currentColor; stroke-width: 3; stroke-dasharray: 280; stroke-dashoffset: 280; transform: rotate(-90deg); transform-origin: center; animation: mushi-ring 600ms ease-out 60ms forwards; }
    .mushi-success-stamp-label { font-size: 24px; font-weight: 600; opacity: 0; transform: rotate(-6deg); animation: mushi-press 300ms ease-out 450ms forwards; }
    @keyframes mushi-ring { to { stroke-dashoffset: 0; } }
    @keyframes mushi-press { from { opacity: 0; transform: rotate(-6deg) scale(1.3); } to { opacity: 1; transform: rotate(-6deg) scale(1); } }
    .mushi-success-meta { font-size: 12px; color: var(--_muted); }
    .mushi-success-receipt { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .mushi-success-sla { margin: 0; font-size: 15px; }
    .mushi-success-receipt-id { min-height: 24px; padding: 2px 6px; border: 1px dashed var(--_border); border-radius: 6px; background: none; color: inherit; font-family: ui-monospace, monospace; font-size: 12px; cursor: pointer; }
    .mushi-success-rewards { width: 100%; }
    .mushi-success-pts-award { font-size: 20px; font-weight: 700; }
    .mushi-tier-bar-track { height: 4px; margin: 6px 0; border-radius: 2px; background: var(--_surface); overflow: hidden; }
    .mushi-tier-bar-fill { height: 100%; background: var(--_fg); transform-origin: left; transform: scaleX(var(--mushi-tier-pct, 0)); }

    .mushi-report-list, .mushi-thread, .mushi-assistant-log { display: flex; flex-direction: column; gap: 8px; }
    .mushi-report-row { display: flex; flex-direction: column; gap: 4px; width: 100%; min-height: 56px; padding: 10px 12px; border: 1px solid var(--_border); border-radius: 10px; background: none; color: var(--_fg); font: inherit; text-align: left; }
    button.mushi-report-row { cursor: pointer; }
    button.mushi-report-row:hover { background: var(--_surface); }
    .mushi-report-row.unread { box-shadow: inset 3px 0 0 var(--_fg); }
    .mushi-row-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .mushi-row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
    .mushi-row-when, .mushi-row-meta, .mushi-event time, .mushi-bubble time { font-size: 12px; color: var(--_muted); }
    .mushi-row-when { flex: none; }
    .mushi-row-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mushi-row-news { font-size: 13px; }
    .unread .mushi-row-title, .unread .mushi-row-news { font-weight: 600; }
    .mushi-roadmap-row .mushi-btn { align-self: flex-start; }
    /* Tone text leans 15% toward the ink so every pill clears 4.5:1 on its tint. */
    .mushi-pill { flex: none; display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1.5; white-space: nowrap; }
    .mushi-tone-neutral, .mushi-tone-muted { background: var(--_surface); color: var(--_muted); }
    .mushi-tone-info { background: ${statusSent.bg}; color: color-mix(in oklab, ${statusSent.fg} 85%, var(--_fg)); }
    .mushi-tone-attention { background: ${statusReview.bg}; color: color-mix(in oklab, ${statusReview.fg} 85%, var(--_fg)); }
    .mushi-tone-progress { background: ${statusFixing.bg}; color: color-mix(in oklab, ${statusFixing.fg} 85%, var(--_fg)); }
    .mushi-tone-success, .mushi-tone-success-muted { background: ${statusFixed.bg}; color: color-mix(in oklab, ${statusFixed.fg} 85%, var(--_fg)); }
    .mushi-skeleton { display: flex; flex-direction: column; gap: 8px; }
    .mushi-skeleton span { height: 14px; border-radius: 6px; background: var(--_surface); animation: mushi-shimmer 1.2s ease-in-out infinite alternate; }
    .mushi-skeleton span:nth-child(2) { width: 82%; }
    .mushi-skeleton span:nth-child(3) { width: 58%; }
    @keyframes mushi-shimmer { to { opacity: .45; } }

    .mushi-thread-summary { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 10px; background: var(--_surface); }
    .mushi-card-status, .mushi-summary-text { margin: 0; }
    .mushi-summary-text { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
    .mushi-card-thumb { align-self: flex-start; max-width: 100%; max-height: 160px; border-radius: 8px; object-fit: contain; }
    .mushi-timeline { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .mushi-event { display: flex; justify-content: space-between; gap: 8px; padding-left: 10px; border-left: 2px solid var(--_border); font-size: 12px; color: var(--_muted); }
    .mushi-event time, .mushi-bubble time { flex: none; }
    .mushi-bubble, .mushi-assistant-msg { display: flex; flex-direction: column; gap: 2px; max-width: 88%; padding: 8px 12px; border-radius: 12px; background: var(--_surface); white-space: pre-wrap; word-break: break-word; }
    .mushi-bubble.dev, .mushi-assistant-msg.dev { align-self: flex-start; border: 1px solid var(--_border); border-bottom-left-radius: 4px; background: none; }
    .mushi-bubble.mine, .mushi-assistant-msg.mine { align-self: flex-end; border-bottom-right-radius: 4px; background: color-mix(in oklab, var(--_fg) 9%, var(--_bg)); }
    .mushi-bubble strong { font-size: 12px; }
    .mushi-bubble p { margin: 0; font-size: 14px; }
    .mushi-bubble-state { font-size: 11px; color: var(--_muted); }
    .mushi-verify { display: flex; gap: 8px; width: 100%; }
    .mushi-verify .mushi-btn { flex: 1; }
    .mushi-thread-composer { display: flex; align-items: flex-end; gap: 8px; width: 100%; }
    .mushi-reply { max-height: 104px; overflow-y: auto; }
    .mushi-send { min-width: 44px; padding: 0; font-size: 18px; }
    .mushi-thread-action-error { width: 100%; margin: 0; font-size: 12px; }
    .mushi-assistant-greeting { margin: 0; color: var(--_muted); }

    .mushi-lb { margin: 0; padding: 0; list-style: none; }
    .mushi-lb-row { display: flex; align-items: center; gap: 10px; min-height: 40px; border-bottom: 1px solid var(--_border); font-size: 13px; }
    .mushi-lb-row.me { font-weight: 600; }
    .mushi-xapp-group { display: flex; flex-direction: column; gap: 6px; }
    .mushi-xapp-app-name { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; font-weight: 600; color: var(--_muted); }
    .mushi-app-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 22px; height: 22px; border: 1px solid var(--_border); border-radius: 6px; background: var(--_surface); overflow: hidden; }
    .mushi-app-icon-img { display: block; width: 16px; height: 16px; object-fit: contain; }
    .mushi-app-icon-initials { font-size: 9px; font-weight: 700; line-height: 1; color: var(--_muted); }

    /* ── Update toast (§4.2) — near the launcher, once per session ── */
    .mushi-toast { position: fixed; display: flex; align-items: center; gap: 6px; max-width: min(380px, calc(100vw - 32px)); padding: 6px 6px 6px 14px; background: var(--_bg); color: var(--_fg); border: 1px solid var(--_border); border-radius: 12px; box-shadow: var(--_shadow); font-size: 14px; animation: mushi-open 180ms ease-out both; }
    .mushi-toast span { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .mushi-toast strong { font-weight: 600; }
    .mushi-toast small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--_muted); }
    .mushi-toast .mushi-btn { min-height: 36px; padding: 0 12px; }
    .mushi-toast .mushi-icon-btn { min-height: 36px; min-width: 36px; }
    .mushi-toast.bottom-right, .mushi-toast.bottom-left { bottom: calc(var(--mushi-bottom, ${gutter}px) + ${panelLauncherGap}px); }
    .mushi-toast.top-right, .mushi-toast.top-left { top: calc(var(--mushi-top, ${gutter}px) + ${panelLauncherGap}px); }
    .mushi-toast.bottom-right, .mushi-toast.top-right, .mushi-toast.banner-top, .mushi-toast.banner-bottom { right: var(--mushi-right, ${gutter}px); }
    .mushi-toast.bottom-left, .mushi-toast.top-left { left: var(--mushi-left, ${gutter}px); }
    .mushi-toast.banner-top { top: calc(var(--mushi-banner-offset, ${bannerHeight}px) + 12px); }
    .mushi-toast.banner-bottom { bottom: calc(var(--mushi-banner-offset, ${bannerHeight}px) + 12px); }

    /* ─── Banner launcher (trigger: 'banner') ─────────────────────────────── */

    .mushi-banner {
      position: fixed;
      left: 0;
      right: 0;
      /* min-height (not fixed height) + border-box so the safe-area padding
         below extends the bar into the notch/home-indicator zone instead of
         letting content bleed under the status bar (mobile safe-area bleed
         fix — Workstream C). Horizontal padding also clears the left/right
         insets for landscape notches. */
      box-sizing: border-box;
      min-height: ${bannerHeight}px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0 calc(16px + env(safe-area-inset-right, 0px)) 0 calc(16px + env(safe-area-inset-left, 0px));
      font-family: ${fontMono};
      font-size: 12px;
      letter-spacing: 0.04em;
      white-space: nowrap;
      overflow: hidden;
      z-index: var(--mushi-banner-z, ${zBanner});
      animation: mushi-banner-slide-in ${durPanel}ms ${easeStamp} both;
    }

    .mushi-banner.top    { top: 0; padding-top: env(safe-area-inset-top, 0px); }
    .mushi-banner.bottom { bottom: 0; padding-bottom: env(safe-area-inset-bottom, 0px); }

    /* --- neon variant (electric lime — dev / beta tool aesthetic) --- */
    .mushi-banner.neon {
      background: ${neonBannerBg};
      color: ${neonBannerFg};
      border-bottom: 1.5px solid ${neonBannerBorder};
    }
    .mushi-banner.neon.bottom {
      border-top: 1.5px solid ${neonBannerBorder};
      border-bottom: none;
    }
    .mushi-banner.neon .mushi-banner-btn {
      background: rgba(0,0,0,0.14);
      color: ${neonBannerFg};
      border: 1px solid rgba(0,0,0,0.22);
    }
    .mushi-banner.neon .mushi-banner-btn:hover {
      background: rgba(0,0,0,0.22);
    }

    /* --- brand variant (widgetAccent — editorial, app-quality) --- */
    .mushi-banner.brand {
      background: ${widgetAccent};
      color: ${inverse};
      border-bottom: 1.5px solid ${brandBannerBorder};
    }
    .mushi-banner.brand.bottom {
      border-top: 1.5px solid ${brandBannerBorder};
      border-bottom: none;
    }
    .mushi-banner.brand .mushi-banner-btn {
      background: rgba(255,255,255,0.18);
      color: ${inverse};
      border: 1px solid rgba(255,255,255,0.32);
    }
    .mushi-banner.brand .mushi-banner-btn:hover {
      background: rgba(255,255,255,0.28);
    }

    /* --- subtle variant (frosted-glass, muted — least disruptive) ---
       Uses the widget's own paper colour at high opacity + backdrop-blur so
       it blends with the host app while remaining legible. The previous 4-6%
       opacity values were effectively invisible — users could not distinguish
       the banner from the page content below it. */
    .mushi-banner.subtle {
      background: ${isDark ? 'rgba(15,14,12,0.88)' : 'rgba(248,244,237,0.92)'};
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      color: ${ink};
      border-bottom: 1px solid ${ruleStrong};
    }
    .mushi-banner.subtle.bottom {
      border-top: 1px solid ${ruleStrong};
      border-bottom: none;
    }
    .mushi-banner.subtle .mushi-banner-btn {
      background: ${isDark ? 'rgba(242,235,221,0.10)' : 'rgba(14,13,11,0.08)'};
      color: ${ink};
      border: 1px solid ${ruleStrong};
    }
    .mushi-banner.subtle .mushi-banner-btn:hover {
      background: ${isDark ? 'rgba(242,235,221,0.18)' : 'rgba(14,13,11,0.14)'};
    }

    .mushi-banner-label {
      flex: 1;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Rich layout — pill + message + flat text actions (admin BetaBanner parity) */
    .mushi-banner--rich {
      justify-content: space-between;
      gap: 12px;
      min-height: ${bannerHeight}px;
      height: auto;
      padding: 4px 12px 4px 16px;
      white-space: normal;
    }
    .mushi-banner-body {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .mushi-banner-pill {
      display: inline-flex;
      flex-shrink: 0;
      align-items: center;
      padding: 1px 6px;
      border-radius: 3px;
      border: 1px solid currentColor;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      opacity: 0.92;
    }
    .mushi-banner.neon .mushi-banner-pill {
      border-color: rgba(10,26,10,0.45);
      background: rgba(10,26,10,0.12);
    }
    .mushi-banner.brand .mushi-banner-pill {
      border-color: rgba(255,255,255,0.45);
      background: rgba(255,255,255,0.14);
    }
    .mushi-banner.subtle .mushi-banner-pill {
      border-color: ${ruleStrong};
      background: ${isDark ? 'rgba(242,235,221,0.08)' : 'rgba(14,13,11,0.06)'};
    }
    .mushi-banner-message {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      opacity: 0.9;
    }
    .mushi-banner-actions {
      display: inline-flex;
      align-items: center;
      gap: 0;
      /* Shrinkable + swipe-scrollable so a long action row can never push
         past the viewport edge (dismiss sits outside this nav). */
      flex-shrink: 1;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
      font-size: 11px;
    }
    .mushi-banner-actions::-webkit-scrollbar { display: none; }
    @media (max-width: ${panelSheetBreakpoint}px) {
      /* Phones: keep only the primary bug CTA (+ dismiss outside the nav). */
      .mushi-banner-actions .mushi-banner-extra { display: none; }
    }
    .mushi-banner-link {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      letter-spacing: inherit;
      text-decoration: none;
      opacity: 0.88;
      transition: opacity ${durInstant}ms ${easeStamp};
      flex-shrink: 0;
    }
    .mushi-banner-link:hover { opacity: 1; }
    .mushi-banner-link:focus-visible {
      outline: 2px solid ${widgetAccent};
      outline-offset: 2px;
      border-radius: 2px;
    }
    .mushi-banner-divider {
      opacity: 0.28;
      padding: 0 1px;
      user-select: none;
      flex-shrink: 0;
    }
    .mushi-banner--rich .mushi-banner-dismiss {
      margin-left: 4px;
    }

    .mushi-banner-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      letter-spacing: inherit;
      transition: opacity ${durInstant}ms ${easeStamp};
      flex-shrink: 0;
      height: 24px;
      line-height: 1;
    }
    .mushi-banner-btn:focus-visible {
      outline: 2px solid ${widgetAccent};
      outline-offset: 2px;
    }

    .mushi-banner-dismiss {
      background: transparent !important;
      border: none !important;
      opacity: 0.65;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 4px 8px;
      margin-left: auto;
      flex-shrink: 0;
      color: inherit;
      border-radius: 3px;
      transition: opacity ${durInstant}ms ${easeStamp};
    }
    .mushi-banner-dismiss:hover {
      opacity: 1;
      background: rgba(0,0,0,0.12) !important;
    }
    .mushi-banner.neon .mushi-banner-dismiss:hover { background: rgba(0,0,0,0.18) !important; }

    /* "My reports" link in the simple (non-rich) banner layout */
    .mushi-banner-my-reports {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 11px;
      font-family: ${fontMono};
      opacity: 0.75;
      color: inherit;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
      flex-shrink: 0;
      transition: opacity ${durInstant}ms ${easeStamp};
      margin-left: 4px;
    }
    .mushi-banner-my-reports:hover {
      opacity: 1;
      background: rgba(0,0,0,0.10);
    }
    .mushi-banner.neon .mushi-banner-my-reports:hover { background: rgba(0,0,0,0.18); }

    @keyframes mushi-banner-slide-in {
      from { transform: translateY(calc(-1 * 100%)); opacity: 0.5; }
      to   { transform: translateY(0);               opacity: 1;   }
    }
    .mushi-banner.bottom {
      animation-name: mushi-banner-slide-in-bottom;
    }
    @keyframes mushi-banner-slide-in-bottom {
      from { transform: translateY(100%); opacity: 0.5; }
      to   { transform: translateY(0);   opacity: 1;   }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
      .mushi-success-stamp circle { stroke-dashoffset: 0; }
      .mushi-success-stamp-label { opacity: 1; }
    }
  `;
}
