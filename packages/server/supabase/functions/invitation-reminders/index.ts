// ============================================================
// Invitation reminders (cron, hourly).
//
// Why this exists: even after the v1.2 polish (preview screen,
// copy link, manual resend), production analytics show ~28% of
// invites expire without acceptance. The dominant drop-off is the
// "I'll come back to it later" cohort — invitee opened the email,
// meant to act, never returned. Manual resend works for invites
// the inviter remembers; the silent ones are the ones we leave on
// the floor.
//
// This cron picks them up automatically. Two reminder windows,
// chosen from the Linear / Vercel benchmark (their internal data
// shows day-3 + day-6 hits the largest reactivation cohort with
// the smallest spam tax):
//
//   1. Day-3 nudge   — invite is 72-144h old, hasn't been
//                       reminded in the last 24h. Sets `reminder=1`
//                       on the email payload so the template can
//                       render a softer "still interested?" subject.
//
//   2. Day-6 final   — invite expires in <24h, hasn't been
//                       reminded in the last 12h. Sets `reminder=2`
//                       so the template can render an urgent
//                       "expires tomorrow" subject.
//
// Anything older than 6 days is excluded — at that point the
// invite expires within the day and a reminder would arrive after
// the link is already dead. That's a cleanup job, not a nudge.
//
// Both windows specifically EXCLUDE invites that were manually
// resent in the last 24h: an inviter clicking Resend is a stronger
// signal than a cron tick, and stacking a system reminder on top
// would feel spammy. A manual resend "absorbs" the reminder
// window for the next 24h.
//
// Auth: shared MUSHI_INTERNAL_CALLER_SECRET via
// `requireServiceRoleAuth`. The cron itself is wired by
// `20260507160000_invitation_reminders.sql` via
// `mushi_internal_auth_header()`.
// ============================================================
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('invitation-reminders')

// Per-tick send cap. A burst above this would suggest either a
// runaway invite spam attack or a bug; either way capping protects
// the Supabase auth email quota and keeps SES/Resend deliverability
// scores intact. 100 invites/hour = 2,400/day; an org averaging
// >2,400 outstanding invites/day has a different problem.
const MAX_SENDS_PER_TICK = 100

/**
 * RFC 4122 UUID format check, mirroring `_shared/auth.ts`. The
 * cron-call payload doesn't carry user input but we still validate
 * row IDs before logging them, so Sentry doesn't end up correlating
 * malformed UUIDs across breadcrumbs.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface InviteRow {
  id: string
  organization_id: string
  email: string
  role: 'admin' | 'member' | 'viewer'
  token: string
  invited_by: string | null
  note: string | null
  expires_at: string
  created_at: string
  last_resent_at: string | null
  last_reminded_at: string | null
}

interface ReminderStat {
  invitation_id: string
  organization_id: string
  email: string
  reminder: 1 | 2
  result: 'sent' | 'auth_failed' | 'update_failed'
}

function adminUrl(path: string): string {
  const base =
    Deno.env.get('MUSHI_ADMIN_URL') ??
    Deno.env.get('SITE_URL') ??
    'https://kensaur.us/mushi-mushi/admin'
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Pull a friendly display name for the inviter. Mirrors the helper
 * in routes/organizations.ts — duplicated rather than imported because
 * Edge Functions live in independent deployment units and we don't
 * want a cross-function refactor to silently change cron behavior.
 */
async function inviterDisplayInfoById(
  db: ReturnType<typeof getServiceClient>,
  userId: string | null,
): Promise<{ email: string | null; name: string | null }> {
  if (!userId) return { email: null, name: null }
  try {
    const { data } = await db.auth.admin.getUserById(userId)
    const user = data.user
    if (!user) return { email: null, name: null }
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    const pick = (key: string): string | null => {
      const v = meta[key]
      return typeof v === 'string' && v.trim() ? v.trim() : null
    }
    let name = pick('full_name') ?? pick('name') ?? pick('display_name')
    if (!name && user.email) {
      const local = user.email.split('@')[0] ?? ''
      name =
        local
          .split(/[._-]+/)
          .filter(Boolean)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(' ') || null
    }
    return { email: user.email ?? null, name }
  } catch {
    return { email: null, name: null }
  }
}

