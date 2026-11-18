/**
 * FILE: apps/admin/src/components/projects/ProjectNextStepsPanel.tsx
 * PURPOSE: "What does each project need from me?" as one table (fresh-eyes review 2026-11-18;
 *          it was one card per project, each repeating the same two sentences): app, SDK
 *          version, stuck count as a bar, next step. Worst first (most stuck, `rankProjectNeeds`).
 *          The SDK update link sits in the SDK cell; the other steps are links in the last column,
 *          each with its reason as a title. Unknown is hatched, never 0. Renders on the Projects
 *          overview tab from data the page already fetched.
 */

import { Link } from 'react-router-dom'
import type { Project } from './project-models'
import { rankProjectNeeds, type ProjectVerdictTone } from './projectNextSteps'
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
const ROW = 'grid grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_minmax(0,1.2fr)]'

function NoData({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-fg-muted">
      <span className="ci-nodata inline-block h-2.5 w-6 rounded-xs border border-edge-subtle" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

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
        <Link to={updateTo} className="text-2xs font-medium whitespace-nowrap text-brand hover:underline" title="Opens a version-bump PR on your repo">
          Update
        </Link>
      )}
    </span>
  )
}

export function ProjectNextStepsPanel({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null
  const rows = rankProjectNeeds(projects)
  const maxStuck = Math.max(1, ...rows.map((r) => r.stuck ?? 0))

  return (
    <Card className="overflow-hidden p-0" data-testid="project-needs">
      <h3 className="border-b border-edge-subtle px-3 py-2 text-sm font-semibold text-fg">What needs you, per project</h3>
      <div role="table" aria-label="What needs you, per project" className="text-xs">
        <div role="row" className={`${ROW} hidden border-b border-edge-subtle text-3xs font-semibold tracking-wide text-fg-secondary uppercase sm:grid`}>
          <span role="columnheader">App</span>
          <span role="columnheader">SDK</span>
          <span role="columnheader">Stuck</span>
          <span role="columnheader">Next step</span>
        </div>
        <div role="rowgroup" className="divide-y divide-edge-subtle">
          {rows.map(({ project, status, stuck }) => {
            const verdict = VERDICT[status.tone]
            const upgrade = status.steps.find((s) => s.id === 'upgrade-sdk') ?? null
            const others = status.steps.filter((s) => s.id !== 'upgrade-sdk')
            return (
              <div role="row" key={project.id} className={ROW} data-testid={`project-needs-row-${project.id}`}>
                <span role="cell" className="flex min-w-0 items-center gap-1.5">
                  <StatusGlyph tone={verdict.tone} label={verdict.label} />
                  <ProjectFavicon
                    project_id={project.id}
                    project_name={project.name}
                    project_slug={project.slug}
                    sdk_origin={project.api_keys.find((k) => k.last_seen_origin)?.last_seen_origin ?? null}
                    repo_url={project.primary_repo?.repo_url ?? null}
                    size={14}
                  />
                  <span className="truncate font-medium text-fg" title={project.name}>
                    {project.name}
                  </span>
                  {status.tone === 'sample' && <Chip className="shrink-0 whitespace-nowrap">sample data</Chip>}
                </span>
                <span role="cell" className="min-w-0">
                  {status.tone === 'sample' ? <span className="text-fg-faint">—</span> : <SdkCell project={project} updateTo={upgrade?.to ?? null} />}
                </span>
                <span role="cell" className="flex min-w-0 items-center gap-1.5" title={project.pdca_bottleneck_label ?? undefined} data-testid={`project-needs-stuck-${project.id}`}>
                  <span className="text-3xs text-fg-muted sm:hidden">Stuck</span>
                  {stuck == null ? <NoData label="Stuck count not known yet" /> : <BarCell value={stuck} max={maxStuck} tone={stuck > 0 ? 'danger' : 'neutral'} text={stuck} />}
                </span>
                <span role="cell" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                  {others.length === 0 ? (
                    <span className="text-fg-faint">—</span>
                  ) : (
                    others.map((step) => (
                      <Link
                        key={step.id}
                        to={step.to}
                        title={`${step.title}. ${step.why}`}
                        className="text-2xs font-medium whitespace-nowrap text-brand hover:underline"
                        data-testid={`project-needs-step-${project.id}-${step.id}`}
                      >
                        {step.ctaLabel} →
                      </Link>
                    ))
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
