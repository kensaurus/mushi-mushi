/**
 * FILE: packages/server/supabase/functions/_shared/operator-digest.ts
 * PURPOSE: The daily operator digest (Plan 020 §9): one message across every
 *          app in an organization — new reports, open hole-check findings by
 *          severity, releases in flight, and a Mushi AI spend jump.
 *
 * collectDigest reads; composeDigest is pure; deliverDigest posts to the
 * channels the organization switched on (all off by default). Every line
 * carries the app's name so a shared channel stays readable. A digest with
 * nothing in it is not sent.
 */

import type { getServiceClient } from './db.ts'
import { PagedReadError, readAllPages, type PageCount, type PageResult } from './paged-read.ts'

/**
 * Report statuses that still wait on a decision. Same list as
 * OPEN_REPORT_STATUSES in api/shared.ts (a function cannot import api/);
 * operator-digest.test.ts asserts the two stay equal.
 */
export const DIGEST_OPEN_STATUSES = ['new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened'] as const

type Db = ReturnType<typeof getServiceClient>

export interface DigestProjectLine {
  projectId: string
  name: string
  newReports24h: number
  openReports: number
  /**
   * checked: a latest hole-check run finished without a failed check.
   * failed: a latest run, or a check inside it, failed to run.
   */
  radar: { error: number; warn: number; checked: boolean; failed: boolean }
  draftReleases: number
  publishedReleases24h: number
  /** Mushi's own LLM spend: the last 24 h and the daily average of the 7 days before. */
  spend: { last24hUsd: number; avgPrior7dUsd: number }
}

export interface DigestData {
  organizationId: string
  organizationName: string | null
  generatedAt: string
  projects: DigestProjectLine[]
  /** Reads that stopped at their row ceiling: the counts they feed are lower bounds. */
  truncated: string[]
}

export interface ComposedDigest {
  title: string
  /** One line per app that has something to say, worst first. */
  lines: string[]
  /** Plain text: title, lines, and the console link. Safe for Slack mrkdwn, email and push. */
  text: string
  hasContent: boolean
}

/** A spend jump worth a line: over $1 in the last day and more than twice the prior daily average. */
export function spendJumped(s: DigestProjectLine['spend']): boolean {
  return s.last24hUsd >= 1 && s.last24hUsd > 2 * s.avgPrior7dUsd
}

function lineFor(p: DigestProjectLine): { text: string; weight: number } | null {
  const parts: string[] = []
  let weight = 0
  if (p.radar.failed) {
    parts.push('hole checks failed to run')
    weight += 50
  }
  if (p.radar.error > 0) {
    parts.push(`${p.radar.error} serious hole${p.radar.error === 1 ? '' : 's'}`)
    weight += 100 * p.radar.error
  }
  if (p.newReports24h > 0) {
    parts.push(`${p.newReports24h} new report${p.newReports24h === 1 ? '' : 's'} (${p.openReports} open)`)
    weight += 10 * p.newReports24h
  }
  if (p.radar.warn > 0) {
    parts.push(`${p.radar.warn} thing${p.radar.warn === 1 ? '' : 's'} to look at`)
    weight += p.radar.warn
  }
  if (p.publishedReleases24h > 0) parts.push(`${p.publishedReleases24h} release${p.publishedReleases24h === 1 ? '' : 's'} shipped`)
  if (p.draftReleases > 0) parts.push(`${p.draftReleases} release${p.draftReleases === 1 ? '' : 's'} in draft`)
  if (spendJumped(p.spend)) {
    parts.push(`Mushi AI spend $${p.spend.last24hUsd.toFixed(2)} today vs about $${p.spend.avgPrior7dUsd.toFixed(2)} a day before`)
    weight += 5
  }
  if (parts.length === 0) return null
  return { text: `${p.name}: ${parts.join(' · ')}`, weight }
}

