/**
 * FILE: apps/admin/src/components/projects/ProjectNextStepsPanel.tsx
 * PURPOSE: "What does each app need from me?" as one table (fresh-eyes review 2026-11-18;
 *          it was one card per project, each repeating the same two sentences): app, SDK
 *          version, stuck count as a bar, next step. Worst first (most stuck, `rankProjectNeeds`).
 *          Round 2 (2026-11-18): the SDK upgrade card below it repeated every version pair, so
 *          its Open PR now sits in this table's SDK cell (`SdkUpgradeCell`) and its bulk buttons
 *          in the header (`BulkUpgradeToolbar`); the stuck bar is the inbox link ("Open inbox →"
 *          was on 8 of 9 rows); the next-step column only shows when some app has a step left.
 *          Unknown is hatched, never 0. Renders on the overview tab from data the page has.
 */

import { Link } from 'react-router-dom'
import type { Project } from './project-models'
import { rankProjectNeeds, type ProjectVerdictTone } from './projectNextSteps'
import { BulkUpgradeToolbar, SdkUpgradeCell, useBulkSdkUpgrade, type BulkUpgradeProject } from './BulkSdkUpgradePanel'
import { ProjectFavicon } from '../ProjectFavicon'
import { Card } from '../ui'
import { BarCell } from '../signal/BarCell'
import { Chip } from '../signal/Chip'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'
import { resolveSdkDisplay } from '../../lib/sdkVersionCompare'

type SdkDisplayKind = ReturnType<typeof resolveSdkDisplay>['kind']

const VERDICT: Record<ProjectVerdictTone, { tone: SignalTone; label: string }> = {
  ok: { tone: 'ok', label: 'Healthy' },
  attention: { tone: 'warn', label: 'Needs you' },
  inactive: { tone: 'off', label: 'Not connected' },
  sample: { tone: 'off', label: 'Sample data' },
}

const SDK_TONE: Record<SdkDisplayKind, SignalTone | null> = {
  'up-to-date': 'ok',
  'upgrade-available': 'warn',
  deprecated: 'danger',
  'catalog-ahead': 'info',
  unknown: null,
}

// mushi-mushi-allowlist: app track shrinks; the bar column keeps a fixed width
const ROW_WITH_STEPS = 'grid grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_9rem_minmax(0,1fr)]'
// mushi-mushi-allowlist: app track shrinks; the bar column keeps a fixed width
const ROW_NO_STEPS = 'grid grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_9rem]'

function NoData({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-fg-muted">
      <span className="ci-nodata inline-block h-2.5 w-6 rounded-xs border border-edge-subtle" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** The SDK cell of an app with no connected repo: no PR can be opened, so it links to the Update center. */
function SdkCell({ project, updateTo }: { project: Project; updateTo: string | null }) {
  const sdk = resolveSdkDisplay({
    observedVersion: project.sdk_version ?? null,
    latestVersion: project.sdk_latest_version ?? null,
    backendStatus: project.sdk_status,
    deprecated: project.sdk_status === 'deprecated',
  })
  const tone = SDK_TONE[sdk.kind]
  if (!tone) return <NoData label="SDK version not checked" />
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="inline-flex items-center gap-1 font-mono text-2xs whitespace-nowrap text-fg tabular-nums" data-testid={`project-needs-sdk-${project.id}`}>
        <StatusGlyph tone={tone} />
        {sdk.upgradeTarget ? `${project.sdk_version} → ${sdk.upgradeTarget}` : project.sdk_version}
      </span>
      {updateTo && (
        <Link to={updateTo} className="text-2xs font-medium whitespace-nowrap text-brand hover:underline" title="No repo is connected: connect one in the Update center to open a bump PR">
          Update
        </Link>
      )}
    </span>
  )
}

function toBulk(p: Project): BulkUpgradeProject {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sdk_package: p.sdk_package,
    sdk_version: p.sdk_version,
    sdk_latest_version: p.sdk_latest_version,
    sdk_status: p.sdk_status,
    sdk_observation_source: (p as { sdk_observation_source?: string | null }).sdk_observation_source ?? null,
    hasRepo: Boolean(p.primary_repo?.repo_url),
  }
}

