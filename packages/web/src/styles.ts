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
 *     • VERMILLION 朱   — `widgetAccent` (#E03C2C) used as a hanko stamp colour.
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

export function getWidgetStyles(theme: 'light' | 'dark'): string {
  const isDark = theme === 'dark';

  /* ── Tokens ──────────────────────────────────────────────────────────
     Named for the material they evoke (paper, ink, rule, widgetAccent)
     rather than the role (background, text, border) so the palette is
     hard to dilute with a generic "primary/secondary" rename later. */

  const paper        = isDark ? '#0F0E0C' : '#F8F4ED';   // washi cream / dark wash
  const ink          = isDark ? '#F2EBDD' : '#0E0D0B';   // sumi black / cream type
  const inkMuted     = isDark ? '#928B7E' : '#5C5852';   // captions, descriptions
  const inkFaint     = isDark ? '#5A5650' : '#9A9489';   // disabled, separators
  const rule         = isDark ? 'rgba(242,235,221,0.10)' : 'rgba(14,13,11,0.10)';
  const ruleStrong   = isDark ? 'rgba(242,235,221,0.18)' : 'rgba(14,13,11,0.16)';
  const widgetAccent   = isDark ? '#FF5A47' : '#E03C2C';   // 朱 hanko red — signature accent
  const widgetAccentWash = isDark ? 'rgba(255,90,71,0.12)' : 'rgba(224,60,44,0.08)';
  const widgetAccentInk  = isDark ? '#FFE5E0' : '#7A1F15'; // text on widgetAccent wash

  /* Type stacks. Pure system stacks — no web-font fetch — but curated so
     every OS lands on a high-quality serif/mono rather than a generic
     fallback. The body sans intentionally avoids Inter/Roboto (skill:
     design-frontend "Anti-Generic"); system-ui resolves to SF Pro on
     Apple, Segoe UI Variable on Windows 11, Roboto on Android — all
     more characterful than Inter at small sizes. */
  const fontDisplay = `'Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Book Antiqua', 'Cambria', Georgia, 'Times New Roman', serif`;
  const fontBody    = `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', sans-serif`;
  const fontMono    = `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace`;

  /* Custom easing — a soft back-out that feels like a stamp pressing down,
     not a generic ease. Used everywhere a panel/button moves so the whole
     widget shares a single motion signature. */
  const easeStamp = 'cubic-bezier(0.22, 1, 0.36, 1)';

  return `
    :host {
      all: initial;
      font-family: ${fontBody};
      font-size: 14px;
      line-height: 1.55;
      color: ${ink};
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: 'ss01', 'cv11'; /* nicer system-ui glyphs where supported */
      --mushi-ok: ${isDark ? '#4ade80' : '#16a34a'};
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
      width: 52px;
      height: 52px;
      border: 1px solid ${ruleStrong};
      border-radius: 4px;
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
      transition: transform 200ms ${easeStamp}, box-shadow 200ms ${easeStamp};
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
      bottom: var(--mushi-bottom, calc(24px + env(safe-area-inset-bottom, 0px)));
      right: var(--mushi-right, calc(24px + env(safe-area-inset-right, 0px)));
    }
    .mushi-trigger.bottom-left  {
      bottom: var(--mushi-bottom, calc(24px + env(safe-area-inset-bottom, 0px)));
      left: var(--mushi-left, calc(24px + env(safe-area-inset-left, 0px)));
    }
    .mushi-trigger.top-right    {
      top: var(--mushi-top, calc(24px + env(safe-area-inset-top, 0px)));
      right: var(--mushi-right, calc(24px + env(safe-area-inset-right, 0px)));
    }
    .mushi-trigger.top-left     {
      top: var(--mushi-top, calc(24px + env(safe-area-inset-top, 0px)));
      left: var(--mushi-left, calc(24px + env(safe-area-inset-left, 0px)));
    }
    .mushi-trigger.edge-tab {
      width: 32px;
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
      width: 36px;
      height: 36px;
      opacity: 0.82;
      transform: scale(0.92);
    }

    @keyframes mushi-pulse {
      0%   { box-shadow: 0 0 0 0 ${widgetAccent}; opacity: 1; }
      70%  { box-shadow: 0 0 0 8px rgba(224,60,44,0); opacity: 0.5; }
      100% { box-shadow: 0 0 0 0 rgba(224,60,44,0); opacity: 1; }
    }

    .mushi-panel {
      position: fixed;
      width: 384px;
      max-width: calc(100vw - 32px);
      max-height: min(640px, calc(100vh - 120px));
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
    }
    .mushi-panel.open  { animation: mushi-stamp-in 320ms ${easeStamp} both; }
    .mushi-panel.closed { display: none; }
    .mushi-panel.bottom-right {
      bottom: var(--mushi-panel-bottom, calc(var(--mushi-bottom, 24px) + 64px));
      right: var(--mushi-right, calc(24px + env(safe-area-inset-right, 0px)));
      --mushi-origin: bottom right;
    }
    .mushi-panel.bottom-left  {
      bottom: var(--mushi-panel-bottom, calc(var(--mushi-bottom, 24px) + 64px));
      left: var(--mushi-left, calc(24px + env(safe-area-inset-left, 0px)));
      --mushi-origin: bottom left;
    }
    .mushi-panel.top-right    {
      top: var(--mushi-panel-top, calc(var(--mushi-top, 24px) + 64px));
      right: var(--mushi-right, calc(24px + env(safe-area-inset-right, 0px)));
      --mushi-origin: top right;
    }
    .mushi-panel.top-left     {
      top: var(--mushi-panel-top, calc(var(--mushi-top, 24px) + 64px));
      left: var(--mushi-left, calc(24px + env(safe-area-inset-left, 0px)));
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
      padding: 18px 20px 14px;
      border-bottom: 1px solid ${rule};
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: end;
      gap: 12px;
    }
    .mushi-header-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 3px;
      background: ${widgetAccent};
      color: #FAF7F0;
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
    .mushi-close, .mushi-back {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: ${inkMuted};
      font-family: ${fontBody};
      font-size: 14px;
      line-height: 1;
      border-radius: 3px;
      transition: color 150ms ${easeStamp};
    }
    .mushi-close:hover, .mushi-back:hover { color: ${widgetAccent}; }
    .mushi-close:focus-visible, .mushi-back:focus-visible {
      outline: 1.5px solid ${widgetAccent};
      outline-offset: 2px;
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
      gap: 14px;
      width: 100%;
      padding: 14px 0;
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
      grid-template-columns: auto 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 10px 0;
      border: 0;
      border-bottom: 1px solid ${rule};
      background: transparent;
      color: ${ink};
      cursor: pointer;
      text-align: left;
    }
    .mushi-report-status {
      font-family: ${fontMono};
      font-size: 10px;
      color: ${widgetAccent};
      text-transform: uppercase;
    }
    .mushi-report-title {
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mushi-thread-summary {
      border-bottom: 1px solid ${rule};
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .mushi-thread-summary span {
      font-family: ${fontMono};
      font-size: 10px;
      color: ${widgetAccent};
      text-transform: uppercase;
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
      letter-spacing: 0.08em;
      text-transform: uppercase;
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
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin: 4px 0 14px;
      border-radius: 0 3px 3px 0;
    }
    .mushi-selected-category span:first-child { font-size: 14px; }
    .mushi-intents {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mushi-intent-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0;
      border: none;
      border-bottom: 1px solid ${rule};
      background: transparent;
      cursor: pointer;
      color: inherit;
      text-align: left;
      font-family: ${fontDisplay};
      font-size: 15px;
      transition: padding 220ms ${easeStamp}, color 220ms ${easeStamp};
    }
    .mushi-intent-btn::after {
      content: '\u2192';
      font-family: ${fontMono};
      font-size: 13px;
      color: ${inkFaint};
      opacity: 0;
      transform: translateX(-4px);
      transition: opacity 220ms ${easeStamp}, transform 220ms ${easeStamp};
    }
    .mushi-intent-btn:last-child { border-bottom: none; }
    .mushi-intent-btn:hover { padding-left: 6px; color: ${widgetAccent}; }
    .mushi-intent-btn:hover::after { opacity: 1; transform: translateX(0); color: ${widgetAccent}; }
    .mushi-intent-btn:focus-visible {
      outline: none;
      padding-left: 6px;
      box-shadow: inset 2px 0 0 ${widgetAccent};
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
      color: #FAF7F0;
      font-family: ${fontMono};
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      cursor: pointer;
      overflow: hidden;
      transition: transform 180ms ${easeStamp}, box-shadow 180ms ${easeStamp};
      box-shadow: 0 2px 0 ${isDark ? '#7A1F15' : '#9A2A1E'};
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
      box-shadow: 0 3px 0 ${isDark ? '#7A1F15' : '#9A2A1E'};
    }
    .mushi-submit:hover::after { opacity: 1; transform: scale(1.4); }
    .mushi-submit:active { transform: translateY(1px); box-shadow: 0 1px 0 ${isDark ? '#7A1F15' : '#9A2A1E'}; }
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
    /*   2. confirmed     (Receipt #abc12345 + Track on Mushi link)  */
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
      color: #fff;
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
       The previous indigo (#6366f1) is the single most recognisable AI-template
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
      color: #FAF7F0;
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
      font-size: 10.5px;
      color: ${widgetAccentInk};
      font-weight: 500;
    }

    /* ─── Beta changelog (collapsible What's new) ──────────────────────── */

    .mushi-changelog {
      margin-top: 5px;
    }

    .mushi-changelog-summary {
      font-size: 10.5px;
      color: var(--mushi-text-dim);
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
      font-size: 10.5px;
      color: var(--mushi-text-dim);
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
      font-size: 11px;
      color: var(--mushi-text-dim);
      line-height: 1.5;
    }

    .mushi-beta-success-dim {
      opacity: 0.65;
      font-size: 10.5px;
    }

    /* ─── Banner launcher (trigger: 'banner') ─────────────────────────────── */

    .mushi-banner {
      position: fixed;
      left: 0;
      right: 0;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0 16px;
      font-family: ${fontMono};
      font-size: 11.5px;
      letter-spacing: 0.04em;
      white-space: nowrap;
      overflow: hidden;
      z-index: var(--mushi-banner-z, 99998);
      animation: mushi-banner-slide-in 0.3s ${easeStamp} both;
    }

    .mushi-banner.top    { top: 0; }
    .mushi-banner.bottom { bottom: 0; }

    /* --- neon variant (electric lime — dev / beta tool aesthetic) --- */
    .mushi-banner.neon {
      background: #0FFF50;
      color: #0a1a0a;
      border-bottom: 1.5px solid #00C43A;
    }
    .mushi-banner.neon.bottom {
      border-top: 1.5px solid #00C43A;
      border-bottom: none;
    }
    .mushi-banner.neon .mushi-banner-btn {
      background: rgba(0,0,0,0.14);
      color: #0a1a0a;
      border: 1px solid rgba(0,0,0,0.22);
    }
    .mushi-banner.neon .mushi-banner-btn:hover {
      background: rgba(0,0,0,0.22);
    }

    /* --- brand variant (widgetAccent — editorial, app-quality) --- */
    .mushi-banner.brand {
      background: ${widgetAccent};
      color: #fff;
      border-bottom: 1.5px solid ${isDark ? '#C4321E' : '#B52F1F'};
    }
    .mushi-banner.brand.bottom {
      border-top: 1.5px solid ${isDark ? '#C4321E' : '#B52F1F'};
      border-bottom: none;
    }
    .mushi-banner.brand .mushi-banner-btn {
      background: rgba(255,255,255,0.18);
      color: #fff;
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
  `;
}
