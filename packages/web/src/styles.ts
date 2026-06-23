/**
 * FILE: packages/web/src/styles.ts
 * PURPOSE: Visual design system for the bug-capture widget. Returns a single
 *          string of CSS scoped to the widget's shadow root.
 *
 * DESIGN LANGUAGE — "Mushi Mushi Editorial"
 *
 *   The product name is 虫々 (mushi-mushi, Japanese for "bug, bug"). Earlier
 *   versions of this widget rendered as a generic SaaS chatbot — round purple
 *   button, Inter font, drop-shadowed white modal — indistinguishable from
 *   every Intercom/Crisp/UserBack clone. We lean into the brand instead.
 *
 *   The aesthetic borrows from Japanese print + editorial design:
 *
 *     • PAPER + INK     — warm cream surface, deep sumi ink type, no flat
 *                          white. Subtle paper grain via a single noise SVG
 *                          background-image to break the digital flatness.
 *     • VERMILLION 朱   — `widgetAccent` (hanko vermillion) used as a stamp colour.
 *                          Replaces the generic SaaS purple. Used only for:
 *                          active state, focus underline, submit button, and
 *     • SERIF DISPLAY   — Iowan/Palatino/Georgia stack for headings (a real
 *                          editorial serif on every desktop OS, no web font
 *                          fetch, no FOUT).
 *     • MONO METADATA   — ui-monospace for step counters, captions, and the
 *                          submit-button label, evoking a printer's ledger.
 *     • RULE LINES      — content separators are 1px hairlines, not boxes.
 *                          Categories list looks like a contents page, not a
 *                          card stack.
 *     • STAMP INTERACTIONS — submit button has a widgetAccent ink-bloom
 *                          animation; the success step shows a 朱印 (red
 *                          stamp) ring with "RECEIVED" in mono caps.
 *
 *   Constraints respected: typography ≥ 12px (skill: design-frontend),
 *   touch targets ≥ 44px, focus-visible always rendered, prefers-reduced-
 *   motion fully honoured, AA contrast in both themes, no external fonts.
 */

import { getWidgetThemeVars } from './build-widget-theme';
import {
  MUSHI_GEOMETRY,
  MUSHI_MOTION,
  MUSHI_RADIUS,
  MUSHI_SPACING,
  MUSHI_TYPE,
  MUSHI_Z,
  type MushiThemeMode,
} from '@mushi-mushi/core';

