/**
 * Canonical page scaffolding — which Page* primitive to use where.
 *
 * This module documents the design-system contract; it does not re-implement
 * the components. Import the components from their source files.
 *
 * ---------------------------------------------------------------------------
 * Junior copy-me template (operator list / worklist pages)
 * ---------------------------------------------------------------------------
 *
 * ```tsx
 * import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
 * import { PageHeaderBar } from '../components/PageHeaderBar'
 * import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
 * import { Btn, Card, FreshnessPill, Badge } from '../components/ui'
 * import { CHIP_TONE } from '../lib/chipTone'
 *
 * export function ExamplePage() {
 *   return (
 *     <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-example">
 *       <PageHeaderBar
 *         title="Example"
 *         description="One-line operator summary."
 *         helpTitle="About Example"
 *         helpWhatIsIt="What this page does for the operator."
 *         helpUseCases={['…', '…']}
 *       >
 *         <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
 *         <Btn size="sm" variant="ghost" onClick={reload}>Refresh</Btn>
 *       </PageHeaderBar>
 *
 *       <PagePosture
 *         slots={[
 *           { priority: POSTURE_PRIORITY.status, children: statusBanner },
 *           { priority: POSTURE_PRIORITY.heroOrSnapshot, children: snapshot },
 *           { priority: POSTURE_PRIORITY.guide, children: guide },
 *         ]}
 *       />
 *
 *       // primary work UI — Card / Panel / Section; tones via CHIP_TONE
 *     </div>
 *   )
 * }
 * ```
 *
 * Rules of thumb:
 * 1. Root MUST be `className={PAGE_CONTENT_STACK}` — never add `p-*`, `mx-auto`,
 *    or `max-w-*` (Layout already applies `PAGE_SHELL_CLASS`).
 * 2. Header MUST be `PageHeaderBar` with `helpTitle` + `helpWhatIsIt` so the
 *    "About X" banner registers via RoutePageHelp (first-viewport parity).
 * 3. Status / snapshot / guide chrome goes in `PagePosture` (mode-capped rows).
 * 4. Cards: prefer `<Card>` / `<Panel>` — do not hand-roll
 *    `rounded border bg-surface-overlay`.
 * 5. Tones: `CHIP_TONE` / `<Badge tone=…>` — never ad-hoc `text-ok` on
 *    `bg-ok-muted`.
 *
 * Reference examples (Start-here cluster):
 *   - `pages/OverviewPage.tsx` — portfolio + StatGrid posture + Card grid
 *   - `pages/ActivityPage.tsx` — per-project stats + PageHeaderBar help props
 *
 * Sanctioned exceptions (skip PAGE_CONTENT_STACK / PagePosture):
 *   - Full-height split panes: `/content`, `/content/:id`
 *   - Fluid atlas routes: `/explore`, `/graph` (still prefer PAGE_CONTENT_STACK
 *     for vertical rhythm; shell switches to fluid width)
 *   - Auth / public / tester pages — see eslint `no-missing-page-posture`
 *     skipBasenames
 *
 * Guardrails (eslint-plugin-mushi-mushi):
 *   - `no-legacy-page-header-in-pages` — ban PageHeader in pages/
 *   - `no-page-root-padding` — require PAGE_CONTENT_STACK; ban root padding / max-w
 *   - `no-arbitrary-length-value` — warn on non-var Tailwind arbitraries
 *   - `prefer-card-primitive` — warn on hand-rolled card chrome
 *   - `no-missing-page-posture` — require PagePosture on operator pages
 *
 * Audit: `node scripts/audit-page-scaffold.mjs` (add `--cluster` / `--write`)
 * Codemod: `node scripts/codemod-page-root-stack.mjs [--dry-run]`
 *
 * Canonical order on operator list pages:
 *   PageHeaderBar → PagePosture (≤2 Beginner / ≤3 Advanced) → SegmentedControl → primary work UI
 *
 * | Primitive | When to use | Status |
 * |-----------|-------------|--------|
 * | PageHeaderBar | Every operator list/detail worklist page title row | **Canonical** |
 * | PagePosture | Status banner + snapshot + guide slots | **Canonical** |
 * | PageHeader (ui/page-help) | Compact title inside nested panels only | Niche |
 * | PageHero | DAV/flow hero on triage surfaces that need the severity card | Optional advanced |
 * | PageActionBar | Sticky primary/secondary actions below header | Canonical when needed |
 * | PageSection | Grouped content blocks inside primary work UI | Canonical |
 * | PageHelpPanel / RoutePageHelp | Long-form help; do not duplicate in header description | Canonical |
 *
 * Auth / public pages (`LoginPage`, `PublicHomePage`, …) intentionally skip
 * PagePosture — see eslint `no-missing-page-posture` skipBasenames.
 */

export const PAGE_SCAFFOLD_CANONICAL = [
  'PageHeaderBar',
  'PagePosture',
  'PageActionBar',
  'PageSection',
  'RoutePageHelp',
] as const

export const PAGE_SCAFFOLD_OPTIONAL = ['PageHero', 'PageHelpPanel', 'PageHeader'] as const

/** Start-here cluster used by audit-page-scaffold --cluster and wave docs. */
export const PAGE_SCAFFOLD_START_HERE = [
  'OverviewPage',
  'ActivityPage',
  'DashboardPage',
  'ConnectPage',
  'FeedbackPage',
  'FeatureBoardPage',
] as const

export type PageScaffoldCanonical = (typeof PAGE_SCAFFOLD_CANONICAL)[number]
