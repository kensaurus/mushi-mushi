# Anti-Slop Burndown — kensaur.us/mushi-mushi site red-team

_Companion to [`../red-team-2026-07-02/red-team-defect-report.md`](../red-team-2026-07-02/red-team-defect-report.md). Audit-only — findings and phasing, no rewrites performed except where noted "Fixed."_

## Scope

- Surfaces audited: [x] Prose [x] Visual [x] Structure [ ] Code (code-level bugs are tracked in the defect report, not here)
- In scope: landing page, `/connect`, `/pricing`, `/cloud`, architecture/concepts docs, admin doc screenshot captions, native SDK quickstarts
- Out of scope: GTM/directory-listing copy (already covered by [`2026-06-gtm-directory.md`](2026-06-gtm-directory.md)) and the SDK-reliability pass in [`2026-07-sdk-reliability.md`](2026-07-sdk-reliability.md)

## Slop score

| Surface | Findings | Closed this pass | Remaining |
|---|---|---|---|
| Prose (factual drift) | 6 | 6 | 0 |
| Prose (voice/tell) | 3 | 0 | 3 |
| Visual | 1 | 0 | 1 |
| Structure | 2 | 0 | 2 |

## Findings

### Prose — factual drift (all closed, cross-reference to defect report)

| # | Location | Tell | Recognizability | Effort | Status |
|---|---|---|---|---|---|
| P1 | Global banner (`layout.tsx`) | Stale `v0.8.0 · shipped` voice while changelog shows `v1.22` | High | S | ✅ Fixed (defect #2) |
| P2 | Roadmap MCP count | "72-tool surface" vs. actual 68 | Med | S | ✅ Fixed (defect #4) |
| P3 | Architecture prose | Over-confident single-line edge ("only after a human approves") undersells the real autofix capability | High | S | ✅ Fixed (defect #5) |
| P4 | Native quickstarts (4 files) | `0.8.0` version pins that were never published | High | S | ✅ Fixed (defect #6) |
| P5 | Admin drift caption | Invented "Stagehand walker" component name | Med | S | ✅ Fixed (defect #7) |
| P6 | Cloud page benefit | "community Discord" that doesn't exist | High | S | ✅ Fixed (defect #10) |

### Prose — voice / template tells (not addressed this pass — flagged for `docs-writer`)

| # | Location | Tell | Recognizability | Effort |
|---|---|---|---|---|
| P7 | `LANDING_QUICKSTART_INTRO` | "Classification lands in about 10 seconds today; we are chasing sub-10" — a hedge stack (qualifier + aspiration) in a single marketing sentence reads as AI-smoothed rather than a direct claim | Low | S |
| P8 | Hero voice split | Hero uses "Your AI wrote it" (`MUSHI_TAGLINE_V2.hero`); the north-star sentence in `VISION.md` uses "Your AI shipped it." Both pass `check-positioning-consistency.mjs` since they're intentionally scoped differently (hero = build-time, north-star = ship-time), but a reader skimming both surfaces in one sitting could read it as inconsistent messaging rather than a deliberate distinction | Med | S |
| P9 | Pricing FAQ hedges | Several FAQ answers use "typical," "most teams," "usually" without a number backing the claim (e.g. "Most teams run the full loop for under $20/month in LLM costs") — fine in isolation, adds up across a page that's trying to be the most concrete, numbers-first page on the site | Low | S |

### Visual (not addressed this pass)

| # | Location | Tell | Recognizability | Effort |
|---|---|---|---|---|
| V1 | `LANDING_QUICKSTART_PLATFORMS` icons | Emoji-as-icon (`⚡ ◉ ⚛ ◈`) on the four quickstart cards — a template tell, since a designed product would use the brand mark or a consistent icon set rather than mixed Unicode symbols | Med | M |

### Structure (not addressed this pass)

| # | Location | Tell | Recognizability | Effort |
|---|---|---|---|---|
| S1 | Landing pillars / comparison layout | Hero → proof → media → comparison table → 4-step pillars is a recognizable template shape. Kept as-is per the plan's original call (matches the intended "Bucket A wedge" positioning) — noting here only so it's not silently forgotten if a future redesign pass wants to differentiate the IA | Med | L |
| S2 | Raw `<a href>` in grid components | `WhereToStartGrid` and `QuickstartGrid` both use plain `<a href>` instead of `next/link`, which is what made defect #1 possible in the first place (root-relative hrefs bypass the docs `basePath`). The immediate instance is fixed by pointing at an absolute URL, but the underlying pattern is still fragile for any *other* card that might someday need an absolute vs. relative distinction | Med | M |

## Execution handoff

- **P7–P9** (voice hedges) → `docs-writer` skill, tighten in a dedicated copy pass; low risk, low effort, not blocking launch.
- **V1** (emoji icons) → `enhance-web-ui` skill, replace with a consistent icon set or the brand mark from `@glotit/design-tokens`-equivalent for mushi-mushi (`packages/brand`).
- **S1** — no action recommended; intentional per the original plan's positioning call.
- **S2** — `enhance-web-ux` or a small refactor pass: migrate `WhereToStartGrid`/`QuickstartGrid` to `next/link` with explicit absolute-URL support for cards that need to point outside the docs `basePath` (admin console, GitHub, etc.), so the next "add an external card" doesn't reintroduce defect #1's failure mode.

## Verification commands (post-fix)

```bash
cd /home/kenji/Downloads/mushi-mushi
node scripts/check-positioning-consistency.mjs
pnpm --filter @mushi-mushi/mcp build && pnpm gen:mcp-tools-doc   # regenerates the renamed mcp-tools-generated.mdx
pnpm --filter @mushi-mushi/docs build   # with MUSHI_BASE_PATH=/mushi-mushi/docs
```
