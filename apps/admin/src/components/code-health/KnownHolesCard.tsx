/**
 * KnownHolesCard — known holes in this app's dependencies and runtime
 * (ADR 0038), on App health → Code. Not a "Security" page: a hole is a bug
 * the user has not hit yet, so each one fileable becomes a normal report.
 *
 * One row per upgrade (package or runtime → the version that fixes every
 * advisory on it). Never green by default: before the first check, or when a
 * check could not read the repo or a feed, the card says so.
 *
 * Data: GET   /v1/admin/projects/:id/vulnerabilities
 *       POST  /v1/admin/projects/:id/vulnerabilities/scan     (202, 6/h)
 *       PATCH /v1/admin/projects/:id/vulnerabilities/groups   dismiss / reopen
 *       PUT   /v1/admin/projects/:id/vulnerabilities/settings reports a day
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Callout, Loading, Section, formatRelative, type BadgeTone } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { LINK_ACCENT } from '../../lib/chipTone'

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface KnownHoleGroup {
  groupKey: string
  kind: 'package' | 'runtime'
  ecosystem: string
  package: string
  installed: string[]
  target: string | null
  direct: boolean
  dev: boolean
  severity: Severity
  kev: boolean
  epss: number | null
  imported: boolean
  sources: Array<{ path: string; line: number | null }>
  status: 'open' | 'dismissed'
  dismissedReason: string | null
  reportId: string | null
  firstSeenAt: string
  advisories: Array<{ id: string; title: string; url: string; cves: string[]; fixedVersion: string | null; severity: Severity; kev: boolean }>
}

export interface KnownHolesView {
  available: boolean
  lastRun: {
    checkedAt: string
    status: string
    commitSha: string | null
    lockfiles: string[]
    runtimes: Array<{ runtime: string; version: string; exact: boolean; source: string }>
    packages: number | null
    filed: number
    capped: number
    warnings: string[]
    results: Array<{ ruleId: string; state: string; reason: string }>
    error: string | null
  } | null
  dailyLimit: number
  filedToday: number
  counts: Record<Severity, number> | null
  groups: KnownHoleGroup[]
}

const SEVERITY: Record<Severity, { label: string; tone: BadgeTone }> = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'dangerSubtle' },
  medium: { label: 'Medium', tone: 'warnSubtle' },
  low: { label: 'Low', tone: 'neutral' },
  info: { label: 'Dev only', tone: 'neutral' },
}

const RUNTIME_LABEL: Record<string, string> = { php: 'PHP', node: 'Node.js', python: 'Python', go: 'Go' }

export function groupTitle(g: Pick<KnownHoleGroup, 'kind' | 'package'>): string {
  return g.kind === 'runtime' ? RUNTIME_LABEL[g.package] ?? g.package : g.package
}

/** The fix prompt to paste into the editor: facts and the rule, no exploit. */
export function fixPrompt(g: KnownHoleGroup): string {
  const name = groupTitle(g)
  const where = g.sources.map((s) => s.path).join(', ')
  const ids = g.advisories.map((a) => a.id).slice(0, 8).join(', ')
  const how = g.kind === 'runtime'
    ? `Upgrade ${name} to ${g.target} or newer where it is pinned (${where}) and rebuild.`
    : g.direct
      ? `Change ${name} to ${g.target} in the manifest, then run the package manager's install so it rewrites ${where}. Do not edit the lockfile by hand.`
      : `${name} comes in through another package: add an override in the manifest (npm "overrides", pnpm "pnpm.overrides", yarn "resolutions") so ${g.target} or newer is installed, or upgrade the package that pulls it in, then run the package manager's install so it rewrites ${where}.`
  return `${name} ${g.installed.join(', ')} has known security holes (${ids}). ${how} Run the tests. Do not write exploit or proof-of-concept code.`
}

