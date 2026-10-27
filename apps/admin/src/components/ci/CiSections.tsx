/**
 * FILE: apps/admin/src/components/ci/CiSections.tsx
 * PURPOSE: The read-only sections of /ci under the queue and map:
 *          "Speed it up" advice (one card per rule, ciAdvice.ts; "Open fix PR"
 *          where Mushi can edit the workflow, CiCostFixButton), slowest
 *          jobs and steps in full with bars against the slowest, and recent
 *          test machine failures with links to GitHub. Plain words throughout.
 */

import type { CiAdvice, CiJob, CiOverview } from '../../lib/ciTypes'
import { formatSeconds, jobOutcome, recentInfraFailures, repoShortName, runnerDisplayName, slowestJobs } from '../../lib/ciView'
import { groupCiAdvice, type CiAdviceGroup } from '../../lib/ciAdvice'
import { Badge, Card, CodeChip, CopyButton, DataTableCell, DataTableHead, MiniInlineBar, RelativeTime, type BadgeTone } from '../ui'
import { IconExternalLink, IconInfo } from '../icons'
import { CiJobOutcomeChip } from './CiJobOutcomeChip'
import { CI_OUTCOME_STYLE } from './ciOutcome'
import { CiCostFixButton, costFixKey, useCostFixJobs } from './CiCostFixButton'
import type { CiCostFixJob } from '../../lib/ciCostFix'

const SEVERITY: Record<CiAdvice['severity'], { tone: BadgeTone; label: string }> = {
  high: { tone: 'dangerSubtle', label: 'High' },
  medium: { tone: 'warnSubtle', label: 'Medium' },
  low: { tone: 'neutral', label: 'Low' },
}