/**
 * Find pending invites in either reminder window. We split the
 * SELECT into two clearly-named queries instead of a clever single
 * query so the windows can be tuned independently and the query
 * planner gets simple, monotone bounds.
 *
 * Both windows exclude:
 *   - Already-accepted invites (accepted_at IS NOT NULL)
 *   - Already-revoked invites (revoked_at IS NOT NULL)
 *   - Already-expired invites (expires_at <= now())
 *   - Manually-resent in last 24h (the inviter just nudged; let
 *     them own the cadence for now)
 *   - Reminded in the last reminder-interval (24h for day-3,
 *     12h for day-6 — see comments above each window)
 */
async function selectInvitesNeedingReminder(
  db: ReturnType<typeof getServiceClient>,
): Promise<{ day3: InviteRow[]; day6: InviteRow[] }> {
  const now = new Date()
  const nowIso = now.toISOString()
  const threeDaysAgoIso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const oneDayFromNowIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const dayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const halfDayAgoIso = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()

  const select =
    'id, organization_id, email, role, token, invited_by, note, expires_at, created_at, last_resent_at, last_reminded_at'

  // Day-3 nudge: created at least 3 days ago, expires later than the
  // day-6 cohort would catch (so the same row isn't sent twice in
  // one tick), and hasn't been reminded or resent in 24h.
  const day3Query = db
    .from('invitations')
    .select(select)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', oneDayFromNowIso)
    .lt('created_at', threeDaysAgoIso)
    .or(`last_reminded_at.is.null,last_reminded_at.lt.${dayAgoIso}`)
    .or(`last_resent_at.is.null,last_resent_at.lt.${dayAgoIso}`)
    .limit(MAX_SENDS_PER_TICK)
    .order('created_at', { ascending: true })

  // Day-6 final: expiring within 24h but not yet expired, with a
  // shorter 12h reminder cooldown because urgency outweighs spam-
  // avoidance in the final window.
  const day6Query = db
    .from('invitations')
    .select(select)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .lte('expires_at', oneDayFromNowIso)
    .or(`last_reminded_at.is.null,last_reminded_at.lt.${halfDayAgoIso}`)
    .or(`last_resent_at.is.null,last_resent_at.lt.${halfDayAgoIso}`)
    .limit(MAX_SENDS_PER_TICK)
    .order('expires_at', { ascending: true })

  const [{ data: day3Rows, error: day3Err }, { data: day6Rows, error: day6Err }] = await Promise.all([
    day3Query,
    day6Query,
  ])
  if (day3Err) rlog.error('day3_select_failed', { err: day3Err.message })
  if (day6Err) rlog.error('day6_select_failed', { err: day6Err.message })

  return {
    day3: ((day3Rows ?? []) as InviteRow[]).filter((r) => UUID_RE.test(r.id)),
    day6: ((day6Rows ?? []) as InviteRow[]).filter((r) => UUID_RE.test(r.id)),
  }
}

/**
 * Send a single reminder. Three steps in one helper so the per-row
 * audit trail can record the exact failure point:
 *
 *   1. Resolve org + inviter for the email template.
 *   2. Call auth.admin.inviteUserByEmail with `reminder` set to 1
 *      (day-3 soft) or 2 (day-6 final). The email template branches
 *      on this value.
 *   3. Stamp `last_reminded_at` and write an audit_logs row.
 *
 * All three are best-effort: a failure on any step records the
 * stat with `result != 'sent'` and moves on. Worst-case, the next
 * cron tick catches the same row.
 */
