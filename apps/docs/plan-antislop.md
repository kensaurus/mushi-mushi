# Anti-Slop Burndown — `apps/docs` landing (`/`)

_Executed Jul 15 2026 — phases 0–4 landed, then partially reverted after user
review (see "Correction" below)._

## Status

| Phase | Status |
|-------|--------|
| 0 Motion integrity (kill pins) | Done — 0 `.pin-spacer`; fast fling clears “See it in action” |
| 1 Copy pass | Done — wedge jargon gone; media intro plain |
| 2 Visual / conversion | Done — hero CTAs, linked trust chips, macOS terminal, ink ambient |
| 3 UX & IA | Kept editorial order; **content restored** (see Correction) |
| 4 Code cleanup | Tests updated; `WhereToStartGrid` + `QuickstartGrid` are distinct again |

## Correction (Jul 15 2026, post-review)

The audit over-trimmed and the pin work had left the docs sidebar off. Reverted:

- **Sidebar nav restored** — removed `sidebar: false` from `content/_meta.ts`.
  Pins are gone, so the docs rail (Quickstart / Concepts / SDKs …) is the
  primary nav and stays on.
- **Comparison matrix back to 8 rows** — the trimmed 4-row version dropped real
  differentiators (repeat-bug collapse, lessons.json, draft PR, attribution).
- **Both start paths restored** — "Where to start" (intent picker) *and* "Try
  it" (platform quickstarts: incident-loop / MCP / React / mobile) are separate
  sections again. The consolidated single-grid + `UseCasesStrip` were removed.

Kept from the pass: killed pins, hero CTAs, linked trust chips, richer ink
ambient + macOS terminal, enhanced diagnosis cards.

## Verification

- SSR HTML: `nextra-sidebar` present; sidebar titles Get started / Quickstart /
  Concepts / SDK reference / Migration guides / Admin console / Self-hosting /
  Integrations all render.
- Comparison rows restored: "Repeat bugs", "Reporter attribution",
  "lessons.json", "collapses to one row".
- Both path sections: "Where to start" + "Try it" (iOS, MCP server, I operate
  the console).
- Hero CTAs: Run the wizard / Browse the repo / Connect your editor.
- `tsc --noEmit` clean · `lib/landing-cinematic.test.ts` 8/8.