function AdviceCard({ group, jobs }: { group: CiAdviceGroup; jobs: Map<string, CiCostFixJob> }) {
  const sev = SEVERITY[group.severity]
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={sev.tone}>{sev.label}</Badge>
        <span className="text-sm font-medium text-fg">{group.title}</span>
        {group.count > 1 && <span className="text-2xs text-fg-muted">{group.count} places</span>}
      </div>
      {group.targets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Applies to">
          {group.targets.map((t) => (
            <li key={t.key} className="min-w-0 max-w-full">
              <CodeChip title={t.title} maxWidthClass="max-w-full">
                {t.label}
              </CodeChip>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-secondary">{group.detail}</p>
      <div className="text-2xs text-fg-muted">
        <p className="flex items-center gap-1 font-medium">
          <IconInfo size={12} className="shrink-0" />
          Why Mushi thinks so
        </p>
        {group.evidence.length === 1 ? (
          <p className="mt-0.5 wrap-break-word pl-4">{group.evidence[0]}</p>
        ) : (
          <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-8">
            {group.evidence.map((line) => (
              <li key={line} className="wrap-break-word">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
      {group.fixes.map((fix) => (
        <div key={fix} className="flex items-start gap-2 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-1.5">
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-2xs text-fg">{fix}</pre>
          <CopyButton value={fix} label="Copy the fix" />
        </div>
      ))}
      {group.fixable.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-edge-subtle pt-2" aria-label="Fix with a pull request">
          <p className="text-2xs text-fg-muted">Or let Mushi open it as a draft pull request for you to review:</p>
          {group.fixable.map((f) => (
            <CiCostFixButton key={f.key} fixable={f} initialJob={jobs.get(costFixKey(f.autofix)) ?? null} />
          ))}
        </div>
      )}
    </Card>
  )
}

export function CiAdviceList({ advice }: { advice: CiAdvice[] }) {
  const jobs = useCostFixJobs(advice.flatMap((a) => (a.autofix ? [a.autofix.projectId] : [])))
  if (advice.length === 0) {
    return <p className="text-xs text-fg-muted">Nothing to speed up right now: no rule found a slow spot in this window.</p>
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="ci-advice">
      {groupCiAdvice(advice).map((g) => (
        <li key={g.key}>
          <AdviceCard group={g} jobs={jobs} />
        </li>
      ))}
    </ul>
  )
}

/** A duration with a bar sized against the slowest row, number first for readers. */
function DurationCell({ seconds, max, barClassName, label }: { seconds: number | null; max: number; barClassName: string; label: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <MiniInlineBar value={seconds ?? 0} max={max} widthClass="w-16" barClassName={barClassName} aria-label={label} />
      <span className="w-14 shrink-0 text-right tabular-nums text-fg-secondary">{formatSeconds(seconds)}</span>
    </div>
  )
}

function SlowJobsTable({ jobs }: { jobs: CiJob[] }) {
  const max = Math.max(1, ...jobs.map((j) => j.durationSeconds ?? 0))
  return (
    <table className="w-full text-xs" data-testid="ci-slow-jobs">
      <thead>
        <tr className="border-b border-edge-subtle">
          <DataTableHead>Job</DataTableHead>
          <DataTableHead>Result</DataTableHead>
          <DataTableHead align="right">Ran</DataTableHead>
        </tr>
      </thead>
      <tbody className="divide-y divide-edge-subtle">
        {jobs.map((j) => {
          const outcome = jobOutcome(j)
          return (
            <tr key={j.id}>
              <DataTableCell>
                {j.htmlUrl ? (
                  <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 wrap-break-word font-medium text-accent hover:underline">
                    <span className="min-w-0 wrap-break-word">{j.jobName}</span>
                    <IconExternalLink size={10} className="mt-0.5 shrink-0" />
                  </a>
                ) : (
                  <span className="block wrap-break-word font-medium text-fg">{j.jobName}</span>
                )}
                {j.workflowName && <span className="block wrap-break-word text-2xs text-fg-muted">{j.workflowName}</span>}
                <span className="block text-2xs text-fg-faint" title={j.repo}>
                  {repoShortName(j.repo)}
                  {j.prNumber ? ` · PR #${j.prNumber}` : ''}
                </span>
              </DataTableCell>
              <DataTableCell>
                <CiJobOutcomeChip outcome={outcome} />
              </DataTableCell>
              <DataTableCell align="right">
                <DurationCell
                  seconds={j.durationSeconds}
                  max={max}
                  barClassName={CI_OUTCOME_STYLE[outcome].fill}
                  label={`${j.jobName} ran ${formatSeconds(j.durationSeconds)}`}
                />
              </DataTableCell>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SlowStepsTable({ steps }: { steps: CiOverview['stats']['slowSteps'] }) {
  const max = Math.max(1, ...steps.map((s) => s.p50s))
  return (
    <table className="w-full text-xs" data-testid="ci-slow-steps">
      <thead>
        <tr className="border-b border-edge-subtle">
          <DataTableHead>Step</DataTableHead>
          <DataTableHead align="right">Typical</DataTableHead>
          <DataTableHead align="right">Runs</DataTableHead>
        </tr>
      </thead>
      <tbody className="divide-y divide-edge-subtle">
        {steps.map((s) => (
          <tr key={`${s.repo}:${s.job}:${s.step}`}>
            <DataTableCell>
              <span className="block wrap-break-word font-medium text-fg">{s.step}</span>
              <span className="block wrap-break-word text-2xs text-fg-faint" title={`${s.repo} · ${s.job}`}>
                {s.job} · {repoShortName(s.repo)}
              </span>
            </DataTableCell>
            <DataTableCell align="right">
              <DurationCell seconds={s.p50s} max={max} barClassName="bg-brand" label={`${s.step} typically takes ${formatSeconds(s.p50s)}`} />
            </DataTableCell>
            <DataTableCell align="right" className="tabular-nums text-fg-muted">
              {s.runs}
            </DataTableCell>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function CiSlowJobs({ jobs, slowSteps }: { jobs: CiJob[]; slowSteps: CiOverview['stats']['slowSteps'] }) {
  const slow = slowestJobs(jobs, 8)
  const steps = [...slowSteps].sort((a, b) => b.p50s - a.p50s).slice(0, 8)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="min-w-0">
        <h3 className="mb-1.5 text-xs font-semibold text-fg">Slowest jobs</h3>
        {slow.length === 0 ? <p className="text-xs text-fg-muted">No finished jobs in this window.</p> : <SlowJobsTable jobs={slow} />}
      </div>
      <div className="min-w-0">
        <h3 className="mb-1.5 text-xs font-semibold text-fg">Slowest steps</h3>
        <p className="mb-1.5 text-2xs text-fg-muted">Typical time is the median over the runs Mushi holds.</p>
        {steps.length === 0 ? <p className="text-xs text-fg-muted">No step timings yet.</p> : <SlowStepsTable steps={steps} />}
      </div>
    </div>
  )
}

export function CiInfraFailures({ jobs }: { jobs: CiJob[] }) {
  const list = recentInfraFailures(jobs, 10)
  if (list.length === 0) {
    return <p className="text-xs text-fg-muted">No test machine stopped a job in this window.</p>
  }
  return (
    <ul className="flex flex-col divide-y divide-edge-subtle" data-testid="ci-infra-failures">
      {list.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-xs">
          <CiJobOutcomeChip job={j} />
          <span className="min-w-0 truncate font-medium text-fg">{j.jobName}</span>
          <span className="text-fg-faint">
            {j.repo}
            {j.prNumber ? ` · PR #${j.prNumber}` : ''}
            {runnerDisplayName(j) ? ` · ${runnerDisplayName(j)}` : ''}
          </span>
          <span className="ml-auto text-2xs text-fg-muted">
            <RelativeTime value={j.completedAt ?? j.createdAt} />
          </span>
          {j.htmlUrl && (
            <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-2xs font-medium text-accent hover:underline">
              GitHub
              <IconExternalLink size={10} />
            </a>
          )}
          {j.infraDetail && <p className="w-full text-2xs text-fg-muted">{j.infraDetail}</p>}
        </li>
      ))}
    </ul>
  )
}
