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
  radar: { error: number; warn: number; checked: boolean }
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
  const unchecked = data.projects.filter((p) => !p.radar.checked).length
  const lines = scored.map((x) => x.l.text)
  if (lines.length > 0 && unchecked > 0) lines.push(`${unchecked} app${unchecked === 1 ? ' has' : 's have'} not had hole checks yet.`)
  const org = data.organizationName ?? 'your apps'
  const title = `Mushi daily digest for ${org}`
  const body = lines.length ? lines.map((l) => `• ${l}`).join('\n') : 'Nothing new across your apps today.'
  return {
    title,
    lines,
    text: `${title}\n${body}\nOpen the portfolio: ${consoleUrl}`,
    hasContent: scored.length > 0,
  }
}

/** Read what the digest needs for every project of the organization. */
export async function collectDigest(db: Db, organizationId: string, now: Date): Promise<DigestData> {
  const [{ data: org }, { data: projects }] = await Promise.all([
    db.from('organizations').select('name').eq('id', organizationId).maybeSingle(),
    db.from('projects').select('id, name, slug').eq('organization_id', organizationId).limit(100),
  ])
  const rows = (projects ?? []) as Array<{ id: string; name: string | null; slug: string | null }>
  const ids = rows.map((p) => p.id)
  const day = new Date(now.getTime() - 86400_000).toISOString()
  const week = new Date(now.getTime() - 8 * 86400_000).toISOString()
  const empty = { data: [] as unknown[] }
  const [reports, openReports, runs, releases, spend] = ids.length
    ? await Promise.all([
      db.from('reports').select('project_id').in('project_id', ids).gte('created_at', day).limit(5000),
      db.from('reports').select('project_id').in('project_id', ids).in('status', [...DIGEST_OPEN_STATUSES]).limit(20000),
      db.from('gate_runs').select('id, project_id, gate, started_at').in('project_id', ids).in('gate', ['radar', 'radar_ci']).order('started_at', { ascending: false }).limit(500),
      db.from('releases').select('project_id, status, published_at').in('project_id', ids).order('created_at', { ascending: false }).limit(500),
      db.from('llm_invocations').select('project_id, cost_usd, created_at').in('project_id', ids).gte('created_at', week).limit(50000),
    ])
    : [empty, empty, empty, empty, empty]

  const latestRun = new Map<string, string>()
  for (const r of ((runs as { data: unknown }).data ?? []) as Array<{ id: string; project_id: string; gate: string }>) {
    const key = `${r.project_id}:${r.gate}`
    if (!latestRun.has(key)) latestRun.set(key, r.id)
  }
  const runIds = [...latestRun.values()]
  const { data: findings } = runIds.length
    ? await db.from('gate_findings').select('project_id, severity').in('gate_run_id', runIds).eq('allowlisted', false).limit(5000)
    : { data: [] }

  const count = (list: unknown, id: string) => ((list as { data: unknown }).data as Array<{ project_id: string }> ?? []).filter((r) => r.project_id === id).length
  return {
    organizationId,
    organizationName: (org as { name?: string | null } | null)?.name ?? null,
    generatedAt: now.toISOString(),
    projects: rows.map((p) => {
      const f = ((findings ?? []) as Array<{ project_id: string; severity: string }>).filter((x) => x.project_id === p.id)
      const rel = (((releases as { data: unknown }).data ?? []) as Array<{ project_id: string; status: string; published_at: string | null }>).filter((r) => r.project_id === p.id)
      const calls = (((spend as { data: unknown }).data ?? []) as Array<{ project_id: string; cost_usd: number | string | null; created_at: string }>).filter((c) => c.project_id === p.id)
      const last24 = calls.filter((c) => c.created_at >= day).reduce((n, c) => n + (Number(c.cost_usd) || 0), 0)
      const prior = calls.filter((c) => c.created_at < day).reduce((n, c) => n + (Number(c.cost_usd) || 0), 0)
      return {
        projectId: p.id,
        name: p.name ?? p.slug ?? p.id.slice(0, 8),
        newReports24h: count(reports, p.id),
        openReports: count(openReports, p.id),
        radar: {
          error: f.filter((x) => x.severity === 'error').length,
          warn: f.filter((x) => x.severity === 'warn').length,
          checked: latestRun.has(`${p.id}:radar`) || latestRun.has(`${p.id}:radar_ci`),
        },
        draftReleases: rel.filter((r) => r.status === 'draft').length,
        publishedReleases24h: rel.filter((r) => r.status === 'published' && r.published_at && r.published_at >= day).length,
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
