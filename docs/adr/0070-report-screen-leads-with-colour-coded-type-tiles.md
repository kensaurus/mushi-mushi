# 0070. The report screen leads with colour-coded type tiles

Status: Accepted 2026-11-26 by the owner, delegated to the team lead
(「decide and ship, stop asking」).
Date: 2026-11-26

Related: Plan 018 (`docs/execplans/reporter-loop-v2.md`), decision 1 and §1.1,
which this amends; `packages/web/src/widget-render.ts` (`reportView`, `tile`,
`renderMeter`), `packages/web/src/widget-icons.ts`,
`packages/core/src/design-tokens.ts` (`MUSHI_REPORT_TYPE_COLORS`,
`MUSHI_REPORT_TYPE_WASH`), `apps/docs/content/sdks/theming.mdx`, BL-255.

## Context

Plan 018 made the report screen "free text first": a textarea, then optional
grey type chips, a disabled Send with a footer sentence saying why
("Add a few words"), a beta box in the middle of the form and a privacy
paragraph. On 2026-11-26 the owner looked at it inside SBC (a light console,
the widget in dark mode because `theme: 'auto'` follows the OS) and asked for
it to be "more graphical and intuitive with colors … stop the text walls and
lazy UI/UX". The screenshot showed:

- a title wrapping onto two lines;
- five identical grey text chips;
- text pill buttons for the screenshot and the element picker;
- three paragraphs of copy;
- a disabled grey Send with the reason in the footer, away from the field.

What other reporters do (read 2026-11-26):

- Sentry User Feedback: screenshot on by default, `colorScheme: "system"`, a
  fully themable form.
- Marker.io, Usersnap and Jam: screenshot first, with annotate (highlight,
  blur, arrow).
- NN/g form guidance: fewer fields, labels in context, errors next to the
  field, and no disabled submit buttons (the user can't tell why).

## Decision

1. **Type first, as six tiles.** Bug (red), Slow (amber), Looks wrong
   (violet), Confusing (blue), Idea (green) and Other (grey) sit in a 3×2
   grid above the textarea. Each has its own icon and hue. The type stays
   optional: the textarea is visible from the start, a second tap clears the
   pick, and `classify-report` still decides the final category. Other closes
   the grid and sends `category: 'other'`; host categories stay behind
   "More…". The tiles are a radiogroup with roving tabindex and arrow keys.
   On open, focus goes to the first tile; a pointer tap moves it on to the
   textarea.
2. **The pick tints the panel and the prompt.** The header gets a 3px stripe
   and the type's icon. The textarea placeholder becomes a question for that
   type (bug → 「何をしたら、どうなりましたか？」). For Idea, the host's
   `featureRequestDescription` is the prompt when set.
3. **Validation next to the field, and Send never disabled.** A ring and
   「あと N 文字」 sit right under the textarea. The ring turns into a check
   and the shortcut hint once the minimum is met. Below the minimum, Send
   looks lighter but stays enabled. Pressing it turns the meter red, puts
   focus in the textarea and announces "Add a few words". The minimum is
   unchanged (8, halved for CJK, or a deliberate attachment). The meter has
   its own render region, so typing never re-renders the textarea and an IME
   composition survives.
4. **No text walls.**
   - The beta notice is a "Beta" chip in the header. A button opens the
     message, contact link, perks and changelog under it; it is not a hover
     tooltip, so touch and keyboard users can open it. Escape closes it.
   - Privacy is one 🔒 line in the footer. The full sentence is its tooltip
     and its screen-reader text.
   - Screenshot and element picker are 44px icon tools (camera, crosshair).
     The label is the tooltip and the accessible name. An attached screenshot
     is a thumbnail with a check badge, plus mark-up and remove tools.
   - The header title is one line; the Japanese title is now 「フィードバック」.
5. **Graphical success.** A ring and a check draw themselves in the success
   colour, then 「届きました」 / "Got it". The reply-time promise is a chip
   with a clock icon.
6. **Colours are core tokens and pass AA in both modes.**
   `MUSHI_REPORT_TYPE_COLORS` holds `solid` (border and stripe, ≥ 3:1 on the
   panel) and `ink` (icon and text, ≥ 4.5:1 on both tile fills) per mode. The
   fills are `solid` at `MUSHI_REPORT_TYPE_WASH` opacity.
   `design-tokens.test.ts` asserts every ratio against white and `#121212`.
7. **The panel edge is visible on a page of its own colour** (WCAG 1.4.11):
   it defaults to 38% ink instead of 16%, and `--mushi-border` still wins. A
   light-only host sets `theme: 'light'` (or `'inherit'`): `'auto'` keeps
   following the OS, as documented on the theming page.

## Consequences

- The `@mushi-mushi/web` gzipped budget rises from 89.8 KB to 94 KB. The
  measured growth is 4.1 KB gzipped: styles 6.0 KB raw, the five locales
  4.3 KB raw, render code 3.0 KB, widget state 2.5 KB and icons 1.4 KB. The
  `@mushi-mushi/core` budget rises from 26.0 KB to 26.3 KB.
- Send keeps `aria-disabled="false"` while below the minimum. Tests read
  `data-ready` instead.
- React Native and Capacitor keep the Plan 018 chips until they adopt the
  tiles (BL-255). The colours already live in core for them.
- Custom locales written before this change keep working: every new key is
  optional, with an English fallback.

## Rejected

- **A separate "pick a type" step before the form.** Plan 018 retired the
  3-step flow for good reason, so the tiles and the textarea share one screen.
- **Hover-only tooltips for the beta and privacy details.** They don't work
  on touch and are unreliable for keyboard and screen-reader users.
- **Letting hosts recolour each type through new `--mushi-type-*` tokens.**
  The 13-token theming contract stays as it is until a host asks.