export function composeDigest(data: DigestData, consoleUrl: string): ComposedDigest {
  const scored = data.projects
    .map((p) => ({ p, l: lineFor(p) }))
    .filter((x): x is { p: DigestProjectLine; l: { text: string; weight: number } } => x.l !== null)
    .sort((a, b) => b.l.weight - a.l.weight || a.p.name.localeCompare(b.p.name))
  // Never checked is said out loud, even when nothing else happened: silence would read as "all fine".
  const unchecked = data.projects.filter((p) => !p.radar.checked && !p.radar.failed).length
  const lines = scored.map((x) => x.l.text)
  if (unchecked > 0) lines.push(`${unchecked} app${unchecked === 1 ? ' has' : 's have'} not had hole checks yet.`)
  // A read cut short is said out loud: its counts are at least what is shown, never exact.
  if (data.truncated.length > 0) lines.push(`Some numbers are lower bounds: there were more ${data.truncated.join(', ')} than the digest reads.`)
  const org = data.organizationName ?? 'your apps'
  const title = `Mushi daily digest for ${org}`
  const body = lines.length ? lines.map((l) => `• ${l}`).join('\n') : 'Nothing new across your apps today.'
  return {
    title,
    lines,
    text: `${title}\n${body}\nOpen the portfolio: ${consoleUrl}`,
    hasContent: lines.length > 0,
  }
}

function failOnReadError(what: string, res: { error?: { message?: string } | null }): void {
  if (res.error) throw new Error(`digest: could not read ${what}: ${res.error.message ?? 'unknown error'}`)
}

/** Row ceiling per digest read; past it the read is named in `DigestData.truncated`. */
const MAX_DIGEST_ROWS = 50_000
/** Hole-check runs are read for this window first; apps with no run in it get one older read. */
const RUN_WINDOW_MS = 30 * 86400_000

/**
 * Every row of one digest read, paged past the server's row cap. A failed
 * read throws (the callers send nothing); a read cut short at its ceiling is
 * named in `truncated`, so its counts are shown as lower bounds.
 */
async function readAllOrThrow<T>(
  what: string,
  truncated: string[],
  fetchPage: (from: number, to: number, count: PageCount) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  try {
    const read = await readAllPages<T>(fetchPage, { what, maxRows: MAX_DIGEST_ROWS })
    if (read.truncated) truncated.push(what)
    return read.rows
  } catch (err) {
    const detail = err instanceof PagedReadError ? err.message.slice(what.length + 2) : err instanceof Error ? err.message : String(err)
    throw new Error(`digest: could not read ${what}: ${detail}`)
  }
}

type RunRow = { id: string; project_id: string; gate: string; status: string; summary: { errored?: number } | null }
const DIGEST_RADAR_GATES = ['portfolio_radar', 'portfolio_radar_ci']

