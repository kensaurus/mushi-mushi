/**
 * FILE: packages/server/supabase/functions/_shared/operator-digest.ts
 * PURPOSE: The daily operator digest (Plan 020 §9): one message across every
 *          app in an organization — new reports, open hole-check findings by
 *          severity, releases in flight, and a Mushi AI spend jump. Once a
 *          week (the organization's gtm_weekday) each app also gets a line
 *          with its signups and activations over 7 days, from the team funnel.
 *
 * collectDigest reads; composeDigest is pure; deliverDigest posts to the
 * channels the organization switched on (all off by default). Every line
 * carries the app's name so a shared channel stays readable. A digest with
 * nothing in it is not sent.
 */

import type { getServiceClient } from './db.ts'
import { mapBounded } from './portfolio.ts'

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
  /** The weekly funnel line; null on other days, with no team funnel, or with product events off. */
  gtm?: DigestGtmLine | null
}

/**
 * Signups and activations over the last 7 days: the people who did the team
 * funnel's first step and, of those, the people who reached its last step.
 */
export type DigestGtmLine =
  | { state: 'ok'; firstStep: string; lastStep: string; signups: number; activated: number; pct: number | null }
  | { state: 'error' }

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

/** The weekly funnel line for one app, or null when it has none. */
export function gtmLine(p: Pick<DigestProjectLine, 'name' | 'gtm'>): string | null {
  const g = p.gtm
  if (!g) return null
  if (g.state === 'error') return `This week, ${p.name}: the funnel could not be read.`
  if (g.signups === 0) return `This week, ${p.name}: nobody did ${g.firstStep}.`
  return `This week, ${p.name}: ${g.signups} did ${g.firstStep}, ${g.activated} reached ${g.lastStep}${g.pct === null ? '' : ` (${g.pct}%)`}.`
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
  for (const p of [...data.projects].sort((a, b) => a.name.localeCompare(b.name))) {
    const g = gtmLine(p)
    if (g) lines.push(g)
  }
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

/** product_funnel conversion windows for the team funnel definition (same values as api events-admin FUNNEL_WINDOWS). */
const GTM_WINDOWS: Record<string, string> = { '1h': '1 hour', '1d': '1 day', '7d': '7 days', '30d': '30 days' }
const GTM_CONCURRENCY = 4

/** True on the organization's weekly-line weekday (UTC). Null means never. */
export function isGtmDay(weekday: number | null | undefined, now: Date): boolean {
  return typeof weekday === 'number' && weekday === now.getUTCDay()
}

/**
 * Each app's signups and activations over the 7 days before `now`, run over
 * the team funnel (org_funnel_definitions) with the product_funnel RPC.
 * No funnel: an empty map (no weekly lines). An app with product events off
 * gets no line. A failed RPC is an `error` line, never zeros.
 */
export async function collectGtmLines(db: Db, organizationId: string, projectIds: readonly string[], now: Date): Promise<Map<string, DigestGtmLine>> {
  const out = new Map<string, DigestGtmLine>()
  if (projectIds.length === 0) return out
  const defRes = await db.from('org_funnel_definitions').select('steps, conversion_window').eq('organization_id', organizationId).maybeSingle()
  failOnReadError('the team funnel', defRes)
  const def = defRes.data as { steps?: string[]; conversion_window?: string } | null
  const steps = def?.steps ?? []
  if (steps.length < 2) return out
  const settingsRes = await db.from('project_settings').select('project_id, product_events_enabled').in('project_id', [...projectIds])
  failOnReadError('product event settings', settingsRes)
  const off = new Set(((settingsRes.data ?? []) as Array<{ project_id: string; product_events_enabled: boolean | null }>).filter((r) => r.product_events_enabled === false).map((r) => r.project_id))
  const from = new Date(now.getTime() - 7 * 86400_000).toISOString()
  await mapBounded(projectIds.filter((id) => !off.has(id)), GTM_CONCURRENCY, async (projectId) => {
    const { data, error } = await db.rpc('product_funnel', {
      p_project_id: projectId,
      p_steps: steps,
      p_from: from,
      p_to: now.toISOString(),
      p_window: GTM_WINDOWS[def?.conversion_window ?? '7d'] ?? '7 days',
      p_breakdown: null,
    })
    if (error) {
      out.set(projectId, { state: 'error' })
      return
    }
    const s = ((data as { steps?: Array<{ converted?: number | string }> } | null)?.steps) ?? []
    const signups = Number(s[0]?.converted ?? 0) || 0
    const activated = Number(s[s.length - 1]?.converted ?? 0) || 0
    out.set(projectId, {
      state: 'ok',
      firstStep: steps[0],
      lastStep: steps[steps.length - 1],
      signups,
      activated,
      pct: signups > 0 ? Math.round((1000 * activated) / signups) / 10 : null,
    })
  })
  return out
}

/**
 * Read what the digest needs for every project of the organization. Throws when a read fails.
 * `gtm` adds the weekly funnel line per app.
 */
export async function collectDigest(db: Db, organizationId: string, now: Date, opts: { gtm?: boolean } = {}): Promise<DigestData> {
  const [orgRes, projectsRes] = await Promise.all([
    db.from('organizations').select('name').eq('id', organizationId).maybeSingle(),
    db.from('projects').select('id, name, slug').eq('organization_id', organizationId).limit(100),
  ])
  failOnReadError('organization', orgRes)
  failOnReadError('projects', projectsRes)
  const org = orgRes.data
  const projects = projectsRes.data
  const rows = (projects ?? []) as Array<{ id: string; name: string | null; slug: string | null }>
  const ids = rows.map((p) => p.id)
  const day = new Date(now.getTime() - 86400_000).toISOString()
  const week = new Date(now.getTime() - 8 * 86400_000).toISOString()
  const empty = { data: [] as unknown[], error: null }
  const [reports, openReports, runs, releases, spend] = ids.length
    ? await Promise.all([
      db.from('reports').select('project_id').in('project_id', ids).gte('created_at', day).limit(5000),
      db.from('reports').select('project_id').in('project_id', ids).in('status', [...DIGEST_OPEN_STATUSES]).limit(20000),
      db.from('gate_runs').select('id, project_id, gate, status, summary, started_at').in('project_id', ids).in('gate', ['portfolio_radar', 'portfolio_radar_ci']).order('started_at', { ascending: false }).limit(500),
      db.from('releases').select('project_id, status, published_at').in('project_id', ids).order('created_at', { ascending: false }).limit(500),
      db.from('llm_invocations').select('project_id, cost_usd, created_at').in('project_id', ids).gte('created_at', week).limit(50000),
    ])
    : [empty, empty, empty, empty, empty]
  // A failed read must not turn into "nothing new": the callers catch this and send nothing.
  for (const [name, res] of [['reports', reports], ['open reports', openReports], ['hole-check runs', runs], ['releases', releases], ['spend', spend]] as const) failOnReadError(name, res)

  const latestRun = new Map<string, { id: string; project_id: string; failed: boolean; skipped: boolean }>()
  for (const r of ((runs as { data: unknown }).data ?? []) as Array<{ id: string; project_id: string; gate: string; status: string; summary: { errored?: number } | null }>) {
    const key = `${r.project_id}:${r.gate}`
    if (!latestRun.has(key)) latestRun.set(key, { id: r.id, project_id: r.project_id, failed: r.status === 'error' || Number(r.summary?.errored ?? 0) > 0, skipped: r.status === 'skipped' })
  }
  const runIds = [...latestRun.values()].map((r) => r.id)
  const findingsRes = runIds.length
    ? await db.from('gate_findings').select('project_id, severity').in('gate_run_id', runIds).eq('allowlisted', false).limit(5000)
    : { data: [], error: null }
  failOnReadError('hole-check findings', findingsRes)
  const findings = findingsRes.data

  const gtm = opts.gtm ? await collectGtmLines(db, organizationId, ids, now) : new Map<string, DigestGtmLine>()

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
          // A skipped run (every check undecided) did not check anything.
          checked: [...latestRun.values()].some((r) => r.project_id === p.id && !r.failed && !r.skipped),
          failed: [...latestRun.values()].some((r) => r.project_id === p.id && r.failed),
        },
        draftReleases: rel.filter((r) => r.status === 'draft').length,
        publishedReleases24h: rel.filter((r) => r.status === 'published' && r.published_at && r.published_at >= day).length,
        spend: { last24hUsd: Math.round(last24 * 100) / 100, avgPrior7dUsd: Math.round((prior / 7) * 100) / 100 },
        gtm: gtm.get(p.id) ?? null,
      }
    }),
  }
}