export function ProjectNextStepsPanel({ projects }: { projects: Project[] }) {
  const rows = rankProjectNeeds(projects)
  const bulkRows = new Map(rows.filter((r) => r.status.tone !== 'sample' && r.project.primary_repo?.repo_url).map((r) => [r.project.id, toBulk(r.project)] as const))
  const bulk = useBulkSdkUpgrade([...bulkRows.values()])
  if (projects.length === 0) return null
  const maxStuck = Math.max(1, ...rows.map((r) => r.stuck ?? 0))
  const stepsOf = (r: (typeof rows)[number]) => r.status.steps.filter((s) => s.id !== 'upgrade-sdk' && s.id !== 'work-backlog')
  // Hide the column when no app has a step left (2026-11-18 round 2: a column of dashes).
  const showSteps = rows.some((r) => stepsOf(r).length > 0)
  const ROW = showSteps ? ROW_WITH_STEPS : ROW_NO_STEPS
  const noRepo = rows.filter((r) => r.status.tone !== 'sample' && !r.project.primary_repo?.repo_url).length

  return (
    <Card className="overflow-hidden p-0" data-testid="project-needs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-fg">What needs you, per app</h3>
        <BulkUpgradeToolbar bulk={bulk} />
      </div>
      <div role="table" aria-label="What needs you, per app" className="text-xs">
        <div role="row" className={`${ROW} hidden border-b border-edge-subtle text-3xs font-semibold tracking-wide text-fg-secondary uppercase sm:grid`}>
          <span role="columnheader">App</span>
          <span role="columnheader">SDK</span>
          <span role="columnheader">Stuck reports</span>
          {showSteps && <span role="columnheader">Next step</span>}
        </div>
        <div role="rowgroup" className="divide-y divide-edge-subtle">
          {rows.map((row) => {
            const { project, status, stuck } = row
            const verdict = VERDICT[status.tone]
            const upgrade = status.steps.find((s) => s.id === 'upgrade-sdk') ?? null
            const backlog = status.steps.find((s) => s.id === 'work-backlog') ?? null
            const others = stepsOf(row)
            const bulkProject = bulkRows.get(project.id)
            return (
              <div role="row" key={project.id} className={ROW} data-testid={`project-needs-row-${project.id}`}>
                <span role="cell" className="col-span-2 flex min-w-0 items-center gap-1.5 sm:col-span-1">
                  <StatusGlyph tone={verdict.tone} label={verdict.label} />
                  <ProjectFavicon
                    project_id={project.id}
                    project_name={project.name}
                    project_slug={project.slug}
                    sdk_origin={project.api_keys.find((k) => k.last_seen_origin)?.last_seen_origin ?? null}
                    repo_url={project.primary_repo?.repo_url ?? null}
                    size={14}
                  />
                  <span className="min-w-0 font-medium wrap-break-word text-fg" title={project.name}>
                    {project.name}
                  </span>
                  {/* The demo app's name already says "(sample data)": no chip saying it again (round 3). */}
                  {status.tone === 'sample' && !/\(sample data\)\s*$/i.test(project.name) && <Chip className="shrink-0 whitespace-nowrap">sample data</Chip>}
                </span>
                <span role="cell" className="min-w-0">
                  {status.tone === 'sample' ? (
                    <span className="text-fg-faint">—</span>
                  ) : bulkProject ? (
                    <SdkUpgradeCell project={bulkProject} bulk={bulk} />
                  ) : (
                    <SdkCell project={project} updateTo={upgrade?.to ?? null} />
                  )}
                </span>
                <span role="cell" className="flex min-w-0 items-center gap-1.5" title={project.pdca_bottleneck_label ?? undefined} data-testid={`project-needs-stuck-${project.id}`}>
                  <span className="text-3xs text-fg-muted sm:hidden">Stuck</span>
                  {stuck == null ? (
                    <NoData label="Stuck count not known yet" />
                  ) : backlog && stuck > 0 ? (
                    // The bar is the inbox link: one per row instead of an "Open inbox →" column.
                    <Link
                      to={backlog.to}
                      className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      aria-label={`Open the inbox: ${stuck} stuck in ${project.name}`}
                      data-testid={`project-needs-inbox-${project.id}`}
                    >
                      <BarCell value={stuck} max={maxStuck} tone="warn" text={stuck} />
                    </Link>
                  ) : (
                    <BarCell value={stuck} max={maxStuck} tone="neutral" text={stuck} />
                  )}
                </span>
                {showSteps && (
                  <span role="cell" className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 sm:col-span-1">
                    {others.map((step) => (
                      <Link
                        key={step.id}
                        to={step.to}
                        title={`${step.title}. ${step.why}`}
                        className="text-2xs font-medium whitespace-nowrap text-brand hover:underline"
                        data-testid={`project-needs-step-${project.id}-${step.id}`}
                      >
                        {step.ctaLabel} →
                      </Link>
                    ))}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {noRepo > 0 && bulkRows.size > 0 && (
        <p className="border-t border-edge-subtle px-3 py-1.5 text-2xs text-fg-muted" data-testid="project-needs-no-repo">
          {noRepo} {noRepo === 1 ? 'app has' : 'apps have'} no connected repo, so no upgrade PR can be opened for {noRepo === 1 ? 'it' : 'them'}.
        </p>
      )}
    </Card>
  )
}