export function KnownHolesCard({ projectId }: { projectId: string }) {
  const path = `/v1/admin/projects/${projectId}/vulnerabilities`
  const { data, loading, error, reload } = usePageData<KnownHolesView>(path)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  const scan = async () => {
    setBusy('scan')
    setNotice(null)
    try {
      const res = await apiFetchMutate<{ queued: boolean }>(`${path}/scan`, { method: 'POST', body: '{}' })
      // 409 RUN_IN_PROGRESS: a check is already running, which is news, not a failure.
      const running = res.error?.code === 'RUN_IN_PROGRESS'
      setNotice(res.ok
        ? { tone: 'info', text: 'Checking the lockfiles now. Refresh in a minute to see the result.' }
        : { tone: running ? 'info' : 'danger', text: res.error?.message ?? 'The check could not start.' })
    } finally {
      setBusy(null)
    }
  }

  const setStatus = async (g: KnownHoleGroup, status: 'dismissed' | 'open') => {
    setBusy(g.groupKey)
    setNotice(null)
    try {
      const res = await apiFetchMutate(`${path}/groups`, { method: 'PATCH', body: JSON.stringify({ groupKey: g.groupKey, status }) })
      if (res.ok) reload()
      else setNotice({ tone: 'danger', text: res.error?.message ?? 'Could not change it.' })
    } finally {
      setBusy(null)
    }
  }

  const setLimit = async (dailyLimit: number) => {
    setBusy('limit')
    try {
      const res = await apiFetchMutate(`${path}/settings`, { method: 'PUT', body: JSON.stringify({ dailyLimit }) })
      if (res.ok) reload()
      else setNotice({ tone: 'danger', text: res.error?.message ?? 'Could not save the limit.' })
    } finally {
      setBusy(null)
    }
  }

  const open = data?.groups.filter((g) => g.status === 'open') ?? []
  const shipped = open.filter((g) => g.severity !== 'info')
  const devOnly = open.filter((g) => g.severity === 'info')
  const dismissed = data?.groups.filter((g) => g.status === 'dismissed') ?? []
  const pkgResult = data?.lastRun?.results.find((r) => r.ruleId === 'known_vulnerable_dependency')
  const eolResult = data?.lastRun?.results.find((r) => r.ruleId === 'runtime_end_of_life')

  return (
    <Section
      title="Known holes in your dependencies"
      action={
        data?.available !== false ? (
          <Btn size="sm" variant="ghost" onClick={scan} loading={busy === 'scan'} disabled={busy != null} title="Check the lockfiles and runtime pins against OSV.dev now">
            Check now
          </Btn>
        ) : undefined
      }
    >
      <p className="mb-3 text-xs text-fg-muted">
        Published security advisories that match the exact versions in your lockfiles and pinned runtimes. Each one with a fix in production
        code becomes a bug report with the upgrade to make.
      </p>
      {notice && (
        <Callout tone={notice.tone} className="mb-2">
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {error && <PageLoadError error={error} resource="the known holes" endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the known holes…" />}
      {data && !data.available && (
        <p className="text-xs text-fg-muted">Not set up on this server yet: the known-vulnerabilities migration has not been applied.</p>
      )}
      {data?.available && !data.lastRun && (
        <p className="text-xs text-fg-muted">Not checked yet. Mushi checks daily at 05:25 UTC, or press Check now.</p>
      )}
      {data?.available && data.lastRun && (
        <div className="flex flex-col gap-3">
          <RunLine view={data} pkgReason={pkgResult} eolReason={eolResult} />
          {shipped.length > 0 ? (
            <ul className="flex flex-col divide-y divide-edge-subtle">
              {shipped.map((g) => <HoleRow key={g.groupKey} g={g} busy={busy === g.groupKey} onDismiss={() => setStatus(g, 'dismissed')} />)}
            </ul>
          ) : pkgResult?.state === 'ok' ? (
            <p className="text-xs text-fg-muted">No known holes in what ships to users.</p>
          ) : null}
          {devOnly.length > 0 && (
            <details className="rounded-md border border-edge-subtle px-3 py-2">
              <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">{devOnly.length} in development-only packages (not filed)</summary>
              <ul className="flex flex-col divide-y divide-edge-subtle">
                {devOnly.map((g) => <HoleRow key={g.groupKey} g={g} busy={busy === g.groupKey} onDismiss={() => setStatus(g, 'dismissed')} />)}
              </ul>
            </details>
          )}
          {dismissed.length > 0 && (
            <details className="rounded-md border border-edge-subtle px-3 py-2">
              <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">{dismissed.length} dismissed</summary>
              <ul className="flex flex-col divide-y divide-edge-subtle">
                {dismissed.map((g) => <HoleRow key={g.groupKey} g={g} busy={busy === g.groupKey} onReopen={() => setStatus(g, 'open')} />)}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle pt-3 text-xs text-fg-muted">
            <label className="flex items-center gap-2">
              Reports a day
              <select
                className="rounded-sm border border-edge-subtle bg-surface-raised px-1.5 py-0.5 text-xs text-fg"
                value={data.dailyLimit}
                disabled={busy != null}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {[0, 3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n === 0 ? 'Off (list only)' : n}</option>)}
              </select>
              <span className="text-fg-faint">{data.filedToday} filed today</span>
            </label>
            <span className="text-2xs text-fg-faint">
              Data: <a className={LINK_ACCENT} href="https://osv.dev" target="_blank" rel="noreferrer">OSV.dev</a> (GitHub, PyPI and Go advisories, CC-BY 4.0), CISA KEV, FIRST EPSS, endoflife.date.
              Only package names and versions are sent.
            </span>
          </div>
        </div>
      )}
    </Section>
  )
}

function RunLine({ view, pkgReason, eolReason }: { view: KnownHolesView; pkgReason?: { state: string; reason: string }; eolReason?: { state: string; reason: string } }) {
  const run = view.lastRun!
  const when = formatRelative(run.checkedAt)
  const lockfiles = run.lockfiles.length
  return (
    <div className="flex flex-col gap-1 text-xs text-fg-muted">
      <p>
        Checked {when}
        {run.commitSha ? <> at <span className="font-mono">{run.commitSha.slice(0, 7)}</span></> : null}
        {lockfiles > 0 ? `: ${lockfiles} lockfile${lockfiles === 1 ? '' : 's'}${run.packages != null ? `, ${run.packages} packages` : ''}` : ''}
        {run.runtimes.filter((r) => r.exact).length > 0 ? `, runtime ${run.runtimes.filter((r) => r.exact).map((r) => `${RUNTIME_LABEL[r.runtime] ?? r.runtime} ${r.version}`).join(', ')}` : ''}.
        {run.filed > 0 ? ` ${run.filed} report${run.filed === 1 ? '' : 's'} filed.` : ''}
      </p>
      {run.error && <Callout tone="danger">The last check failed: {run.error}</Callout>}
      {pkgReason && (pkgReason.state === 'unknown' || pkgReason.state === 'error') && <Callout tone={pkgReason.state === 'error' ? 'danger' : 'warn'}>{pkgReason.reason}</Callout>}
      {eolReason?.state === 'finding' && <Callout tone="warn">{eolReason.reason} See Risk checks on the Recipe page for which pins.</Callout>}
      {run.warnings.length > 0 && (
        <details className="text-2xs text-fg-faint">
          <summary className="cursor-pointer hover:text-fg-secondary">{run.warnings.length} note{run.warnings.length === 1 ? '' : 's'} from the check</summary>
          <ul className="mt-1 list-disc pl-4">{run.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

function HoleRow({ g, busy, onDismiss, onReopen }: { g: KnownHoleGroup; busy: boolean; onDismiss?: () => void; onReopen?: () => void }) {
  const sev = SEVERITY[g.severity]
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fixPrompt(g))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-fg">
          <span className="font-medium">{groupTitle(g)}</span>
          <span className="font-mono text-xs text-fg-secondary">{g.installed.join(', ')}</span>
          {g.target && <span className="text-xs text-fg-muted">→ <span className="font-mono">{g.target}</span></span>}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {g.kev && <Badge tone="danger" title="On CISA's list of vulnerabilities attackers already use">Exploited</Badge>}
          <Badge tone={sev.tone}>{sev.label}</Badge>
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        {g.advisories.length} advisor{g.advisories.length === 1 ? 'y' : 'ies'}
        {g.kind === 'runtime' ? ' in the runtime' : g.direct ? ', direct dependency' : ', through another package'}
        {g.imported ? ', imported in your code' : ''}
        {g.epss != null && g.epss >= 0.01 ? `, ${(g.epss * 100).toFixed(0)}% chance of attack in 30 days (EPSS)` : ''}
        {' · '}
        <span className="font-mono">{g.sources.map((s) => s.path).join(', ')}</span>
        {!g.target && ' · no fixed version published yet'}
      </p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {g.advisories.slice(0, 4).map((a) => (
          <li key={a.id} className="min-w-0 truncate">
            <a href={a.url} target="_blank" rel="noreferrer" className={LINK_ACCENT}>{a.id}</a>
            <span className="text-fg-muted"> {a.title}</span>
          </li>
        ))}
        {g.advisories.length > 4 && <li className="text-fg-faint">and {g.advisories.length - 4} more</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {g.reportId && <Btn to={`/reports/${g.reportId}`} size="sm" variant="ghost">Open the report</Btn>}
        {g.target && <Btn size="sm" variant="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy fix prompt'}</Btn>}
        {onDismiss && <Btn size="sm" variant="ghost" onClick={onDismiss} loading={busy} disabled={busy} title="Hide it here and stop filing it. It stays on the list of dismissed holes.">Dismiss</Btn>}
        {onReopen && <Btn size="sm" variant="ghost" onClick={onReopen} loading={busy} disabled={busy}>Undo dismiss</Btn>}
        {g.dismissedReason && <span className="text-2xs text-fg-faint">Dismissed: {g.dismissedReason}</span>}
      </div>
      {g.status === 'open' && !g.reportId && g.target && !g.dev && (
        <p className="text-2xs text-fg-faint">Not filed yet: the daily report limit was reached, or the next check files it. <Link to="/reports" className={LINK_ACCENT}>Reports</Link></p>
      )}
    </li>
  )
}
