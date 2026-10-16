# Design housekeep — admin console (2026-10-16)

Executor log for `housekeep-design` on `apps/admin`. The previous burndown,
[`docs/plan-uiux-unification.md`](../plan-uiux-unification.md), is fully checked,
so this pass ran a fresh inventory. Scope: token and component de-duplication
only. Anything that would visibly change the UI is listed for the owner at the
end and is **not** in this diff, with one exception the gate forces (next section).

## Visible changes made

1. **Four hero-flow chips now meet WCAG AA.** `scripts/audit-chip-contrast.mjs` knows `danger`,
   not `err`. Once `bg-err/15 text-err` became `bg-danger/15 text-danger`, the audit (part of
   `check:design`) flagged 4 chips that had been failing AA behind the alias:
   `HeroDetailPanel.tsx` `crit` tone, and `OperatorTraceLog.tsx` `LEVEL_BADGE.error`,
   `OperatorTraceBadge` error tone and the "N errors" pill. They now use the AA recipes
   (`CHIP_TONE.dangerSubtle`, `CHIP_TONE.danger`, or `bg-danger-muted/50
   text-danger-foreground`, the repo codemod's own mapping). The alternative was allowlisting
   a known AA failure to keep the gate green, which would game it. The red text becomes the
   darker / lighter `danger-foreground` and the wash becomes `danger-muted`.

Nothing else in the diff changes a rendered pixel (see Verification).

## SSOT (unchanged)

| Layer | Source |
| --- | --- |
| Primitives | `packages/brand/tokens/brand.tokens.json` → `packages/brand/src/editorial.css` (`--mushi-*`) |
| Semantic | `apps/admin/src/styles/theme-tokens.css` (`@theme`), light / high-contrast overrides in `styles/base-and-density.css`, Ask Mushi scope in `styles/ask-mushi.css` |
| Component recipes | `apps/admin/src/lib/chipTone.ts`, `lib/btnRecipe.ts`, `components/ui/*` |

Rules table: [`apps/admin/src/design-system/_design-system-README.md`](../../apps/admin/src/design-system/_design-system-README.md).

## Inventory (Phase 2, `apps/admin/src`, non-test sources)

| Class | Found | Verdict |
| --- | --- | --- |
| Same-value token aliases | 13 alias tokens (`err`, `err-muted`, `warning`, `warning-subtle`, `danger-subtle`, `info-subtle`, `ok-subtle`, `surface-2`, `surface-3`, `fg-primary`, `border`, `border-subtle`, `duration-micro`) used at 43 class sites in 15 files | 10 merged (41 sites, 13 files), 3 kept (see decisions) |
| Arbitrary values equal to an existing token | 5 sites (3 × ink/vermillion `color-mix` hover = `editorial-ink-emphasis`; 2 × `ease-[var(--ease-stamp)]` = `ease-stamp`) | merged |
| Raw colour literals in TSX | 41 lines in 9 files: 26 sanctioned brand-mark hex (Google G, Linear, `brandMarks.ts`, already allowlisted), 15 arbitrary `rgba()` / `oklch()` / `color-mix()` values | brand marks kept; the rest is owner list or editorial-intentional |
| Raw Tailwind palette (`bg-gray-*`, …) | 0 | clean |
| `bg-white` / `bg-black` | 2 (`ProjectFavicon` white tile behind third-party favicons, `CodePanel` `hover:bg-white/10` on the always-dark code surface) | intentional, kept |
| Arbitrary Tailwind values overall | 246 (w/max-w 82, min/max-h 51, grid-cols 27, tracking 21, z 17, …) | layout values, not tokens; z-index → owner list |
| Competing primitives (exported) | 0 — one `Btn`, `Card`, `Badge`, `Modal`, `Drawer`, `Input`, `Tooltip`, … | clean |
| File-private primitive clones | 5 `SeverityBadge` (4 near-identical error/warn/info + 1 different), 2 `MetaChip`, 2 `ActivityDot` | `SeverityBadge` → owner list (no single form renders the same at all 4 sites); the rest are distinct variants |
| Icon libraries | 1 (in-repo `components/icons.tsx`; no lucide / heroicons / react-icons) | clean |

Totals: 52 conflicts found (43 alias sites, 5 arbitrary-value duplicates, 4 `SeverityBadge`
copies). Resolved: 46 sites in 16 source files (41 alias sites in 13 files, 5 arbitrary
values in 3 files), plus 4 contrast chips the alias had hidden, and 11 alias names removed
(18 declarations across 3 CSS files). Kept on purpose: 2 alias sites (`divide-border`,
`text-fg-on-accent`). Owner list: the 4 `SeverityBadge` copies and the items below.

## SSOT decisions

- [x] **`err` / `err-muted` → `danger` / `danger-muted`.** Same value in every scope (no nested scope overrides `--color-danger`). 18 class sites.
- [x] **`warning` / `warning-subtle` → `warn` / `warn-muted`.** 1 site (`HealthSparkline`, mounted on integration cards, never inside the Ask Mushi terminal, which is the only scope that redefines `--color-warn`). `--color-warning-foreground` is a separate token with its own value and stays.
- [x] **`danger-subtle` / `info-subtle` / `ok-subtle` → `*-muted`.** Zero usages; deleted.
- [x] **`surface-2` / `surface-3` → `surface-raised` / `surface-overlay`.** 1 site each. Removed from `@theme` and from the light, high-contrast and Ask Mushi override blocks (each mapped them to the same target as the canonical token).
- [x] **`fg-primary` → `fg`.** 20 sites. Ask Mushi mapped both to `--am-text`.
- [x] **`duration-micro` → `duration-instant`.** Zero usages; deleted.
- [x] **Kept `border` / `border-subtle`.** Not a stray alias: it is the shadcn token Streamdown's markup uses (`border-border` 15×, `divide-border` 3× in its dist) and Ask Mushi bridges it to the terminal palette. `divide-border` in `MigrationsInProgressCard` stays, because removing it would stop Tailwind generating the utility that Streamdown tables rely on.
- [x] **Kept `fg-on-accent`.** It names a role (copy on an accent fill), not a second name for `fg`; it can diverge per theme.
- [x] **Ink/vermillion hover `color-mix` → `hover:bg-editorial-ink-emphasis`.** The token's formula is identical (`--mushi-ink 82%` + `--mushi-vermillion`). 3 sites.
- [x] **`ease-[var(--ease-stamp)]` → `ease-stamp`.** Already used 7×. 2 sites in `ui/forms.tsx`.
- [x] **Not merged: `SeverityBadge` (4 copies).** No single form renders the same at all four sites (label "Warn" vs "Warning"; Info with or without a border). Owner list, item 9.
- [x] **Kept `MetaChip` ×2 and `ActivityDot` ×2.** Different shapes (labelled tile vs inline tooltip pill; dot with text vs bare dot).

## Migration batches

- [x] Batch 1 — alias tokens: `HeroDetailPanel`, `HeroNodes`, `OperatorTraceLog`, `lib/chipTone.ts`, `HealthSparkline`, `ui/layout.tsx`, `ReportDetailPage`, `CodebaseIndexCard`, `DryRunPanel`, `CodeHealthPage`, `ContentQualityDetailPage`, `ContentQualityPage`, `DriftPage`, `ExperimentsPage`; token files `theme-tokens.css`, `base-and-density.css`, `ask-mushi.css`.
- [x] Batch 2 — arbitrary values: `EditorialErrorState`, `PublicIntegrationsPage`, `ui/forms.tsx`.
- [x] Batch 3 — contrast chips the alias had hidden: `HeroDetailPanel`, `OperatorTraceLog`.

## Verification

- Zero-hit re-search for every retired form (fresh inventory script + `grep` for the custom properties): 0.
- Built CSS, before vs after (`vite build`, every rule flattened and diffed): only the retired alias utilities are gone, `bg-danger/8`, `hover:bg-editorial-ink-emphasis` and `motion-safe:ease-stamp` are added, and the alias declarations left the light, high-contrast and Ask Mushi blocks. No other rule changed. A rules diff cannot show an element switching to a class that already existed; the 4 contrast chips are the only such element-level change.
- Public pages, headed `playwright-cli` on profile `mushi-console-local` at 1440×900: `/login` and `/integrations`, light and dark. Pixel diff is 0 of 1,296,000 on all four pairs. The hovered "Get started" background equals the old `color-mix` exactly (`oklch(0.239002 0.0402216 29.7709)`).
- Never rendered in a browser (the profile is signed out and no password was typed; the CSS diff and unit tests cover them): `/dashboard`, `/inbox`, `/reports`, `/settings`, and every signed-in surface the diff touches, which are CodeHealth, Experiments, Drift, ContentQuality (list and detail), ReportDetail, the hero-flow detail panel and operator trace, the integration cards (`HealthSparkline`, `CodebaseIndexCard`, `DryRunPanel`), `ui/forms` Switch, and the 404 / error state (`EditorialErrorState`).

## Guardrail

`scripts/check-design-tokens.mjs` gains a `[retired-alias]` check, inside the existing
`pnpm check:design` step:

- exact-root deny list for the removed aliases (exact match, so `text-warning-foreground` stays legal);
- also flags `var(--color-<retired>)` in admin TS/TSX/CSS;
- flags the two arbitrary forms that duplicate a token (`ease-[var(--ease-stamp)]`, the ink/vermillion `color-mix`).

Why an explicit list: the gate's unknown-root check falls back to the longest defined
prefix, so `text-fg-primary` (prefix `fg`) and `bg-surface-2` (prefix `surface`) would pass
after the tokens were deleted and render nothing.

Escape hatch: a new token goes in `styles/theme-tokens.css`. A reviewed exception takes
`// mushi-mushi-allowlist: <reason>` on the same line.

## Owner decisions (visible changes, not in this diff)

Parked as `BL-023` in [`docs/BACKLOG.md`](../BACKLOG.md).

1. **Z-index scale is unused and disagrees with the code.** `--z-*` (0/20/40/50/60/70/80) has 0 usages; 59 literal z values exist. Toasts sit at `z-[60]` while `--z-toast` is 70; four overlays (`BetaBanner`, `ConfigHelp`, `FirstRunTour`, `ui/misc` tooltip) use `z-[100]`, above `--z-overlay-max` (80). Pick one stacking model, then migrate.
2. **Dark mode `fg-faint` (L 0.63) is brighter than `fg-muted` (L 0.62).** The hierarchy is inverted in dark only (light is 0.50 vs 0.44, correct).
3. **Dark mode `warn` (`oklch(0.80 0.15 80)`) and `brand` (`oklch(0.80 0.16 80)`) are the same amber.** A warning chip and a brand chip are indistinguishable in dark mode.
4. **"Merged" PR state has three colours.** Green (`okSubtle`) in `BulkSdkUpgradePanel`, `BeforeAfterCard`, `UxRunPullRequest`, `lib/tokens.ts`; violet (`CHIP_TONE.accent`) in `FixGitGraph`; a raw `oklch(…300)` purple in `ReportBranchGraph`.
5. **Naming drift `warn` vs `warning-foreground`.** Renaming touches every `CHIP_TONE.warn*` recipe; cosmetic only.
6. **Extended type ramp has 0 usages.** `--text-label/body/title/heading/display` (Jul 2026) are unused, and `--text-label` equals `--text-2xs`. Adopt or delete.
7. **Streamdown borders in Ask Mushi use the default colour.** Streamdown emits `border-border` 15×, but the admin CSS has no `@source` for it and admin code never uses `border-border`, so `.border-border` is not generated (checked in the built CSS). Adding `@source` for Streamdown's dist would fix it and is a visible change.
8. **Editorial keycap shadow.** `shadow-[inset_0_-2px_0_rgba(…)]` appears with four alphas across admin public pages and `packages/marketing-ui`; a `--mushi-elevation-key` token would need a brand decision on one alpha.
9. **Four file-local `SeverityBadge` copies** (`components/design/DeviancePanel.tsx`, `components/recipe/RecipeIssueList.tsx`, `pages/CodeHealthPage.tsx`, `pages/FullStackAuditPage.tsx`) render error / warn / info almost identically. Choose the warn label ("Warn" ×3 today, "Warning" ×1; "Warning" is the full word for screen readers) and the Info style (`Badge tone="neutral"` with a border ×2, borderless `bg-surface-overlay text-fg-secondary` ×2), then merge them into one `components/ui` badge. `LessonsPage` has a fifth, different one (`critical`, raw label) and stays separate.

## Follow-ups found on the way (not design)

- `packages/mcp/tsup.config.ts` runs two builds in parallel and the first has `clean: true`; on a cold build it can delete the library `.d.ts` files, and the admin `tsc -b` then fails with `MCP_PIN_SPEC` missing. Rebuilding `@mushi-mushi/mcp` alone fixes it.
