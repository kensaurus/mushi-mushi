/**
 * FILE: apps/admin/src/components/ci/CiSections.tsx
 * PURPOSE: The read-only sections of /ci under the queue and map:
 *          "Speed it up" advice (one card per rule, ciAdvice.ts; "Open fix PR"
 *          where Mushi can edit the workflow, CiCostFixButton), slowest
 *          jobs and steps in full with bars against the slowest, and recent
 *          test machine failures with links to GitHub. Plain words throughout.
 */

import { useState } from 'react'
import type { CiAdvice, CiJob, CiOverview } from '../../lib/ciTypes'
import { formatSeconds, groupInfraFailures, groupSlowSteps, jobOutcome, recentInfraFailures, repoShortName, runnerDisplayName, slowestJobs } from '../../lib/ciView'
import { groupCiAdvice, targetTitle, type CiAdviceGroup } from '../../lib/ciAdvice'
import { Btn, CodeChip, CopyButton, DataTableCell, DataTableHead, MiniInlineBar, RelativeTime } from '../ui'
import { IconExternalLink, IconInfo } from '../icons'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'
import { CiJobOutcomeChip } from './CiJobOutcomeChip'
import { CiCostFixButton, costFixKey, useCostFixJobs } from './CiCostFixButton'
import type { CiCostFixJob } from '../../lib/ciCostFix'

/** Severity as a mark (high, medium, low as the triangle, diamond, square), not a text pill; the word stays for readers and on hover. */
const SEVERITY: Record<CiAdvice['severity'], { tone: SignalTone; label: string }> = {
  high: { tone: 'danger', label: 'High' },
  medium: { tone: 'warn', label: 'Medium' },
  low: { tone: 'info', label: 'Low' },
}

/** "Open fix PR" buttons shown inline; more than this fold behind one disclosure (11 stacked on 2026-11-18). */
const FIX_BUTTONS_INLINE = 2

/** Cards a list shows before "Show N more" (most severe first; 2026-11-06: 65 cost advice cards were 16,000 px). */
const ADVICE_CARDS_SHOWN = 5
/** Evidence lines a card shows before "Show N more" (one card listed 28). */
const ADVICE_EVIDENCE_SHOWN = 5

