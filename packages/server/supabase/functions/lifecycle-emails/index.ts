// ============================================================
// Lifecycle emails (cron, hourly at :37).
//
// Four activation emails for new accounts (docs/plan-gtm.md → Workstream
// B §3): day-0 welcome, day-2 nudge (no report), day-7 stalled (no
// report, one-question reply email) and day-7 activated (has a report,
// no MCP setup). Windows, exits and copy live in
// _shared/lifecycle-emails.ts (pure, unit-tested); this file is the
// selection + send loop, cloned from invitation-reminders/index.ts.
//
// Safe by default, in three layers:
//   1. dispatch_lifecycle_emails() (SQL) returns early unless
//      mushi_runtime_config.lifecycle_emails_enabled = 'true'.
//   2. This function re-checks the same flag, so a manual POST cannot
//      bypass the kill switch.
//   3. _shared/email.ts refuses to send without RESEND_FROM_EMAIL, and
//      day-2/day-7 refuse without LIFECYCLE_UNSUB_SECRET (they carry a
//      signed List-Unsubscribe link).
//
// Idempotent: a row is claimed in lifecycle_email_sends (PK user_id +
// email_key) BEFORE the send; a conflict means another tick already
// took it. A failed send releases the claim so the next tick retries
// inside the window.
//
// Excluded: operator_users (founders), lifecycle_email_optout, users
// without a confirmed email, accounts older than 14 days.
//
// Auth: shared MUSHI_INTERNAL_CALLER_SECRET via requireServiceRoleAuth.
// Wired by 20260921000005_lifecycle_emails.sql.
// ============================================================
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveSenderAddress, sendTransactionalEmail } from '../_shared/email.ts'
import { signUnsubscribeToken, unsubscribeSecret } from '../_shared/lifecycle-unsubscribe.ts'
import {
  buildLifecycleEmail,
  decideLifecycleEmail,
  needsUnsubscribeLink,
  type LifecycleEmailKey,
} from '../_shared/lifecycle-emails.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const llog = log.child('lifecycle-emails')

/** Per-tick send cap — same reasoning as invitation-reminders. */
const MAX_SENDS_PER_TICK = 100
/** Only accounts created within this window are ever considered. */
const LOOKBACK_DAYS = 14
/** listUsers page size × max pages = 5,000 users scanned per tick. */
const LIST_PAGE_SIZE = 200
const LIST_MAX_PAGES = 25
const REPLY_TO = 'kensaurus@gmail.com'
/** Report sources that never count as a real report (see api/helpers.ts). */
const NON_REAL_REPORT_SOURCES: ReadonlySet<string> = new Set(['admin_test_report', 'mushi-marketing-seed'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Db = ReturnType<typeof getServiceClient>

interface CandidateUser {
  id: string
  email: string
  confirmedAt: Date
  createdAt: Date
}

interface SendStat {
  user_id: string
  email_key: LifecycleEmailKey
  result: 'sent' | 'claimed_elsewhere' | 'send_failed' | 'claim_failed'
  reason?: string
}

function adminUrl(): string {
  const base =
    Deno.env.get('MUSHI_ADMIN_URL') ??
    Deno.env.get('SITE_URL') ??
    'https://kensaur.us/mushi-mushi/admin'
  return base.replace(/\/+$/, '')
}

function apiPublicUrl(): string {
  const explicit = Deno.env.get('MUSHI_API_PUBLIC_URL')
  if (explicit) return explicit.replace(/\/+$/, '')
  const supabase = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  return `${supabase}/functions/v1/api`
}

async function lifecycleEmailsEnabled(db: Db): Promise<boolean> {
  const { data } = await db
    .from('mushi_runtime_config')
    .select('value')
    .eq('key', 'lifecycle_emails_enabled')
    .maybeSingle()
  return (data?.value as string | undefined)?.trim() === 'true'
}

/**
 * Confirmed users created in the last LOOKBACK_DAYS. auth.admin.listUsers
 * has no created_at filter, so we page through and filter client-side,
 * stopping once a page comes back short.
 */
async function listRecentConfirmedUsers(db: Db, now: Date): Promise<CandidateUser[]> {
  const cutoff = now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const out: CandidateUser[] = []
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE })
    if (error) {
      llog.error('list_users_failed', { page, err: error.message })
      break
    }
    const users = data?.users ?? []
    for (const u of users) {
      if (!u.email || !u.email_confirmed_at || !UUID_RE.test(u.id)) continue
      const createdAt = new Date(u.created_at)
      const confirmedAt = new Date(u.email_confirmed_at)
      if (Number.isNaN(createdAt.getTime()) || Number.isNaN(confirmedAt.getTime())) continue
      if (createdAt.getTime() < cutoff) continue
      out.push({ id: u.id, email: u.email, confirmedAt, createdAt })
    }
    if (users.length < LIST_PAGE_SIZE) break
  }
  return out
}

