/**
 * RadarPanel — the risk checks ("radar") for one project (Plan 020 Phase 1), shown on
 * the Recipe page. Every check is listed; one that never ran says "Not
 * checked yet" and is never shown as passing.
 *
 * Each check that is not met is one row (2026-11-19, owner: "lead with what is wrong and one
 * button"): a status glyph (▲ serious, ◆ warning, ○ could not finish), the check's name, one
 * line of cause and the row's own fix. The dependency check holds one compact table of
 * upgrades (DependencyHolesTable) and a "Fix all" prompt, instead of fifteen sentences with a
 * copy icon each. Checks that never ran and passing checks sit in two closed disclosures.
 * Mushi's own setup checks (gate `radar`) are listed on the Full-stack audit page.
 *
 * Data (fetched by the page and passed in, so the lead and this list read one response):
 *       GET /v1/admin/projects/:id/radar → RadarView
 *       POST /v1/admin/projects/:id/radar/run (202; 1 per 10 min) — useRadarRun
 */

import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Callout, CopyButton, Loading, Section, formatRelative } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { apiFetchMutate } from '../../lib/supabase'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { RadarView } from '../../lib/radarTypes'
import { StatusGlyph, TONE_INK, type SignalTone } from '../signal/StatusGlyph'
import { CopyPromptButton } from '../gates/CopyFixPromptButton'
import { DependencyHolesTable } from '../recipe/DependencyHolesTable'
import { fixAllHolesPrompt, type HoleRow } from '../recipe/dependencyHoles'
import { DEPENDENCY_RULE, rankProblems } from '../recipe/recipeVerdict'
import { groupRadarDetectors, radarBadge, radarErrorSentence } from './portfolioView'

type Detector = RadarView['detectors'][number]

type RadarNotice = { tone: 'info' | 'danger'; text: string } | null

/** "Run checks" (POST …/radar/run): shared by the panel's header and the page's lead. */
export function useRadarRun(projectId: string): { run: () => Promise<void>; running: boolean; notice: RadarNotice } {
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<RadarNotice>(null)
  const run = useCallback(async () => {
    setRunning(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<{ started: boolean }>(`/v1/admin/projects/${projectId}/radar/run`, { method: 'POST', body: '{}' })
      setNotice(res.ok
        ? { tone: 'info', text: 'The checks are running. Refresh in a minute to see the results.' }
        : { tone: 'danger', text: res.error?.message ?? 'The checks could not start.' })
    } finally {
      setRunning(false)
    }
  }, [projectId])
  return { run, running, notice }
}