export interface DigestSettings {
  organization_id: string
  enabled: boolean
  slack_project_id: string | null
  /** Each names a project whose configured Discord / Teams webhook or bound Telegram chats get the digest. */
  discord_project_id?: string | null
  teams_project_id?: string | null
  telegram_project_id?: string | null
  email: boolean
  web_push: boolean
}

export type DigestChannel = 'slack' | 'discord' | 'teams' | 'telegram' | 'email' | 'web_push'

export interface DeliveryDeps {
  sendSlack: (db: Db, projectId: string, text: string) => Promise<{ ok: boolean; error?: string }>
  /** Through the project's existing Discord / Teams webhook. */
  sendDiscord: (db: Db, projectId: string, title: string, body: string) => Promise<{ ok: boolean; error?: string }>
  sendTeams: (db: Db, projectId: string, title: string, body: string) => Promise<{ ok: boolean; error?: string }>
  /** Through the project's Telegram bot, to every chat bound to the project. */
  sendTelegram: (db: Db, projectId: string, text: string) => Promise<{ sent: number; error?: string }>
  sendEmail: (to: string, subject: string, text: string) => Promise<{ ok: boolean; error?: string }>
  sendPush: (db: Db, userId: string, title: string, body: string) => Promise<{ sent: number; error?: string }>
  /**
   * Owner and admin emails of the organization (never logged). Throws when the
   * members cannot be read; a person whose email lookup failed has `emailError`.
   */
  adminRecipients: (db: Db, organizationId: string) => Promise<Array<{ userId: string; email: string | null; emailError?: string }>>
}