function AdviceCard({ group, jobs }: { group: CiAdviceGroup; jobs: Map<string, CiCostFixJob> }) {
  const sev = SEVERITY[group.severity]
  const [allEvidence, setAllEvidence] = useState(false)
  const evidence = allEvidence ? group.evidence : group.evidence.slice(0, ADVICE_EVIDENCE_SHOWN)
  const hiddenEvidence = group.evidence.length - evidence.length
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center" title={`${sev.label} impact`} data-testid="ci-advice-severity" data-severity={group.severity}>
          <StatusGlyph tone={sev.tone} label={`${sev.label} impact`} />
        </span>
        <span className="text-sm font-medium text-fg">{group.title}</span>
        {group.count > 1 && <span className={`font-mono text-2xs font-bold whitespace-nowrap text-fg-secondary tabular-nums`}>{group.count} places</span>}
      </div>
      {group.targets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Applies to">
          {group.targets.map((t) => (
            <li key={t.key} className="min-w-0 max-w-full">
              <CodeChip title={targetTitle(t, group.evidence)} maxWidthClass="max-w-full">
                {t.label}
              </CodeChip>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-secondary">{group.detail}</p>
      {/* One line per chip that only names the chip again: the chips carry it on hover instead. */}
      {!group.evidenceRepeatsTargets && (
      <div className="text-2xs text-fg-muted">
        <p className="flex items-center gap-1 font-medium">
          <IconInfo size={12} className="shrink-0" />
          Why Mushi Mushi thinks so
        </p>
        {group.evidence.length === 1 ? (
          <p className="mt-0.5 wrap-break-word pl-4">{group.evidence[0]}</p>
        ) : (
          <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-8">
            {evidence.map((line) => (
              <li key={line} className="wrap-break-word">
                {line}
              </li>
            ))}
          </ul>
        )}
        {(hiddenEvidence > 0 || allEvidence) && (
          <Btn size="sm" variant="ghost" className="mt-0.5 ml-4" onClick={() => setAllEvidence((v) => !v)} aria-expanded={allEvidence}>
            {allEvidence ? 'Show less' : `Show ${hiddenEvidence} more`}
          </Btn>
        )}
      </div>
      )}
      {group.fixes.map((fix) => (
        <div key={fix} className="flex items-start gap-2 rounded-sm bg-surface-overlay/60 px-2 py-1.5">
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-2xs text-fg">{fix}</pre>
          <CopyButton value={fix} label="Copy the fix" />
        </div>
      ))}
      {group.fixable.length > 0 && group.fixable.length <= FIX_BUTTONS_INLINE && (
        <div className="flex flex-col gap-2" aria-label="Fix with a pull request">
          <p className="text-2xs text-fg-muted">Or let Mushi Mushi open it as a draft pull request for you to review:</p>
          {group.fixable.map((f) => (
            <CiCostFixButton key={f.key} fixable={f} initialJob={jobs.get(costFixKey(f.autofix)) ?? null} />
          ))}
        </div>
      )}
      {group.fixable.length > FIX_BUTTONS_INLINE && (
        // One control for many workflows; each still opens its own draft PR inside (kept mounted, so states survive).
        <details className="text-2xs" aria-label="Fix with a pull request" data-testid="ci-advice-fix-prs">
          <summary className="cursor-pointer font-medium whitespace-nowrap text-fg-secondary hover:text-fg">
            Open draft fix PRs for {group.fixable.length} workflows
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {group.fixable.map((f) => (
              <CiCostFixButton key={f.key} fixable={f} initialJob={jobs.get(costFixKey(f.autofix)) ?? null} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export function CiAdviceList({ advice }: { advice: CiAdvice[] }) {
  const jobs = useCostFixJobs(advice.flatMap((a) => (a.autofix ? [a.autofix.projectId] : [])))
  const [all, setAll] = useState(false)
  if (advice.length === 0) {
    return <p className="text-xs text-fg-muted">Nothing to speed up right now: no rule found a slow spot in this window.</p>
  }
  // groupCiAdvice sorts most severe first, so the first cards are the ones to act on.
  const groups = groupCiAdvice(advice)
  const shown = all ? groups : groups.slice(0, ADVICE_CARDS_SHOWN)
  const hidden = groups.length - shown.length
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-edge-subtle" data-testid="ci-advice">
        {shown.map((g) => (
          <li key={g.key}>
            <AdviceCard group={g} jobs={jobs} />
          </li>
        ))}
      </ul>
      {(hidden > 0 || all) && (
        <div>
          <Btn size="sm" variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="ci-advice-more">
            {all ? 'Show the most important only' : `Show ${hidden} more`}
          </Btn>
        </div>
      )}
    </div>
  )
}

/** A duration with a bar sized against the slowest row, number first for readers. */
// A duration bar is neutral grey: colour on this page means an outcome, and a long run is not a failure.
function DurationCell({ seconds, max, label }: { seconds: number | null; max: number; label: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <MiniInlineBar value={seconds ?? 0} max={max} widthClass="w-16" barClassName="bg-fg-secondary" aria-label={label} />
      <span className="w-14 shrink-0 text-right whitespace-nowrap tabular-nums text-fg-secondary">{formatSeconds(seconds)}</span>
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
                  <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 wrap-anywhere font-medium text-accent hover:underline">
                    <span className="min-w-0 wrap-anywhere">{j.jobName}</span>
                    <IconExternalLink size={10} className="mt-0.5 shrink-0" />
                  </a>
                ) : (
                  <span className="block wrap-anywhere font-medium text-fg">{j.jobName}</span>
                )}
                {j.workflowName && <span className="block wrap-anywhere text-2xs text-fg-muted">{j.workflowName}</span>}
                <span className="block text-2xs text-fg-faint" title={j.repo}>
                  {repoShortName(j.repo)}
                  {j.prNumber ? ` · PR #${j.prNumber}` : ''}
                </span>
              </DataTableCell>
              <DataTableCell>
                <CiJobOutcomeChip outcome={outcome} />
              </DataTableCell>
              <DataTableCell align="right">
                <DurationCell seconds={j.durationSeconds} max={max} label={`${j.jobName} ran ${formatSeconds(j.durationSeconds)}`} />
              </DataTableCell>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SlowStepsTable({ steps }: { steps: ReturnType<typeof groupSlowSteps> }) {
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
          <tr key={`${s.repo}:${s.job}:${s.step}`} data-shards={s.shards > 1 ? s.shards : undefined}>
            <DataTableCell>
              <span className="block wrap-anywhere font-medium text-fg">{s.step}</span>
              <span className="block wrap-anywhere text-2xs text-fg-faint" title={`${s.repo} · ${s.job}`}>
                {s.job}
                {s.shards > 1 && <span className="font-mono font-bold text-fg-secondary"> ×{s.shards} shards</span>} · {repoShortName(s.repo)}
              </span>
            </DataTableCell>
            <DataTableCell align="right">
              <DurationCell seconds={s.p50s} max={max} label={`${s.step} typically takes ${formatSeconds(s.p50s)}${s.shards > 1 ? ` (slowest of ${s.shards} shards)` : ''}`} />
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
  // Matrix shards of one job ("Browser gates (1/4)" to "(4/4)") fold into one row.
  const steps = groupSlowSteps(slowSteps).slice(0, 8)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="min-w-0 overflow-x-auto">
        <h3 className="mb-1.5 text-xs font-semibold text-fg">Slowest jobs</h3>
        {slow.length === 0 ? <p className="text-xs text-fg-muted">No finished jobs in this window.</p> : <SlowJobsTable jobs={slow} />}
      </div>
      <div className="min-w-0 overflow-x-auto">
        <h3 className="mb-1.5 text-xs font-semibold text-fg">Slowest steps</h3>
        <p className="mb-1.5 text-2xs text-fg-muted">Typical time is the median over the runs Mushi Mushi holds.</p>
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
  const groups = groupInfraFailures(list)
  return (
    <div data-testid="ci-infra-failures">
      {/* The reason once, for every row below (it repeated on all seven, 2026-11-18). */}
      <p className="mb-1.5 max-w-[80ch] text-xs text-fg-secondary">
        The machine lost touch with GitHub before these jobs finished (it crashed, ran out of memory or lost its network), so the code was never
        tested. They are not code failures: re-run them on GitHub.
      </p>
      <ul className="flex flex-col divide-y divide-edge-subtle">
        {groups.map((g) => (
          <li key={g.key} className="py-1.5 text-xs" data-testid={`ci-infra-group-${g.key}`}>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <StatusGlyph tone="warn" label="Test machine stopped" />
              <span className="font-semibold text-fg" title={g.repo}>
                {repoShortName(g.repo)}
              </span>
              <span className="font-mono text-2xs text-fg-secondary">{g.prNumber ? `PR #${g.prNumber}` : 'no PR'}</span>
              {g.jobs.length > 1 && <span className="font-mono text-2xs font-bold whitespace-nowrap text-warn-foreground tabular-nums">{g.jobs.length} jobs</span>}
            </p>
            <ul className="mt-0.5 flex flex-col">
              {g.jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 pl-5">
                  <span className="min-w-0 truncate font-medium text-fg">{j.jobName}</span>
                  {runnerDisplayName(j) && <span className="text-2xs text-fg-faint">{runnerDisplayName(j)}</span>}
                  <span className="ml-auto text-2xs whitespace-nowrap text-fg-muted">
                    <RelativeTime value={j.completedAt ?? j.createdAt} />
                  </span>
                  {j.htmlUrl && (
                    <a
                      href={j.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-2xs font-medium whitespace-nowrap text-accent hover:underline"
                      title="Open the job on GitHub to re-run it"
                    >
                      Re-run on GitHub
                      <IconExternalLink size={10} />
                    </a>
                  )}
                  {j.infraDetail && (
                    <details className="w-full text-2xs text-fg-muted">
                      <summary className="cursor-pointer">GitHub’s message</summary>
                      <p className="mt-0.5">{j.infraDetail}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