interface Signals {
  excluded: Set<string>
  sentByUser: Map<string, Set<string>>
  realReportsByUser: Map<string, number>
  mcpSetupDone: Set<string>
  /** True when the reports query failed — only day0_welcome may send. */
  reportsUnavailable: boolean
}

async function loadSignals(db: Db, users: CandidateUser[]): Promise<Signals> {
  const ids = users.map((u) => u.id)
  const excluded = new Set<string>()
  const sentByUser = new Map<string, Set<string>>()
  const realReportsByUser = new Map<string, number>()
  const mcpSetupDone = new Set<string>()
  if (ids.length === 0) {
    return { excluded, sentByUser, realReportsByUser, mcpSetupDone, reportsUnavailable: false }
  }

  const [operators, optouts, sends, projects, mcp] = await Promise.all([
    db.from('operator_users').select('user_id'),
    db.from('lifecycle_email_optout').select('user_id').in('user_id', ids),
    db.from('lifecycle_email_sends').select('user_id, email_key').in('user_id', ids),
    db.from('projects').select('id, owner_id').in('owner_id', ids),
    db.from('setup_funnel_events').select('user_id').eq('event_name', 'mcp_setup_done').in('user_id', ids),
  ])
  for (const r of (operators.data ?? []) as Array<{ user_id: string }>) excluded.add(r.user_id)
  for (const r of (optouts.data ?? []) as Array<{ user_id: string }>) excluded.add(r.user_id)
  for (const r of (sends.data ?? []) as Array<{ user_id: string; email_key: string }>) {
    const set = sentByUser.get(r.user_id) ?? new Set<string>()
    set.add(r.email_key)
    sentByUser.set(r.user_id, set)
  }
  for (const r of (mcp.data ?? []) as Array<{ user_id: string | null }>) {
    if (r.user_id) mcpSetupDone.add(r.user_id)
  }

  const ownerByProject = new Map<string, string>()
  for (const p of (projects.data ?? []) as Array<{ id: string; owner_id: string | null }>) {
    if (p.owner_id) ownerByProject.set(p.id, p.owner_id)
  }
  const projectIds = Array.from(ownerByProject.keys())
  let reportsUnavailable = false
  if (projectIds.length > 0) {
    // Real reports only: the same predicate as first_report_received /
    // company_funnel_weekly. Filtered in TS (rows without a source tag are
    // real SDK reports). Volume is bounded: only projects of ≤14-day-old
    // accounts are in scope.
    const { data: reports, error } = await db
      .from('reports')
      .select('project_id, custom_metadata')
      .in('project_id', projectIds)
      .limit(5000)
    if (error) {
      // Fail closed: without report counts every user would look stalled and
      // day-2 / day-7 nudges would go to people who already activated.
      llog.error('reports_select_failed', { err: error.message })
      reportsUnavailable = true
    }
    for (const r of (reports ?? []) as Array<{ project_id: string; custom_metadata: Record<string, unknown> | null }>) {
      const source = r.custom_metadata?.source
      if (typeof source === 'string' && NON_REAL_REPORT_SOURCES.has(source)) continue
      const owner = ownerByProject.get(r.project_id)
      if (!owner) continue
      realReportsByUser.set(owner, (realReportsByUser.get(owner) ?? 0) + 1)
    }
  }

  return { excluded, sentByUser, realReportsByUser, mcpSetupDone, reportsUnavailable }
}

/**
 * Claim → build → send → (release on failure). Returns the per-user audit
 * result; never throws.
 */