export function getWidgetStyles(theme: MushiThemeMode, accent = '', accentText = ''): string {
  const v = getWidgetThemeVars(theme, accent, accentText);
  const {
    isDark,
    paper,
    paperRaised,
    ink,
    inkMuted,
    inkFaint,
    inkDim,
    rule,
    ruleStrong,
    widgetAccent,
    widgetAccentWash,
    widgetAccentInk,
    widgetAccentShadow,
    ok,
    danger,
    onAccent,
    inverse,
    neonBannerBg,
    neonBannerFg,
    neonBannerBorder,
    brandBannerBorder,
    statusSent,
    statusReview,
    statusFixing,
    statusFixed,
    statusClosedBg,
    fontDisplay,
    fontBody,
    fontMono,
    easeStamp,
    zBanner,
    fabSize,
  } = v;

  const { sizeBody, lineBody } = MUSHI_TYPE;
  const { durationFast } = MUSHI_MOTION;
  const { bannerHeight, gutter, panelWidth, panelMaxHeight, panelSheetBreakpoint, edgeTabWidth } = MUSHI_GEOMETRY;
  const panelLauncherGap = fabSize + 12;
  const { base: zBase } = MUSHI_Z;
  const controlRadius = MUSHI_RADIUS.control;

  return `
    :host {
      all: initial;
      font-family: ${fontBody};
      font-size: ${sizeBody}px;
      line-height: ${lineBody};
      color: ${ink};
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: 'ss01', 'cv11'; /* nicer system-ui glyphs where supported */
      --mushi-ok: ${ok};
      /* SDK contract: the host element is always pass-through. Only the
         interactive surfaces (.mushi-trigger, .mushi-banner, .mushi-panel)
         opt back into pointer events so the widget never creates an
         invisible touch blocker over host-app UI. */
      pointer-events: none;
    }
    /* Only actual widget controls receive touch/mouse events. */
    .mushi-trigger,
    .mushi-banner,
    .mushi-panel {
      pointer-events: auto;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    button { font-family: inherit; }

    .mushi-trigger {
      position: fixed;
      width: ${fabSize}px;
      height: ${fabSize}px;
      border: 1px solid ${ruleStrong};
      border-radius: ${controlRadius}px;
      background: ${paper};
      color: ${ink};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ${fontDisplay};
      font-size: 22px;
      line-height: 1;
      box-shadow:
        0 1px 0 ${rule},
        0 6px 14px -8px rgba(14,13,11,0.35),
        inset 0 -3px 0 ${widgetAccent};
      transition: transform ${durationFast}ms ${easeStamp}, box-shadow ${durationFast}ms ${easeStamp};
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
      background: ${widgetAccent};
      box-shadow: 0 0 0 0 ${widgetAccent};
      animation: mushi-pulse 2.4s ${easeStamp} infinite;
    }
    .mushi-trigger:hover {
      transform: translateY(-2px) rotate(-1.5deg);
      box-shadow:
        0 1px 0 ${rule},
        0 14px 24px -10px rgba(14,13,11,0.45),
        inset 0 -3px 0 ${widgetAccent};
    }
    .mushi-trigger:active {
      transform: translateY(0) rotate(0);
      box-shadow:
        0 1px 0 ${rule},
        0 2px 4px -2px rgba(14,13,11,0.35),
        inset 0 -2px 0 ${widgetAccent};
    }
    .mushi-trigger:focus-visible {
      outline: 2px solid ${widgetAccent};
      outline-offset: 3px;
    }
    /* First-session welcome pulse. Three soft halos at 800ms each, then
       auto-clear. Uses a box-shadow ring rather than transform/scale so it
       can compose with the hover transform without fighting it. Respects
       prefers-reduced-motion. */
    @keyframes mushi-trigger-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(212, 67, 50, 0.55), 0 1px 0 ${rule}, 0 10px 24px -14px rgba(14,13,11,0.45); }
      70%  { box-shadow: 0 0 0 16px rgba(212, 67, 50, 0), 0 1px 0 ${rule}, 0 10px 24px -14px rgba(14,13,11,0.45); }
      100% { box-shadow: 0 0 0 0 rgba(212, 67, 50, 0), 0 1px 0 ${rule}, 0 10px 24px -14px rgba(14,13,11,0.45); }
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
      border-radius: 4px 0 0 4px;
      writing-mode: vertical-rl;
      text-orientation: upright;
      font-size: 16px;
      box-shadow:
        0 1px 0 ${rule},
        0 10px 24px -14px rgba(14,13,11,0.45),
        inset -3px 0 0 ${widgetAccent};
    }
    .mushi-trigger.edge-tab.bottom-right,
    .mushi-trigger.edge-tab.top-right {
      right: var(--mushi-right, 0);
    }
    .mushi-trigger.edge-tab.bottom-left,
    .mushi-trigger.edge-tab.top-left {
      left: var(--mushi-left, 0);
      border-radius: 0 4px 4px 0;
      box-shadow:
        0 1px 0 ${rule},
        0 10px 24px -14px rgba(14,13,11,0.45),
        inset 3px 0 0 ${widgetAccent};
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
      z-index: calc(var(--z, ${zBase}) + 2);
      transition: none !important;
      box-shadow:
        0 1px 0 ${rule},
        0 20px 40px -12px rgba(14,13,11,0.55),
        inset 0 -3px 0 ${widgetAccent};
      opacity: 0.92;
    }
    @media (prefers-reduced-motion: reduce) {
      .mushi-trigger { transition: none !important; }
    }

    @keyframes mushi-pulse {
      0%   { box-shadow: 0 0 0 0 ${widgetAccent}; opacity: 1; }
      70%  { box-shadow: 0 0 0 8px ${widgetAccent}00; opacity: 0.5; }
      100% { box-shadow: 0 0 0 0 ${widgetAccent}00; opacity: 1; }
    }

    .mushi-panel {
      position: fixed;
      width: ${panelWidth}px;
      max-width: calc(100vw - ${MUSHI_SPACING.wide}px);
      max-height: min(${panelMaxHeight}px, calc(100dvh - 120px - var(--mushi-keyboard-inset, 0px)));
      background: ${paper};
      border: 1px solid ${ruleStrong};
      border-radius: 6px;
      box-shadow:
        0 1px 0 ${rule},
        0 24px 56px -20px rgba(14,13,11,0.30),
        0 8px 16px -8px rgba(14,13,11,0.20);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform-origin: var(--mushi-origin, bottom right);
      transition: bottom 120ms ease, top 120ms ease, max-height 120ms ease;
    }
    /* Keyboard-safe: on narrow viewports lift above the keyboard */
    .mushi-panel.keyboard-open {
      bottom: calc(var(--mushi-keyboard-inset, 0px) + 8px) !important;
    }
    /* On narrow mobile, fill the width as a bottom sheet */
    @media (max-width: ${panelSheetBreakpoint}px) {
      .mushi-panel {
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        bottom: var(--mushi-keyboard-inset, 0px) !important;
      }
      .mushi-panel.keyboard-open {
        bottom: calc(var(--mushi-keyboard-inset, 0px) + 4px) !important;
      }
    }
    .mushi-panel.open  { animation: mushi-stamp-in 320ms ${easeStamp} both; }
    .mushi-panel.closed { display: none; }
    .mushi-panel.bottom-right {
      bottom: var(--mushi-panel-bottom, calc(var(--mushi-bottom, ${gutter}px) + ${panelLauncherGap}px));
      right: var(--mushi-right, calc(${gutter}px + env(safe-area-inset-right, 0px)));
      --mushi-origin: bottom right;
    }
    .mushi-panel.bottom-left  {
      bottom: var(--mushi-panel-bottom, calc(var(--mushi-bottom, ${gutter}px) + ${panelLauncherGap}px));
      left: var(--mushi-left, calc(${gutter}px + env(safe-area-inset-left, 0px)));
      --mushi-origin: bottom left;
    }
    .mushi-panel.top-right    {
      top: var(--mushi-panel-top, calc(var(--mushi-top, ${gutter}px) + ${panelLauncherGap}px));
      right: var(--mushi-right, calc(${gutter}px + env(safe-area-inset-right, 0px)));
      --mushi-origin: top right;
    }
    .mushi-panel.top-left     {
      top: var(--mushi-panel-top, calc(var(--mushi-top, ${gutter}px) + ${panelLauncherGap}px));
      left: var(--mushi-left, calc(${gutter}px + env(safe-area-inset-left, 0px)));
      --mushi-origin: top left;
    }
    .mushi-outdated {
      margin: 12px 14px 0;
      padding: 10px 12px;
      border: 1px solid ${widgetAccentWash};
      background: ${widgetAccentWash};
      color: ${widgetAccentInk};
      font-family: ${fontBody};
      font-size: 12px;
      line-height: 1.4;
    }
    .mushi-outdated strong {
      display: block;
      font-family: ${fontMono};
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .mushi-outdated span {
      display: block;
      margin-top: 3px;
      color: ${inkMuted};
    }

    @keyframes mushi-stamp-in {
      0%   { opacity: 0; transform: scale(0.94) translateY(6px); }
      60%  { opacity: 1; }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }

    .mushi-header {
      padding: 13px 18px 10px;
      border-bottom: 1px solid ${rule};
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: end;
      gap: 10px;
    }
    .mushi-header-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 3px;
      background: ${widgetAccent};
      color: ${onAccent};
      font-family: ${fontDisplay};
      font-size: 14px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: -0.02em;
      transform: rotate(-3deg);
      flex-shrink: 0;
    }
    .mushi-header-titles {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mushi-header-eyebrow {
      font-family: ${fontMono};
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: ${inkMuted};
    }
    .mushi-header h3 {
      font-family: ${fontDisplay};
      font-size: 19px;
      font-weight: 500;
      line-height: 1.15;
      letter-spacing: -0.01em;
      color: ${ink};
    }
    .mushi-header-meta {
      align-self: start;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .mushi-step-counter {
      font-family: ${fontMono};
      font-size: 11px;
      color: ${inkMuted};
      letter-spacing: 0.06em;
      tab-size: 2ch;
      padding-top: 2px;
    }
    .mushi-step-counter b {
      font-weight: 600;
      color: ${ink};
    }
    .mushi-close {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px 4px;
      color: ${inkMuted};
      font-family: ${fontBody};
      font-size: 16px;
      line-height: 1;
      border-radius: 0;
      transition: color 150ms ${easeStamp};
    }
    .mushi-back {
      align-self: flex-start;
      background: none;
      border: none;
      cursor: pointer;
      padding: 3px 0;
      margin: 0 0 2px;
      min-height: 22px;
      color: ${inkMuted};
      font-family: ${fontMono};
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1.2;
      border-radius: 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: color 150ms ${easeStamp};
      white-space: nowrap;
    }
    .mushi-close:hover { color: ${widgetAccent}; }
    .mushi-back:hover { color: ${ink}; }
    .mushi-close:focus-visible {
      outline: 1.5px solid ${widgetAccent};
      outline-offset: 2px;
    }
    .mushi-back:focus-visible {
      outline: none;
      color: ${widgetAccent};
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    /* ── Body ───────────────────────────────────────────────────────
       Generous left/right padding (22px) so type breathes. Vertical
       padding tighter at top because the header rule already creates
       breathing room. */
    .mushi-body {
      padding: 8px 22px 16px;
      overflow-y: auto;
      flex: 1;
      scrollbar-width: thin;
      scrollbar-color: ${inkFaint} transparent;
    }
    .mushi-body::-webkit-scrollbar { width: 6px; }
    .mushi-body::-webkit-scrollbar-thumb { background: ${inkFaint}; border-radius: 3px; }

    .mushi-option-btn {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 11px 0;
      border: none;
      border-bottom: 1px solid ${rule};
      background: transparent;
      cursor: pointer;
      color: inherit;
      text-align: left;
      transition: padding 220ms ${easeStamp}, color 220ms ${easeStamp};
      position: relative;
    }
    .mushi-option-btn:last-child { border-bottom: none; }
    .mushi-option-btn:hover { padding-left: 6px; color: ${widgetAccent}; }
    .mushi-option-btn:hover .mushi-option-arrow { opacity: 1; transform: translateX(0); color: ${widgetAccent}; }
    .mushi-option-btn:focus-visible {
      outline: none;
      padding-left: 6px;
      box-shadow: inset 2px 0 0 ${widgetAccent};
    }
    .mushi-option-icon {
      font-size: 18px;
      line-height: 1;
      flex-shrink: 0;
      filter: ${isDark ? 'none' : 'grayscale(0.15)'};
    }
    .mushi-option-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .mushi-option-label {
      font-family: ${fontDisplay};
      font-size: 16px;
      font-weight: 500;
      letter-spacing: -0.005em;
      line-height: 1.2;
    }
    .mushi-option-desc {
      font-size: 12px;
      color: ${inkMuted};
      letter-spacing: 0.005em;
    }
    .mushi-option-arrow {
      font-family: ${fontMono};
      font-size: 14px;
      color: ${inkFaint};
      opacity: 0;
      transform: translateX(-4px);
      transition: opacity 220ms ${easeStamp}, transform 220ms ${easeStamp}, color 220ms ${easeStamp};
    }
    /* Feature-request and Reports-inbox entries sit above the five
       category cards as discoverable shortcuts. We give them a subtle
       left rule so the eye reads them as a separate group rather than
       "another category". The shortcut group has zero hover indent
       overshoot — we want them quiet until intent. */
    .mushi-feature-entry,
    .mushi-reports-entry {
      padding-left: 10px;
      border-left: 2px solid ${inkFaint};
      transition: padding 220ms ${easeStamp}, color 220ms ${easeStamp}, border-color 220ms ${easeStamp};
    }
    .mushi-feature-entry:hover,
    .mushi-reports-entry:hover {
      border-left-color: ${widgetAccent};
      padding-left: 14px;
    }
    .mushi-feature-entry .mushi-option-icon {
      filter: none;
    }
    .mushi-report-row {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
      padding: 12px 4px 12px 0;
      border: 0;
      border-bottom: 1px solid ${rule};
      background: transparent;
      color: ${ink};
      cursor: pointer;
      text-align: left;
      transition: background 180ms ${easeStamp}, padding-left 180ms ${easeStamp};
    }
    .mushi-report-row:hover,
    .mushi-report-row:focus-visible {
      background: ${isDark ? 'rgba(242,235,221,0.04)' : 'rgba(14,13,11,0.03)'};
      padding-left: 4px;
    }
    .mushi-report-main {
      min-width: 0;
      display: grid;
      gap: 6px;
    }
    .mushi-report-title {
      font-size: 13px;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .mushi-report-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .mushi-report-status {
      display: inline-flex;
      align-items: center;
      font-family: ${fontMono};
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid transparent;
    }
    .mushi-status-sent {
      color: ${statusSent.fg};
      background: ${statusSent.bg};
      border-color: ${statusSent.border};
    }
    .mushi-status-review {
      color: ${statusReview.fg};
      background: ${statusReview.bg};
      border-color: ${statusReview.border};
    }
    .mushi-status-fixing {
      color: ${statusFixing.fg};
      background: ${statusFixing.bg};
      border-color: ${statusFixing.border};
    }
    .mushi-status-fixed {
      color: ${statusFixed.fg};
      background: ${statusFixed.bg};
      border-color: ${statusFixed.border};
    }
    .mushi-status-closed,
    .mushi-status-unknown {
      color: ${inkMuted};
      background: ${statusClosedBg};
      border-color: ${ruleStrong};
    }
    .mushi-report-when {
      font-family: ${fontMono};
      font-size: 10px;
      color: ${inkFaint};
    }
    .mushi-unread-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      font-family: ${fontMono};
      font-size: 10px;
      font-weight: 700;
      color: ${widgetAccentInk};
      background: ${widgetAccent};
    }
    .mushi-report-chevron {
      font-size: 18px;
      line-height: 1;
      color: ${inkFaint};
      transition: color 180ms ${easeStamp}, transform 180ms ${easeStamp};
    }
    .mushi-report-row:hover .mushi-report-chevron,
    .mushi-report-row:focus-visible .mushi-report-chevron {
      color: ${widgetAccent};
      transform: translateX(2px);
    }
    .mushi-thread-summary {
      border-bottom: 1px solid ${rule};
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .mushi-thread-summary-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .mushi-thread {
      display: grid;
      gap: 8px;
      max-height: 180px;
      overflow: auto;
      margin-bottom: 12px;
    }
    .mushi-thread-comment {
      padding: 8px 10px;
      border: 1px solid ${rule};
      background: ${isDark ? 'rgba(242,235,221,0.04)' : 'rgba(14,13,11,0.03)'};
    }
    .mushi-thread-comment.reporter {
      border-color: ${widgetAccentWash};
      background: ${widgetAccentWash};
    }
    .mushi-thread-comment strong {
      display: block;
      font-family: ${fontMono};
      font-size: 10px;
      letter-spacing: 0.04em;
      margin-bottom: 3px;
    }
    .mushi-thread-comment p,
    .mushi-muted,
    .mushi-error-inline {
      font-size: 12px;
      color: ${inkMuted};
      line-height: 1.45;
    }
    .mushi-error-inline { color: ${widgetAccent}; }

    .mushi-selected-category {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px 6px 12px;
      border-left: 2px solid ${widgetAccent};
      background: ${widgetAccentWash};
      color: ${widgetAccentInk};
      font-family: ${fontDisplay};
      font-size: 13px;
      margin: 4px 0 14px;
      border-radius: 0 3px 3px 0;
    }
    .mushi-selected-category span:first-child { font-size: 14px; }
    .mushi-intents {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mushi-intents .mushi-option-btn {
      grid-template-columns: 1fr auto;
    }

    /* Example starter chips — reduce first-report activation energy */
    .mushi-example-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .mushi-example-chip {
      padding: 4px 10px;
      border: 1px solid ${rule};
      border-radius: 12px;
      background: transparent;
      color: ${inkMuted};
      font-family: ${fontBody};
      font-size: 11px;
      cursor: pointer;
      transition: color 150ms ${easeStamp}, border-color 150ms ${easeStamp}, background 150ms ${easeStamp};
      white-space: nowrap;
    }
    .mushi-example-chip:hover {
      color: ${ink};
      border-color: ${inkMuted};
      background: ${isDark ? 'rgba(242,235,221,0.06)' : 'rgba(14,13,11,0.04)'};
    }
    .mushi-example-chip:focus-visible {
      outline: 2px solid ${widgetAccent};
      outline-offset: 2px;
    }

    /* Textarea wrapper to position char counter */
    .mushi-textarea-wrap {
      position: relative;
    }
    .mushi-char-counter {
      position: absolute;
      bottom: 4px;
      right: 0;
      font-family: ${fontMono};
      font-size: 10px;
      letter-spacing: 0.04em;
      color: ${inkFaint};
      pointer-events: none;
      transition: color 200ms ${easeStamp};
    }

    .mushi-textarea {
      width: 100%;
      min-height: 96px;
      padding: 8px 0 10px;
      border: none;
      border-bottom: 1px solid ${ruleStrong};
      background: transparent;
      color: ${ink};
      font-family: ${fontBody};
      font-size: 14px;
      line-height: 1.5;
      resize: vertical;
      outline: none;
      transition: border-color 200ms ${easeStamp};
    }
    .mushi-textarea::placeholder {
      color: ${inkFaint};
      font-style: italic;
    }
    .mushi-textarea:focus { border-bottom-color: ${widgetAccent}; }

    .mushi-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
    }
    .mushi-attach-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border: 1px solid ${ruleStrong};
      border-radius: 3px;
      background: transparent;
      color: ${inkMuted};
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
      transition: color 180ms ${easeStamp}, border-color 180ms ${easeStamp}, background 180ms ${easeStamp};
    }
    .mushi-attach-btn:hover {
      color: ${ink};
      border-color: ${ink};
    }
    .mushi-attach-btn.active {
      color: ${widgetAccent};
      border-color: ${widgetAccent};
      background: ${widgetAccentWash};
    }
    .mushi-attach-btn.danger {
      color: ${widgetAccentInk};
      border-color: ${widgetAccentWash};
      background: transparent;
    }
    .mushi-attach-btn.danger:hover {
      color: ${widgetAccent};
      border-color: ${widgetAccent};
      background: ${widgetAccentWash};
    }
    .mushi-attach-btn.loading {
      opacity: 0.7;
      cursor: wait;
    }
    .mushi-attach-btn.error {
      color: ${widgetAccent};
      border-color: ${widgetAccentWash};
    }
    .mushi-attach-btn:focus-visible {
      outline: 2px solid ${widgetAccent};
      outline-offset: 2px;
    }
    .mushi-annotate-host {
      flex-basis: 100%;
      margin-top: 8px;
    }
    .mushi-annotate-host:empty {
      margin-top: 0;
    }
    .mushi-screenshot-preview {
      margin: 10px 0 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .mushi-screenshot-preview img {
      display: block;
      max-width: 100%;
      max-height: 160px;
      width: auto;
      border: 1px solid ${ruleStrong};
      border-radius: 3px;
      object-fit: contain;
      align-self: flex-start;
    }
    .mushi-screenshot-hint {
      margin: 0;
      color: ${inkMuted};
      font-family: ${fontMono};
      font-size: 10.5px;
      line-height: 1.4;
      letter-spacing: 0.02em;
    }
    .mushi-identified-user {
      margin: 8px 0 0;
      font-size: 11.5px;
      color: ${inkMuted};
      line-height: 1.4;
    }
    .mushi-identified-user strong {
      color: ${ink};
      font-weight: 600;
    }
    .mushi-annotate-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    @keyframes mushi-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes mushi-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .mushi-spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 1.5px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: mushi-spin 0.7s linear infinite;
    }

    .mushi-footer {
      padding: 14px 22px 16px;
      border-top: 1px solid ${rule};
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .mushi-footer-hint {
      font-family: ${fontMono};
      font-size: 10px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: ${inkFaint};
    }
    .mushi-submit {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border: 1px solid ${widgetAccent};
      border-radius: 3px;
      background: ${widgetAccent};
      color: ${onAccent};
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      cursor: pointer;
      overflow: hidden;
      transition: transform 180ms ${easeStamp}, box-shadow 180ms ${easeStamp};
      box-shadow: 0 2px 0 ${widgetAccentShadow};
    }
    .mushi-submit::after {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at center, rgba(255,255,255,0.35) 0%, transparent 60%);
      opacity: 0;
      transform: scale(0.4);
      transition: opacity 280ms ${easeStamp}, transform 380ms ${easeStamp};
      pointer-events: none;
    }
    .mushi-submit:hover {
      transform: translateY(-1px);
      box-shadow: 0 3px 0 ${widgetAccentShadow};
    }
    .mushi-submit:hover::after { opacity: 1; transform: scale(1.4); }
    .mushi-submit:active { transform: translateY(1px); box-shadow: 0 1px 0 ${widgetAccentShadow}; }
    .mushi-submit:disabled {
      cursor: wait;
      opacity: 0.7;
    }
    .mushi-submit:focus-visible {
      outline: 2px solid ${widgetAccent};
      outline-offset: 3px;
    }
    .mushi-submit-arrow {
      display: inline-block;
      transition: transform 220ms ${easeStamp};
    }
    .mushi-submit:hover .mushi-submit-arrow { transform: translateX(3px); }

    .mushi-brand-footer {
      padding: 9px 14px 11px;
      border-top: 1px solid ${rule};
      color: ${inkFaint};
      font-family: ${fontMono};
      font-size: 9px;
      letter-spacing: 0.16em;
      text-align: center;
      text-transform: uppercase;
    }

    .mushi-step-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 22px 14px;
      color: ${inkFaint};
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.10em;
    }
    .mushi-step-num {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      transition: color 200ms ${easeStamp};
    }
    .mushi-step-num.done { color: ${inkMuted}; text-decoration: line-through; text-decoration-color: ${inkFaint}; }
    .mushi-step-num.active {
      color: ${widgetAccent};
      font-family: ${fontDisplay};
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0;
    }
    .mushi-step-sep { width: 14px; height: 1px; background: ${rule}; }

    .mushi-success {
      text-align: center;
      padding: 28px 16px 20px;
    }
    .mushi-success-stamp {
      position: relative;
      width: 96px;
      height: 96px;
      margin: 0 auto 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .mushi-success-stamp svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .mushi-success-stamp circle {
      fill: none;
      stroke: ${widgetAccent};
      stroke-width: 3;
      stroke-dasharray: 280;
      stroke-dashoffset: 280;
      transform: rotate(-90deg);
      transform-origin: center;
      animation: mushi-stamp-ring 700ms ${easeStamp} 80ms forwards;
    }
    .mushi-success-stamp-label {
      font-family: ${fontDisplay};
      font-size: 18px;
      font-weight: 600;
      color: ${widgetAccent};
      letter-spacing: 0.04em;
      transform: rotate(-6deg);
      opacity: 0;
      animation: mushi-stamp-press 360ms ${easeStamp} 600ms forwards;
    }
    .mushi-success-headline {
      font-family: ${fontDisplay};
      font-size: 18px;
      font-weight: 500;
      color: ${ink};
      margin-bottom: 4px;
    }
    .mushi-success-meta {
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: ${inkMuted};
    }

    /* ── Two-way receipt (success step) ──────────────────────────── */
    /* The receipt block sits below the stamp/meta. Three states:    */
    /*   1. delivering... (spinner pill, while host onSubmit awaits) */
    /*   2. confirmed     (Receipt id + Track on Mushi link)  */
    /*   3. queued offline (warn pill — degrade gracefully)          */
    .mushi-success-receipt {
      margin-top: 14px;
      width: 100%;
      max-width: 280px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: stretch;
    }
    .mushi-success-receipt-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.05em;
      color: ${inkMuted};
    }
    .mushi-success-receipt-label {
      text-transform: uppercase;
      letter-spacing: 0.10em;
      color: ${inkMuted};
    }
    .mushi-success-receipt-id {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 4px;
      background: transparent;
      border: 1px dashed ${rule};
      color: inherit;
      font-family: ${fontMono};
      font-size: 12px;
      letter-spacing: 0.02em;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .mushi-success-receipt-id:hover,
    .mushi-success-receipt-id:focus-visible {
      background: rgba(217, 65, 47, 0.06);
      border-color: ${widgetAccent};
      color: ${widgetAccent};
      outline: none;
    }
    .mushi-success-receipt-copy {
      font-size: 11px;
      opacity: 0.7;
    }
    .mushi-success-receipt-track {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 6px 10px;
      border-radius: 4px;
      background: ${widgetAccent};
      color: ${inverse};
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      text-decoration: none;
      transition: filter 120ms ease;
    }
    .mushi-success-receipt-track:hover,
    .mushi-success-receipt-track:focus-visible {
      filter: brightness(0.95);
      outline: none;
    }
    .mushi-success-receipt-spinner {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      border: 1.5px solid ${rule};
      border-top-color: ${widgetAccent};
      animation: mushi-receipt-spin 0.8s linear infinite;
    }
    @keyframes mushi-receipt-spin {
      to { transform: rotate(360deg); }
    }
    .mushi-success-receipt-hint {
      color: ${inkMuted};
      font-style: italic;
    }
    .mushi-success-receipt-warn {
      color: ${widgetAccent};
    }
    .mushi-success-my-reports {
      display: block;
      margin: 12px auto 0;
      font-size: 12px;
      font-family: ${fontMono};
      color: ${widgetAccent};
      text-decoration: underline;
      text-underline-offset: 2px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 2px;
    }
    .mushi-success-my-reports:hover { opacity: 0.75; }
    .mushi-success-sla {
      margin-top: 2px;
      font-family: ${fontDisplay};
      font-size: 12px;
      line-height: 1.45;
      text-align: center;
      color: ${inkMuted};
      max-width: 260px;
    }
    .mushi-success-sla-default {
      opacity: 0.85;
    }

    @keyframes mushi-stamp-ring {
      to { stroke-dashoffset: 0; }
    }
    @keyframes mushi-stamp-press {
      0%   { opacity: 0; transform: rotate(-6deg) scale(1.3); }
      60%  { opacity: 1; transform: rotate(-6deg) scale(0.94); }
      100% { opacity: 1; transform: rotate(-6deg) scale(1); }
    }

    .mushi-error {
      margin-top: 10px;
      padding: 8px 0 8px 10px;
      border-left: 2px solid ${widgetAccent};
      color: ${widgetAccent};
      font-size: 12px;
      font-family: ${fontMono};
      letter-spacing: 0.02em;
    }

    /* ── Rewards nudge (category step) ───────────────────────────── */
    .mushi-rewards-nudge {
      border-top: 1px solid ${rule};
      padding: 10px 0 4px;
      margin-top: 6px;
    }
    .mushi-rewards-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .mushi-tier-pip {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .mushi-rewards-tier-name {
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${ink};
    }
    .mushi-rewards-pts-count {
      font-family: ${fontMono};
      font-size: 11px;
      color: ${inkMuted};
      margin-right: auto;
    }
    .mushi-rewards-pts-earn {
      font-family: ${fontMono};
      font-size: 10px;
      color: ${widgetAccent};
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .mushi-tier-bar-track {
      height: 3px;
      background: ${ruleStrong};
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 5px;
    }
    .mushi-tier-bar-fill {
      height: 100%;
      background: ${widgetAccent};
      border-radius: 2px;
      transition: width 600ms ${easeStamp};
    }
    .mushi-rewards-next-label {
      font-family: ${fontMono};
      font-size: 10px;
      color: ${inkMuted};
      text-align: right;
      letter-spacing: 0.02em;
    }

    /* ── Rewards on success step ─────────────────────────────────── */
    .mushi-success-rewards {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid ${rule};
      width: 100%;
    }
    .mushi-success-pts-award {
      font-family: ${fontMono};
      font-size: 22px;
      font-weight: 700;
      color: ${widgetAccent};
      text-align: center;
      letter-spacing: 0.06em;
      margin-bottom: 10px;
      opacity: 0;
      animation: mushi-pts-pop 420ms ${easeStamp} 900ms forwards;
    }
    .success-bar { margin: 0 0 5px; }

    @keyframes mushi-pts-pop {
      from { opacity: 0; transform: scale(0.75) translateY(6px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* ─── Beta mode strip (category step) ─────────────────────────────── */
    /* Brand palette: widgetAccent (vermillion) + washi ink for the strip.
       The previous generic indigo purple is the single most recognisable AI-template
       colour; replaced with the widget's own vermillion wash so the beta panel
       reads as a Mushi-native surface rather than a generic SaaS plug-in. */

    .mushi-beta-strip {
      margin: 0 16px 2px;
      padding: 9px 12px;
      background: ${widgetAccentWash};
      border: 1px solid ${isDark ? 'rgba(255,90,71,0.22)' : 'rgba(224,60,44,0.16)'};
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .mushi-beta-strip-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .mushi-beta-tag {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 3px;
      background: ${widgetAccent};
      color: ${onAccent};
      font-family: ${fontMono};
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.14em;
      line-height: 1.6;
      white-space: nowrap;
      flex-shrink: 0;
      text-transform: uppercase;
    }

    .mushi-beta-msg {
      font-size: 11px;
      color: ${inkMuted};
      line-height: 1.45;
    }

    .mushi-beta-contact-hint {
      font-size: 10px;
      color: ${inkFaint};
      font-family: ${fontMono};
      letter-spacing: 0.06em;
    }

    .mushi-beta-perks {
      list-style: none;
      margin: 2px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .mushi-beta-perks li {
      font-size: 12px;
      color: ${widgetAccentInk};
      font-weight: 500;
    }

    /* ─── Beta changelog (collapsible What's new) ──────────────────────── */

    .mushi-changelog {
      margin-top: 5px;
    }

    .mushi-changelog-summary {
      font-size: 11px;
      color: ${inkDim};
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 4px;
      user-select: none;
    }

    .mushi-changelog-summary::before {
      content: '▶';
      font-size: 7px;
      opacity: 0.6;
      transition: transform 0.15s ease;
    }

    .mushi-changelog[open] .mushi-changelog-summary::before {
      transform: rotate(90deg);
    }

    .mushi-changelog-list {
      margin: 5px 0 0 4px;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .mushi-changelog-list li {
      font-size: 11px;
      color: ${inkDim};
      line-height: 1.5;
    }

    /* ─── Beta success footer ───────────────────────────────────────────── */

    .mushi-beta-success-footer {
      margin-top: 14px;
      padding: 10px 14px;
      background: ${widgetAccentWash};
      border: 1px solid ${isDark ? 'rgba(255,90,71,0.18)' : 'rgba(224,60,44,0.14)'};
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      text-align: left;
    }

    .mushi-beta-success-line {
      font-size: 12px;
      color: ${widgetAccentInk};
      line-height: 1.5;
    }

    .mushi-beta-success-dim {
      opacity: 0.65;
      font-size: 12px;
    }

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
      animation: mushi-banner-slide-in 0.3s ${easeStamp} both;
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
      transition: opacity 0.15s ease;
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
      transition: background 0.15s ease, opacity 0.15s ease;
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
      transition: opacity 0.15s, background 0.15s;
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
      transition: opacity 0.15s, background 0.15s;
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
      *,
      *::before,
      *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
      .mushi-success-stamp circle { stroke-dashoffset: 0; }
      .mushi-success-stamp-label { opacity: 1; }
      .mushi-success-pts-award { opacity: 1; }
    }

    .mushi-community-footer{display:flex;align-items:center;gap:8px;padding:10px 0 2px;border-top:1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'};margin-top:8px;flex-wrap:wrap}
    .mushi-community-btn{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mushi-section-label{
      margin:0 0 6px;
      font-family:${fontMono};
      font-size:11px;
      letter-spacing:0.06em;
      text-transform:uppercase;
      color:${inkFaint};
    }
    .mushi-more-nav{margin-top:4px}
    .mushi-more-nav-panel{display:flex;flex-direction:column;gap:0;border-top:1px dashed ${rule};padding-top:2px}
    .mushi-more-nav-link{align-self:flex-start;margin:6px 0 2px;padding:0}
    /* ── "More issue types →" toggle (progressive disclosure) ─────── */
    .mushi-more-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 11px 0;
      border: none;
      border-top: 1px dashed ${rule};
      background: transparent;
      cursor: pointer;
      color: ${inkMuted};
      font-family: ${fontBody};
      font-size: 13px;
      text-align: left;
      transition: color 180ms ${easeStamp};
    }
    .mushi-more-toggle:hover { color: ${widgetAccent}; }
    .mushi-more-toggle:hover .mushi-more-toggle-arrow { transform: translateX(3px); }
    .mushi-more-toggle-text { flex: 1; }
    .mushi-more-toggle-count {
      font-family: ${fontMono};
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${inkFaint};
      background: ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'};
      padding: 2px 6px;
      border-radius: 10px;
    }
    .mushi-more-toggle-arrow {
      font-size: 14px;
      opacity: 0.5;
      transition: transform 180ms ${easeStamp};
    }
    /* ── Step slide-in ────────────────────────────────────────────── */
    @keyframes mushi-step-in {
      0%   { opacity: 0; transform: translateX(8px); }
      100% { opacity: 1; transform: translateX(0); }
    }
    .mushi-body {
      animation: mushi-step-in 160ms ease both;
    }
    @media (prefers-reduced-motion: reduce) {
      .mushi-body { animation: none; }
    }
    /* Expanded secondary categories animate in */
    .mushi-categories-expanded {
      animation: mushi-step-in 180ms ease both;
    }
    .mushi-link-btn{background:none;border:none;padding:4px 2px;cursor:pointer;color:${widgetAccent};font-size:12px;font-family:${fontMono};text-decoration:underline;text-underline-offset:2px}
    .mushi-link-btn:hover{opacity:0.8}
    .mushi-link-btn:focus-visible,.mushi-nav-item:focus-visible{outline:2px solid ${widgetAccent};outline-offset:2px;border-radius:2px}
    .mushi-nav-item{display:block;width:100%;text-align:left;background:${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'};border:1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};border-radius:8px;padding:10px 14px;margin-bottom:8px;cursor:pointer;font-size:13px;color:${ink};transition:background .15s,border-color .15s}
    .mushi-nav-item:hover{background:${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'}}
    .mushi-account-card{display:flex;align-items:center;gap:12px;background:${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'};border-radius:10px;padding:12px 14px;margin-bottom:14px}
    .mushi-account-avatar{width:40px;height:40px;border-radius:50%;background:${widgetAccentWash};color:${widgetAccentInk};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0}
    .mushi-account-info{display:flex;flex-direction:column;gap:2px;min-width:0}
    .mushi-account-info strong{font:700 14px/1.3 inherit;color:${ink}}
    .mushi-account-rank,.mushi-xapp-app-name,.mushi-label{font-size:12px;color:${inkDim};font-family:${fontMono}}
    .mushi-account-rank{display:block}
    .mushi-xapp-app-head{display:flex;align-items:center;gap:8px;margin:0 0 6px}
    .mushi-xapp-app-name{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin:0}
    .mushi-app-icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;border:1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'};background:${paperRaised};overflow:hidden;flex-shrink:0}
    .mushi-app-icon-img{display:block;width:16px;height:16px;object-fit:contain}
    .mushi-app-icon-initials{font-size:9px;font-weight:700;color:${inkDim};line-height:1}
    .mushi-app-icon-initials-only{background:${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}}
    .mushi-header-host-icon{display:block;width:20px;height:20px;border-radius:4px;object-fit:contain}
    .mushi-xapp-group{margin-bottom:14px}
    .mushi-label{display:block;font-weight:600;margin-bottom:6px}

    /* ── Assistant tab (P5) ──────────────────────────────────────── */
    .mushi-assistant{display:flex;flex-direction:column;height:100%;min-height:0;max-height:60vh}
    .mushi-assistant-log{flex:1;min-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px 8px}
    .mushi-assistant-greeting{font:400 14px/1.5 ${fontBody};color:${inkMuted};padding:6px 2px}
    .mushi-assistant-suggestions{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
    .mushi-assistant-chip{background:${widgetAccentWash};color:${widgetAccentInk};border:1px solid ${ruleStrong};border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:${fontBody};transition:background .15s}
    .mushi-assistant-chip:hover{background:${isDark ? 'rgba(255,90,71,0.22)' : 'rgba(224,60,44,0.14)'}}
    .mushi-assistant-chip:focus-visible{outline:2px solid ${widgetAccent};outline-offset:2px}
    .mushi-assistant-msg{max-width:85%;padding:8px 12px;border-radius:12px;font:400 14px/1.45 ${fontBody};white-space:pre-wrap;word-break:break-word}
    .mushi-assistant-msg-user{align-self:flex-end;background:${widgetAccent};color:${inverse};border-bottom-right-radius:4px}
    .mushi-assistant-msg-bot{align-self:flex-start;background:${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'};color:${ink};border-bottom-left-radius:4px}
    .mushi-assistant-thinking{opacity:0.6;font-size:18px;letter-spacing:2px}
    .mushi-assistant-error{align-self:flex-start;color:${danger};font-size:12px;padding:4px 2px}
    .mushi-assistant-form{display:flex;align-items:flex-end;gap:8px;border-top:1px solid ${rule};padding-top:8px}
    .mushi-assistant-input{flex:1;resize:none;max-height:120px;border:1px solid ${ruleStrong};border-radius:10px;padding:8px 12px;font:400 14px/1.4 ${fontBody};background:${paper};color:${ink}}
    .mushi-assistant-input:focus-visible{outline:2px solid ${widgetAccent};outline-offset:1px}
    .mushi-assistant-submit{flex-shrink:0;width:36px;height:36px;border:none;border-radius:50%;background:${widgetAccent};color:${inverse};font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s,opacity .15s}
    .mushi-assistant-submit:hover{transform:translateY(-1px)}
    .mushi-assistant-submit:disabled{opacity:0.5;cursor:default;transform:none}
    .mushi-assistant-submit:focus-visible{outline:2px solid ${widgetAccent};outline-offset:2px}
  `;
}