/** A check's fix prompt: every finding with its own fix, then the rule. */
export function checkFixPrompt(d: Pick<Detector, 'title' | 'reason' | 'findings'>): string {
  const lines = d.findings.map((f) => `- ${f.message.trim()}${f.filePath ? ` (${f.filePath}${f.line != null ? `:${f.line}` : ''})` : ''}${f.fix ? `\n  Fix: ${f.fix.trim()}` : ''}`)
  return [
    `Mushi Mushi's risk check "${d.title}" is not met: ${d.reason.trim()}`,
    lines.join('\n'),
    'Fix each one with the smallest change that makes the check pass, keep the existing behaviour, then run the tests.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function glyphFor(d: Detector): { tone: SignalTone; word: string } {
  if (d.state === 'error') return { tone: 'off', word: 'Could not finish' }
  return radarBadge(d).tone === 'dangerSubtle' ? { tone: 'danger', word: 'Error' } : { tone: 'warn', word: 'Warning' }
}

export function RadarPanel({
  radar,
  holes,
  run,
  running,
  notice,
}: {
  radar: { data: RadarView | null; loading: boolean; error: string | null; reload: () => void; path: string }
  /** Open dependency holes as rows (dev-only included, worst first); null while unread. */
  holes: HoleRow[] | null
  run: () => void
  running: boolean
  notice: RadarNotice
}) {
  const { data, loading, error, reload, path } = radar
  const groups = data ? groupRadarDetectors(data.detectors) : null
  const problems = groups ? rankProblems(groups.problems) : []

  return (
    <Section
      title="Risk checks"
      action={
        <Btn size="sm" variant="ghost" onClick={run} loading={running} disabled={running} title="Run every risk check for this app now">
          Run checks
        </Btn>
      }
    >
      <p className="mb-2 text-xs text-fg-muted">
        Problems that never throw an error: store rules, an expiring domain, a broken privacy link, a known hole in a dependency.
      </p>
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {error && <PageLoadError error={error} resource="the radar checks" endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the risk checks…" />}
      {groups && (
        <div className="flex flex-col gap-2">
          {problems.length > 0 ? (
            <ul className="flex flex-col divide-y divide-edge-subtle" data-testid="radar-problems" aria-label={`${problems.length} not met`}>
              {problems.map((d) => (
                <ProblemRow key={d.ruleId} d={d} holes={d.ruleId === DEPENDENCY_RULE ? holes : null} onRerun={run} running={running} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <StatusGlyph tone={groups.passing.length > 0 ? 'ok' : 'off'} />
              {groups.passing.length > 0 ? 'No check found a problem.' : 'No check has a result yet.'}
            </p>
          )}
          {groups.notChecked.length > 0 && (
            <details className="rounded-sm border border-edge-subtle px-2.5 py-1.5">
              <summary className="cursor-pointer text-xs text-fg-secondary hover:text-fg">
                <StatusGlyph tone="off" className="mr-1 inline" />
                {groups.notChecked.length} not checked yet (not a pass)
              </summary>
              <QuietList detectors={groups.notChecked} />
            </details>
          )}
          {groups.passing.length > 0 && (
            <details className="rounded-sm border border-edge-subtle px-2.5 py-1.5">
              <summary className="cursor-pointer text-xs text-fg-secondary hover:text-fg">
                <StatusGlyph tone="ok" className="mr-1 inline" />
                {groups.passing.length} passing
              </summary>
              <QuietList detectors={groups.passing} />
            </details>
          )}
        </div>
      )}
      <p className="mt-2 border-t border-edge-subtle pt-2 text-2xs text-fg-muted">
        Mushi Mushi's own setup checks (provider keys, spend caps, webhooks, index freshness) are on the{' '}
        <Link to="/fullstack-audit" className={LINK_ACCENT}>Full-stack audit</Link> page.
      </p>
    </Section>
  )
}

/** One check that is not met: glyph, name, one line of cause, the fix; findings under it. */
function ProblemRow({ d, holes, onRerun, running }: { d: Detector; holes: HoleRow[] | null; onRerun: () => void; running: boolean }) {
  const g = glyphFor(d)
  const dependency = d.ruleId === DEPENDENCY_RULE && d.state === 'finding' && holes != null && holes.length > 0
  const cause = d.state === 'error' ? radarErrorSentence(d.checkedAt, formatRelative) : d.reason
  return (
    <li className="flex flex-col gap-1.5 py-2" data-testid="radar-problem" data-rule={d.ruleId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusGlyph tone={g.tone} label={g.word} />
        <span className="min-w-0 flex-1 basis-56">
          <span className="text-sm font-semibold text-fg" title={d.prevents}>{d.title}</span>
          <span className={`ml-2 text-2xs font-bold uppercase ${TONE_INK[g.tone]}`}>{d.state === 'error' ? 'could not finish' : 'not met'}</span>
          <span className="block truncate text-xs text-fg-secondary" title={cause}>{cause}</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {d.state === 'error' ? (
            <Btn size="sm" variant="ghost" onClick={onRerun} loading={running} disabled={running}>
              Run again
            </Btn>
          ) : dependency ? (
            <CopyPromptButton text={fixAllHolesPrompt(holes!)} label="Fix all: copy prompt" title="One prompt for your editor that makes every upgrade below" testId="copy-fix-all-holes" />
          ) : d.findings.length > 0 ? (
            <CopyPromptButton text={checkFixPrompt(d)} label="Copy fix prompt" testId="copy-check-prompt" />
          ) : null}
        </span>
      </div>
      {d.state === 'error' && (
        <details className="pl-5 text-2xs text-fg-muted">
          <summary className="cursor-pointer hover:text-fg-secondary">Details</summary>
          <p className="mt-1 font-mono wrap-break-word">{d.reason}</p>
        </details>
      )}
      {dependency ? (
        <div className="pl-5">
          <DependencyHolesTable rows={holes!} />
        </div>
      ) : d.findings.length > 0 ? (
        <FindingList findings={d.findings} />
      ) : null}
    </li>
  )
}

/** A check's findings, each with its own copy icon; past three they sit behind a disclosure. */
function FindingList({ findings }: { findings: Detector['findings'] }) {
  const rows = (list: Detector['findings']) => (
    <ul className="flex flex-col gap-0.5 border-l-2 border-edge-subtle pl-2.5" data-testid="radar-findings">
      {list.map((f) => (
        <li key={f.id} className="flex items-start justify-between gap-2 text-xs">
          <span className="min-w-0 text-fg">{f.message}</span>
          {f.fix && (
            <span className="shrink-0">
              <CopyButton value={`${f.message}\n\nFix: ${f.fix}`} label="Copy fix prompt" />
            </span>
          )}
        </li>
      ))}
    </ul>
  )
  if (findings.length <= 3) return <div className="pl-5">{rows(findings)}</div>
  return (
    <details className="pl-5">
      <summary className="cursor-pointer text-xs text-fg-secondary hover:text-fg">{findings.length} findings</summary>
      <div className="mt-1">{rows(findings)}</div>
    </details>
  )
}

/** Checks with nothing to fix: one line each, the name and why. */
function QuietList({ detectors }: { detectors: Detector[] }) {
  return (
    <ul className="mt-1.5 flex flex-col divide-y divide-edge-subtle">
      {detectors.map((d) => (
        <li key={d.ruleId} className="flex flex-col py-1">
          <span className="text-xs font-medium text-fg" title={d.prevents}>{d.title}</span>
          <span className="text-2xs text-fg-secondary">{d.reason}</span>
        </li>
      ))}
    </ul>
  )
}