async function sendOne(
  db: Db,
  user: CandidateUser,
  key: LifecycleEmailKey,
  ctx: { adminUrl: string; apiUrl: string; unsubSecret: string | null },
): Promise<SendStat> {
  const { error: claimErr } = await db
    .from('lifecycle_email_sends')
    .insert({ user_id: user.id, email_key: key })
  if (claimErr) {
    if (claimErr.code === '23505') return { user_id: user.id, email_key: key, result: 'claimed_elsewhere' }
    return { user_id: user.id, email_key: key, result: 'claim_failed', reason: claimErr.message }
  }

  const release = async () => {
    await db.from('lifecycle_email_sends').delete().eq('user_id', user.id).eq('email_key', key)
  }

  try {
    let unsubscribeUrl: string | null = null
    if (needsUnsubscribeLink(key)) {
      if (!ctx.unsubSecret) throw new Error('LIFECYCLE_UNSUB_SECRET not configured')
      const token = await signUnsubscribeToken(user.id, ctx.unsubSecret)
      unsubscribeUrl = `${ctx.apiUrl}/v1/public/email/unsubscribe?t=${encodeURIComponent(token)}`
    }
    const content = buildLifecycleEmail({
      key,
      adminUrl: ctx.adminUrl,
      unsubscribeUrl,
      signedUpOn: user.createdAt.toISOString().slice(0, 10),
    })
    const result = await sendTransactionalEmail({
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      headers: content.headers,
      replyTo: REPLY_TO,
      tags: { lifecycle_key: key },
    })
    if (!result.ok) {
      await release()
      return { user_id: user.id, email_key: key, result: 'send_failed', reason: result.reason }
    }
    return { user_id: user.id, email_key: key, result: 'sent' }
  } catch (err) {
    await release().catch(() => undefined)
    return {
      user_id: user.id,
      email_key: key,
      result: 'send_failed',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

async function runLifecycleEmails(db: Db): Promise<{ considered: number; stats: SendStat[] }> {
  const now = new Date()
  const users = await listRecentConfirmedUsers(db, now)
  const signals = await loadSignals(db, users)
  const ctx = { adminUrl: adminUrl(), apiUrl: apiPublicUrl(), unsubSecret: unsubscribeSecret() }
  const stats: SendStat[] = []

  for (const user of users) {
    if (stats.length >= MAX_SENDS_PER_TICK) break
    if (signals.excluded.has(user.id)) continue
    const key = decideLifecycleEmail({
      confirmedAt: user.confirmedAt,
      now,
      realReports: signals.realReportsByUser.get(user.id) ?? 0,
      mcpSetupDone: signals.mcpSetupDone.has(user.id),
      sent: signals.sentByUser.get(user.id) ?? new Set<string>(),
    })
    if (!key) continue
    // Report counts unknown this tick → only the account welcome may go out;
    // the nudges would otherwise fire at people who already activated.
    if (signals.reportsUnavailable && key !== 'day0_welcome') continue
    stats.push(await sendOne(db, user, key, ctx))
  }

  return { considered: users.length, stats }
}

const handler = async (req: Request): Promise<Response> => {
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getServiceClient()
  const cron = await startCronRun(db, 'lifecycle-emails', 'cron')

  try {
    // Layer 2 of the kill switch (layer 1 is the SQL dispatcher).
    if (!(await lifecycleEmailsEnabled(db))) {
      await cron.finish({ rowsAffected: 0, metadata: { skipped: 'disabled' } })
      return Response.json({ ok: true, data: { skipped: 'disabled', sent: 0 } })
    }
    if (!resolveSenderAddress()) {
      llog.warn('RESEND_FROM_EMAIL not set — lifecycle tick skipped')
      await cron.finish({ rowsAffected: 0, metadata: { skipped: 'no_sender' } })
      return Response.json({ ok: true, data: { skipped: 'no_sender', sent: 0 } })
    }
    if (!unsubscribeSecret()) {
      llog.warn('LIFECYCLE_UNSUB_SECRET not set (≥16 chars) — lifecycle tick skipped')
      await cron.finish({ rowsAffected: 0, metadata: { skipped: 'no_unsub_secret' } })
      return Response.json({ ok: true, data: { skipped: 'no_unsub_secret', sent: 0 } })
    }

    const { considered, stats } = await runLifecycleEmails(db)
    const sent = stats.filter((s) => s.result === 'sent').length
    const failed = stats.filter((s) => s.result === 'send_failed' || s.result === 'claim_failed').length
    const byKey: Record<string, number> = {}
    for (const s of stats) if (s.result === 'sent') byKey[s.email_key] = (byKey[s.email_key] ?? 0) + 1

    await cron.finish({
      rowsAffected: sent,
      metadata: { considered, attempted: stats.length, sent, failed, by_key: byKey },
    })

    return Response.json({
      ok: true,
      data: { considered, attempted: stats.length, sent, failed, by_key: byKey, per_user: stats },
    })
  } catch (err) {
    llog.error('lifecycle_emails_failed', { err: err instanceof Error ? err.message : String(err) })
    await cron.fail(err)
    throw err
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('lifecycle-emails', handler))
}