/** Read what the digest needs for every project of the organization. Throws when a read fails. */
export async function collectDigest(db: Db, organizationId: string, now: Date): Promise<DigestData> {
  const truncated: string[] = []
  const orgRes = await db.from('organizations').select('name').eq('id', organizationId).maybeSingle()
  failOnReadError('organization', orgRes)
  const rows = await readAllOrThrow<{ id: string; name: string | null; slug: string | null }>('projects', truncated, (from, to, count) =>
    db.from('projects').select('id, name, slug', { count }).eq('organization_id', organizationId).order('id', { ascending: true }).range(from, to))
  const ids = rows.map((p) => p.id)
  const day = new Date(now.getTime() - 86400_000).toISOString()
  const week = new Date(now.getTime() - 8 * 86400_000).toISOString()
  const month = new Date(now.getTime() - RUN_WINDOW_MS).toISOString()

  type ProjectRef = { project_id: string }
  type SpendRow = { project_id: string; cost_usd: number | string | null; created_at: string }
  const [reports, openReports, recentRuns, drafts, published, spend] = ids.length
    ? await Promise.all([
      readAllOrThrow<ProjectRef>('reports', truncated, (from, to, count) =>
        db.from('reports').select('id, project_id', { count }).in('project_id', ids).gte('created_at', day).order('id', { ascending: true }).range(from, to)),
      readAllOrThrow<ProjectRef>('open reports', truncated, (from, to, count) =>
        db.from('reports').select('id, project_id', { count }).in('project_id', ids).in('status', [...DIGEST_OPEN_STATUSES]).order('id', { ascending: true }).range(from, to)),
      readAllOrThrow<RunRow>('hole-check runs', truncated, (from, to, count) =>
        db.from('gate_runs').select('id, project_id, gate, status, summary, started_at', { count }).in('project_id', ids).in('gate', DIGEST_RADAR_GATES)
          .gte('started_at', month).order('started_at', { ascending: false }).order('id', { ascending: true }).range(from, to)),
      readAllOrThrow<ProjectRef>('draft releases', truncated, (from, to, count) =>
        db.from('releases').select('id, project_id', { count }).in('project_id', ids).eq('status', 'draft').order('id', { ascending: true }).range(from, to)),
      readAllOrThrow<ProjectRef>('releases', truncated, (from, to, count) =>
        db.from('releases').select('id, project_id', { count }).in('project_id', ids).eq('status', 'published').gte('published_at', day).order('id', { ascending: true }).range(from, to)),
      readAllOrThrow<SpendRow>('AI calls', truncated, (from, to, count) =>
        db.from('llm_invocations').select('id, project_id, cost_usd, created_at', { count }).in('project_id', ids).gte('created_at', week).order('id', { ascending: true }).range(from, to)),
    ])
    : [[], [], [], [], [], []] as [ProjectRef[], ProjectRef[], RunRow[], ProjectRef[], ProjectRef[], SpendRow[]]

  const latestRun = new Map<string, { id: string; project_id: string; failed: boolean; skipped: boolean }>()
  const keep = (list: readonly RunRow[]) => {
    for (const r of list) {
      const key = `${r.project_id}:${r.gate}`
      if (!latestRun.has(key)) latestRun.set(key, { id: r.id, project_id: r.project_id, failed: r.status === 'error' || Number(r.summary?.errored ?? 0) > 0, skipped: r.status === 'skipped' })
    }
  }
  keep(recentRuns)
  // An app whose latest check is older than the window still has one: read it, never "not checked yet".
  const stale = ids.filter((id) => DIGEST_RADAR_GATES.some((g) => !latestRun.has(`${id}:${g}`)))
  if (stale.length) {
    keep(await readAllOrThrow<RunRow>('older hole-check runs', truncated, (from, to, count) =>
      db.from('gate_runs').select('id, project_id, gate, status, summary, started_at', { count }).in('project_id', stale).in('gate', DIGEST_RADAR_GATES)
        .lt('started_at', month).order('started_at', { ascending: false }).order('id', { ascending: true }).range(from, to)))
  }
  const runIds = [...latestRun.values()].map((r) => r.id)
  const findings = runIds.length
    ? await readAllOrThrow<{ project_id: string; severity: string }>('hole-check findings', truncated, (from, to, count) =>
      db.from('gate_findings').select('id, project_id, severity', { count }).in('gate_run_id', runIds).eq('allowlisted', false).order('id', { ascending: true }).range(from, to))
    : []

  const countFor = (list: readonly ProjectRef[], id: string) => list.filter((r) => r.project_id === id).length
  return {
    organizationId,
    organizationName: (orgRes.data as { name?: string | null } | null)?.name ?? null,
    generatedAt: now.toISOString(),
    truncated,
    projects: rows.map((p) => {
      const f = findings.filter((x) => x.project_id === p.id)
      const calls = spend.filter((c) => c.project_id === p.id)
      const last24 = calls.filter((c) => c.created_at >= day).reduce((n, c) => n + (Number(c.cost_usd) || 0), 0)
      const prior = calls.filter((c) => c.created_at < day).reduce((n, c) => n + (Number(c.cost_usd) || 0), 0)
      return {
        projectId: p.id,
        name: p.name ?? p.slug ?? p.id.slice(0, 8),
        newReports24h: countFor(reports, p.id),
        openReports: countFor(openReports, p.id),
        radar: {
          error: f.filter((x) => x.severity === 'error').length,
          warn: f.filter((x) => x.severity === 'warn').length,
          // A skipped run (every check undecided) did not check anything.
          checked: [...latestRun.values()].some((r) => r.project_id === p.id && !r.failed && !r.skipped),
          failed: [...latestRun.values()].some((r) => r.project_id === p.id && r.failed),
        },
        draftReleases: countFor(drafts, p.id),
        publishedReleases24h: countFor(published, p.id),
        spend: { last24hUsd: Math.round(last24 * 100) / 100, avgPrior7dUsd: Math.round((prior / 7) * 100) / 100 },
      }
    }),
  }
}