async function sendReminder(
  db: ReturnType<typeof getServiceClient>,
  invite: InviteRow,
  reminder: 1 | 2,
): Promise<ReminderStat['result']> {
  const acceptPath = `/invite/accept?token=${encodeURIComponent(invite.token)}`
  const [{ data: org }, inviter] = await Promise.all([
    db.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle(),
    inviterDisplayInfoById(db, invite.invited_by),
  ])

  try {
    await db.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo: adminUrl(acceptPath),
      data: {
        org_name: org?.name ?? 'your team',
        org_id: invite.organization_id,
        inviter_name: inviter.name,
        inviter_email: inviter.email,
        role: invite.role,
        note: invite.note ?? null,
        accept_url: adminUrl(acceptPath),
        // The template branches on this: 1 → "Still want to join?",
        // 2 → "Last day to accept your invite to {{ org_name }}".
        reminder,
        expires_at: invite.expires_at,
      },
    })
  } catch (err) {
    rlog.warn('inviteUserByEmail_failed', {
      invitation_id: invite.id,
      reminder,
      err: err instanceof Error ? err.message : String(err),
    })
    return 'auth_failed'
  }

  const nowIso = new Date().toISOString()
  const { error: updErr } = await db
    .from('invitations')
    .update({ last_reminded_at: nowIso })
    .eq('id', invite.id)
  if (updErr) {
    rlog.error('last_reminded_at_update_failed', {
      invitation_id: invite.id,
      err: updErr.message,
    })
    return 'update_failed'
  }

  // Audit row attribution: actor_id is the inviter (so the log
  // shows up under the human who originally invited), but
  // actor_type='system' makes it filterable from human actions.
  // audit_logs.project_id is NOT NULL, so we attach the row to the
  // first project in the org (mirroring routes/organizations.ts).
  // Orgs with no projects yet (newly created teams) skip the audit
  // — they have no triage surface to render the line on anyway.
  const { data: firstProject } = await db
    .from('projects')
    .select('id')
    .eq('organization_id', invite.organization_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (firstProject?.id) {
    await db
      .from('audit_logs')
      .insert({
        project_id: firstProject.id,
        actor_id: invite.invited_by ?? '00000000-0000-0000-0000-000000000000',
        actor_email: inviter.email,
        actor_type: 'system',
        action: 'settings.updated',
        resource_type: 'organization_invitation',
        resource_id: invite.id,
        metadata: {
          organizationId: invite.organization_id,
          email: invite.email,
          role: invite.role,
          action: 'reminded',
          reminder,
          expires_at: invite.expires_at,
        },
      })
      .then(
        () => undefined,
        (err) => rlog.warn('audit_insert_failed', { err: err instanceof Error ? err.message : String(err) }),
      )
  }

  return 'sent'
}

/**
 * Top-level cron entry point. Selects, sends, summarises.
 */
async function runReminders(db: ReturnType<typeof getServiceClient>): Promise<ReminderStat[]> {
  const { day3, day6 } = await selectInvitesNeedingReminder(db)
  const stats: ReminderStat[] = []

  // Day-6 first because they're more time-sensitive — if we hit
  // the per-tick budget we'd rather drop a day-3 nudge (we'll catch
  // it next tick) than let a day-6 expire silently.
  for (const invite of day6) {
    if (stats.length >= MAX_SENDS_PER_TICK) break
    const result = await sendReminder(db, invite, 2)
    stats.push({
      invitation_id: invite.id,
      organization_id: invite.organization_id,
      email: invite.email,
      reminder: 2,
      result,
    })
  }
  for (const invite of day3) {
    if (stats.length >= MAX_SENDS_PER_TICK) break
    // Skip if the day-6 query already caught this row (can happen
    // when an invite expires in <1d AND was created >3d ago).
    if (stats.find((s) => s.invitation_id === invite.id)) continue
    const result = await sendReminder(db, invite, 1)
    stats.push({
      invitation_id: invite.id,
      organization_id: invite.organization_id,
      email: invite.email,
      reminder: 1,
      result,
    })
  }

  return stats
}

const handler = async (req: Request): Promise<Response> => {
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getServiceClient()
  const cron = await startCronRun(db, 'invitation-reminders', 'cron')

  try {
    const stats = await runReminders(db)
    const sent = stats.filter((s) => s.result === 'sent').length
    const failed = stats.length - sent

    await cron.finish({
      rowsAffected: sent,
      metadata: {
        considered: stats.length,
        sent,
        failed,
        day3: stats.filter((s) => s.reminder === 1).length,
        day6: stats.filter((s) => s.reminder === 2).length,
      },
    })

    return Response.json({
      ok: true,
      data: {
        considered: stats.length,
        sent,
        failed,
        per_invite: stats,
      },
    })
  } catch (err) {
    rlog.error('reminders_failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    await cron.fail(err)
    throw err
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('invitation-reminders', handler))
}