export interface DeliveryResult {
  status: 'sent' | 'partial' | 'failed' | 'nothing_to_send'
  channels: Array<{ channel: DigestChannel; ok: boolean; detail: string }>
}

/** Post to every switched-on channel. One channel failing never stops the others. */
export async function deliverDigest(db: Db, settings: DigestSettings, digest: ComposedDigest, deps: DeliveryDeps): Promise<DeliveryResult> {
  if (!digest.hasContent) return { status: 'nothing_to_send', channels: [] }
  const channels: DeliveryResult['channels'] = []
  if (settings.slack_project_id) {
    const r = await deps.sendSlack(db, settings.slack_project_id, digest.text).catch((e) => ({ ok: false, error: String(e) }))
    channels.push({ channel: 'slack', ok: r.ok, detail: r.ok ? 'posted' : (r.error ?? 'failed').slice(0, 200) })
  }
  // Discord and Teams get the title separately; the body is the rest of the text.
  const body = digest.text.split('\n').slice(1).join('\n')
  if (settings.discord_project_id) {
    const r = await deps.sendDiscord(db, settings.discord_project_id, digest.title, body).catch((e) => ({ ok: false, error: String(e) }))
    channels.push({ channel: 'discord', ok: r.ok, detail: r.ok ? 'posted' : (r.error ?? 'failed').slice(0, 200) })
  }
  if (settings.teams_project_id) {
    const r = await deps.sendTeams(db, settings.teams_project_id, digest.title, body).catch((e) => ({ ok: false, error: String(e) }))
    channels.push({ channel: 'teams', ok: r.ok, detail: r.ok ? 'posted' : (r.error ?? 'failed').slice(0, 200) })
  }
  if (settings.telegram_project_id) {
    const r = await deps.sendTelegram(db, settings.telegram_project_id, digest.text).catch((e) => ({ sent: 0, error: String(e) }))
    channels.push({ channel: 'telegram', ok: r.sent > 0, detail: r.sent > 0 ? `${r.sent} chat${r.sent === 1 ? '' : 's'}` : (r.error ?? 'no chat is bound to that project').slice(0, 200) })
  }
  if (settings.email || settings.web_push) {
    let people: Awaited<ReturnType<DeliveryDeps['adminRecipients']>> = []
    let peopleError: string | null = null
    try {
      people = await deps.adminRecipients(db, settings.organization_id)
    } catch (e) {
      peopleError = `the owners and admins could not be read: ${String((e as Error)?.message ?? e).slice(0, 120)}`
    }
    if (peopleError) {
      if (settings.email) channels.push({ channel: 'email', ok: false, detail: peopleError })
      if (settings.web_push) channels.push({ channel: 'web_push', ok: false, detail: peopleError })
    }
    if (settings.email && !peopleError) {
      const withEmail = people.filter((p) => p.email)
      const lookupFailed = people.filter((p) => !p.email && p.emailError).length
      let ok = 0
      let lastErr = ''
      for (const p of withEmail) {
        const r = await deps.sendEmail(p.email!, digest.title, digest.text).catch((e) => ({ ok: false, error: String(e) }))
        if (r.ok) ok++
        else lastErr = r.error ?? 'failed'
      }
      const wanted = withEmail.length + lookupFailed
      const lookupNote = lookupFailed > 0 ? `; ${lookupFailed} email${lookupFailed === 1 ? '' : 's'} could not be read` : ''
      channels.push({
        channel: 'email',
        ok: wanted > 0 && ok === wanted,
        detail: wanted === 0 ? 'no owner or admin email' : `${ok}/${wanted} sent${lookupNote}${lastErr ? `; ${lastErr.slice(0, 120)}` : ''}`,
      })
    }
    if (settings.web_push && !peopleError) {
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