export interface DigestSettings {
  organization_id: string
  enabled: boolean
  slack_project_id: string | null
  email: boolean
  web_push: boolean
}

export interface DeliveryDeps {
  sendSlack: (db: Db, projectId: string, text: string) => Promise<{ ok: boolean; error?: string }>
  sendEmail: (to: string, subject: string, text: string) => Promise<{ ok: boolean; error?: string }>
  sendPush: (db: Db, userId: string, title: string, body: string) => Promise<{ sent: number; error?: string }>
  /** Owner and admin emails of the organization (never logged). */
  adminRecipients: (db: Db, organizationId: string) => Promise<Array<{ userId: string; email: string | null }>>
}

export interface DeliveryResult {
  status: 'sent' | 'partial' | 'failed' | 'nothing_to_send'
  channels: Array<{ channel: 'slack' | 'email' | 'web_push'; ok: boolean; detail: string }>
}

/** Post to every switched-on channel. One channel failing never stops the others. */
export async function deliverDigest(db: Db, settings: DigestSettings, digest: ComposedDigest, deps: DeliveryDeps): Promise<DeliveryResult> {
  if (!digest.hasContent) return { status: 'nothing_to_send', channels: [] }
  const channels: DeliveryResult['channels'] = []
  if (settings.slack_project_id) {
    const r = await deps.sendSlack(db, settings.slack_project_id, digest.text).catch((e) => ({ ok: false, error: String(e) }))
    channels.push({ channel: 'slack', ok: r.ok, detail: r.ok ? 'posted' : (r.error ?? 'failed').slice(0, 200) })
  }
  if (settings.email || settings.web_push) {
    const people = await deps.adminRecipients(db, settings.organization_id).catch(() => [])
    if (settings.email) {
      const withEmail = people.filter((p) => p.email)
      let ok = 0
      let lastErr = ''
      for (const p of withEmail) {
        const r = await deps.sendEmail(p.email!, digest.title, digest.text).catch((e) => ({ ok: false, error: String(e) }))
        if (r.ok) ok++
        else lastErr = r.error ?? 'failed'
      }
      channels.push({ channel: 'email', ok: withEmail.length > 0 && ok === withEmail.length, detail: withEmail.length === 0 ? 'no owner or admin email' : `${ok}/${withEmail.length} sent${lastErr ? `; ${lastErr.slice(0, 120)}` : ''}` })
    }
    if (settings.web_push) {
      let sent = 0
      let lastErr = ''
      for (const p of people) {
        const r = await deps.sendPush(db, p.userId, digest.title, digest.lines.slice(0, 3).join('\n') || 'Open the portfolio for today\'s summary.').catch((e) => ({ sent: 0, error: String(e) }))
        sent += r.sent
        if (r.error) lastErr = r.error
      }
      channels.push({ channel: 'web_push', ok: sent > 0, detail: sent > 0 ? `${sent} device${sent === 1 ? '' : 's'}` : (lastErr || 'no subscribed devices') })
    }
  }
  if (channels.length === 0) return { status: 'failed', channels: [{ channel: 'slack', ok: false, detail: 'no channel is switched on' }] }
  const okCount = channels.filter((c) => c.ok).length
  return { status: okCount === channels.length ? 'sent' : okCount > 0 ? 'partial' : 'failed', channels }
}

/** Due when enabled, in its hour, and not yet sent today (UTC). `force` skips the hour and day checks. */
export function isDigestDue(row: { enabled: boolean; send_hour_utc: number; last_sent_at: string | null }, now: Date, force = false): boolean {
  if (!row.enabled) return false
  if (force) return true
  if (row.send_hour_utc !== now.getUTCHours()) return false
  if (!row.last_sent_at) return true
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Date.parse(row.last_sent_at) < startOfDay
}
