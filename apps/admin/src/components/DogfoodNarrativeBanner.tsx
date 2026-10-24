/**
 * FILE: apps/admin/src/components/DogfoodNarrativeBanner.tsx
 * PURPOSE: One-sentence narrative banner that ties the Reports inbox to
 * the user's actual project Today
 *          glot-it components surface as raw strings — there's no story
 *          connecting "these reports" to "your project."
 *
 *          Renders something like:
 *            "Sing Along Completion is your most fragile area — 6 reports
 *             in the last 14 days. 1 fix already merged and 2 more drafted."
 *          The drafted and merged counts are that component's open and
 *          merged PRs, not the project's fix-attempt total.
 *
 *          The phrasing template lives in `lib/copy.ts` so future projects
 *          (not just the glot-it dogfood) inherit the same voice.
 *
 *          Hidden in advanced mode (power users get the dense /reports
 *          table without preamble) and on first-load while data hydrates.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from './ProjectSwitcher'
import { useAdminMode } from '../lib/mode'
import type { DashboardData } from './dashboard/types'
import { renderDogfoodNarrative } from '../lib/copy'
import { CHIP_TONE } from '../lib/chipTone'

export function DogfoodNarrativeBanner() {
  const { isAdvanced } = useAdminMode()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  // Reuses /v1/admin/dashboard which is already cached by /. and refreshes
  // every page load. No new BE work — just a second consumer.
  const dashboardQuery = usePageData<DashboardData>('/v1/admin/dashboard')

  if (isAdvanced) return null
  // Keep the banner's box while its data loads: inserting it after first
  // paint pushed the filters and the list down (the largest layout shift on
  // /reports, mushi-ux audit 2026-10-24). It still collapses in the rare
  // case it turns out empty (no reports, no top component).
  if (setup.loading || dashboardQuery.loading) {
    return <div aria-hidden="true" data-testid="narrative-placeholder" className="mb-3 h-12.5 rounded-md border border-chrome-border bg-chrome/50 motion-safe:animate-pulse" />
  }
  if (!setup.activeProject) return null
  // No bugs yet → the rest of the inbox UI is already empty-state, no
  // need to also surface a narrative banner.
  if ((setup.activeProject.report_count ?? 0) === 0) return null

  const top = dashboardQuery.data?.topComponents?.[0]
  if (!top) return null

  const projectName = setup.activeProject.project_name
  // Area-scoped. Project fix_count is every attempt in the app; subtracting
  // merged attempts printed the inbox report total as "N more drafted".
  const draftedFixes = top.draftedFixes ?? 0
  const mergedFixes = top.mergedFixes ?? 0

  const sentence = renderDogfoodNarrative({
    projectName,
    component: top.component,
    componentReports: top.count,
    draftedFixes,
    mergedFixes,
  })

  return (
    <aside
      role="complementary"
      aria-label="Project narrative"
      className="mb-3 flex items-center gap-3 rounded-md border border-chrome-border bg-chrome px-3 py-2.5 motion-safe:animate-mushi-fade-in"
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${CHIP_TONE.infoSubtle} text-sm`}
        title="Most fragile area"
      >
        ◆
      </span>
      <p className="flex-1 min-w-0 text-xs text-fg-secondary leading-snug">{sentence}</p>
      <Link
        to={`/reports?component=${encodeURIComponent(top.component)}&status=new&sort=severity&dir=desc`}
        className="shrink-0 inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium bg-brand text-brand-fg hover:bg-brand-hover motion-safe:transition-opacity motion-safe:active:scale-[0.97] motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
      >
        Open the worst <span aria-hidden="true">→</span>
      </Link>
    </aside>
  )
}
