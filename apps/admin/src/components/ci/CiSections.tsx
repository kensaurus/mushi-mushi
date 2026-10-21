/**
 * FILE: apps/admin/src/components/ci/CiSections.tsx
 * PURPOSE: The read-only sections of /ci under the queue and map:
 *          "Speed it up" advice, slowest jobs and steps, and recent test
 *          machine failures with links to GitHub. Plain words throughout.
 */

import type { CiAdvice, CiJob, CiOverview } from '../../lib/ciTypes'
import { formatSeconds, recentInfraFailures, runnerDisplayName, slowestJobs } from '../../lib/ciView'
import { Badge, Card, CopyButton, RelativeTime, type BadgeTone } from '../ui'
import { CiJobOutcomeChip } from './CiJobOutcomeChip'

const SEVERITY: Record<CiAdvice['severity'], { tone: BadgeTone; label: string }> = {
  high: { tone: 'dangerSubtle', label: 'High' },
  medium: { tone: 'warnSubtle', label: 'Medium' },
  low: { tone: 'neutral', label: 'Low' },
}

export function CiAdviceList({ advice }: { advice: CiAdvice[] }) {
  if (advice.length === 0) {
    return <p className="text-xs text-fg-muted">Nothing to speed up right now: no rule found a slow spot in this window.</p>
  }
  const order = { high: 0, medium: 1, low: 2 } as const
  const sorted = [...advice].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <ul className="flex flex-col gap-2" data-testid="ci-advice">
      {sorted.map((a) => (
        <li key={a.id}>
          <Card className="flex flex-col gap-1.5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge>
            <span className="text-sm font-medium text-fg">{a.title}</span>
            {(a.repo || a.runner) && <span className="text-2xs text-fg-faint">{[a.repo, a.runner].filter(Boolean).join(' · ')}</span>}
          </div>
          <p className="text-xs text-fg-secondary">{a.detail}</p>
          <p className="text-2xs text-fg-muted">
            <span className="font-medium">Why Mushi thinks so:</span> {a.evidence}
          </p>
          <div className="flex items-start gap-2 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-1.5">
            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-2xs text-fg">{a.fix}</pre>
            <CopyButton value={a.fix} label="Copy the fix" />
          </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}

export function CiSlowJobs({ jobs, slowSteps }: { jobs: CiJob[]; slowSteps: CiOverview['stats']['slowSteps'] }) {
  const slow = slowestJobs(jobs, 8)
  const steps = [...slowSteps].sort((a, b) => b.p50s - a.p50s).slice(0, 8)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <h3 className="mb-1.5 text-xs font-semibold text-fg">Slowest jobs</h3>
        {slow.length === 0 ? (
          <p className="text-xs text-fg-muted">No finished jobs in this window.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs text-fg-muted">
                <th className="py-1 font-medium">Job</th>
                <th className="py-1 font-medium">Result</th>
                <th className="py-1 text-right font-medium">Ran</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-subtle">
              {slow.map((j) => (
                <tr key={j.id}>
                  <td className="max-w-0 py-1.5 pr-2">
                    {j.htmlUrl ? (
                      <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-accent hover:underline">
                        {j.jobName}
                      </a>
                    ) : (
                      <span className="block truncate font-medium text-fg">{j.jobName}</span>
                    )}
                    <span className="block truncate text-2xs text-fg-faint">{j.repo}</span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <CiJobOutcomeChip job={j} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-fg-secondary">{formatSeconds(j.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="mb-1.5 text-xs font-semibold text-fg">Slowest steps</h3>
        {steps.length === 0 ? (
          <p className="text-xs text-fg-muted">No step timings yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs text-fg-muted">
                <th className="py-1 font-medium">Step</th>
                <th className="py-1 text-right font-medium">Typical</th>
                <th className="py-1 text-right font-medium">Runs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-subtle">
              {steps.map((s) => (
                <tr key={`${s.repo}:${s.job}:${s.step}`}>
                  <td className="max-w-0 py-1.5 pr-2">
                    <span className="block truncate font-medium text-fg">{s.step}</span>
                    <span className="block truncate text-2xs text-fg-faint">
                      {s.repo} · {s.job}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-fg-secondary">{formatSeconds(s.p50s)}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{s.runs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
            <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-2xs font-medium text-accent hover:underline">
              GitHub ↗
            </a>
          )}
          {j.infraDetail && <p className="w-full text-2xs text-fg-muted">{j.infraDetail}</p>}
        </li>
      ))}
    </ul>
  )
}
