/**
 * FILE: supabase/functions/usage-alerts/index.ts
 * PURPOSE: Cron edge function that fires 50%, 80%, and 100% diagnosis quota alerts
 *          to project owners. Guards the "anti-Cursor $7,225" predictability
 *          promise: users always see a warning before the spend cap kicks in.
 *
 * OVERVIEW:
 * - Runs hourly via pg_cron (every hour, top of hour).
 * - Queries usage_events for current-month diagnoses per project.
 * - Joins against billing_subscriptions → pricing_plans to get included quota.
 * - Fires a Resend email + operator Slack notification at 50%, 80%, and 100%
 *   thresholds (once each per billing month).
 * - Deduplication: checks `project_settings.last_usage_alert_50_at`,
 *   `last_usage_alert_80_at`, and `last_usage_alert_100_at`.
 *
 * DEPENDENCIES:
 * - _shared/db.ts, _shared/plans.ts, _shared/auth.ts, _shared/sentry.ts
 * - _shared/operator-notify.ts (operator Slack ping)
 * - Resend (RESEND_API_KEY + RESEND_FROM_EMAIL env vars)
 *
 * ENVIRONMENT:
 * - RESEND_API_KEY           — Resend API key for transactional email
 * - RESEND_FROM_EMAIL        — sender address (default: noreply@mushi-mushi.dev)
 * - MUSHI_CONSOLE_URL        — link in emails (default: https://app.mushi-mushi.dev)
 */

import { getServiceClient } from '../_shared/db.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { log } from '../_shared/logger.ts'
import { listPlans } from '../_shared/plans.ts'
import { notifyOperator } from '../_shared/operator-notify.ts'

const aLog = log.child('usage-alerts')

const RESEND_API = 'https://api.resend.com/emails'
const CONSOLE_URL = Deno.env.get('MUSHI_CONSOLE_URL') ?? 'https://app.mushi-mushi.dev'

/** Send a transactional email via Resend. Fail-soft. */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Mushi Mushi <noreply@mushi-mushi.dev>'
  if (!apiKey) {
    aLog.warn('RESEND_API_KEY not set — skipping email alert', { to, subject })
    return
  }
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      aLog.warn('Resend API error', { status: res.status, body: text.slice(0, 200) })
    }
  } catch (err) {
    aLog.warn('sendEmail failed', { err: String(err) })
  }
}

function buildAlertEmail(opts: {
  projectName: string
  diagnosesUsed: number
  diagnosesLimit: number
  pct: number
  planName: string
  spendCapUsd: number | null
  projectId: string
  alertTier: 50 | 80 | 100
}): { subject: string; html: string } {
  const isOver = opts.alertTier >= 100
  const threshold = `${opts.alertTier}%`
  const accentColor = isOver ? '#dc2626' : opts.alertTier >= 80 ? '#d97706' : '#2563eb'
  const used = opts.diagnosesUsed.toLocaleString()
  const limit = opts.diagnosesLimit.toLocaleString()
  const capNote = opts.spendCapUsd
    ? `<p>Your spend cap is set to <strong>$${opts.spendCapUsd}</strong>/month. Diagnoses will pause gracefully once you reach the cap — no surprise charges.</p>`
    : `<p><strong>Tip:</strong> Set a hard spend cap in <a href="${CONSOLE_URL}/billing">Billing settings</a> to prevent surprise charges.</p>`

  const subject = isOver
    ? `⚠️ Diagnosis quota reached — ${opts.projectName}`
    : opts.alertTier === 50
      ? `Early heads-up: ${opts.projectName} is at ${threshold} of monthly diagnoses`
      : `Heads up: ${opts.projectName} is at ${threshold} of monthly diagnoses`

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="border-left: 4px solid ${accentColor}; padding-left: 16px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 8px; font-size: 20px;">${isOver ? '⚠️ Quota reached' : '📊 Quota alert'}</h2>
    <p style="margin: 0; color: #555; font-size: 14px;">${opts.projectName} · ${opts.planName} plan</p>
  </div>

  <p>Your project has used <strong>${used} of ${limit} diagnoses</strong> this month (${opts.pct}%).</p>

  ${isOver
    ? `<p style="color: ${accentColor}; font-weight: 600;">New reports will continue to be received, but diagnoses (Stage-2 AI analysis) will pause until you upgrade or a new billing month starts.</p>`
    : opts.alertTier === 50
      ? `<p>You've crossed half your monthly diagnosis quota. You still have room — this is an early heads-up so you can adjust your spend cap or upgrade before triage pauses.</p>`
      : `<p>You are approaching your monthly diagnosis quota. Once you hit 100%, new bug reports will still be captured but won't receive AI triage until the cycle resets.</p>`
  }

  ${capNote}

  <div style="margin: 24px 0;">
    <a href="${CONSOLE_URL}/billing?project=${opts.projectId}"
       style="background: #111; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">
      ${isOver ? 'Upgrade plan' : 'View usage'}
    </a>
  </div>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #999; font-size: 12px;">
    Mushi Mushi · <a href="${CONSOLE_URL}/billing?project=${opts.projectId}">Manage billing</a> ·
    You're receiving this because you're an owner of <strong>${opts.projectName}</strong>.
  </p>
</body>
</html>`

  return { subject, html }
}

Deno.serve(withSentry('usage-alerts', async (req) => {
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getServiceClient()
  const plans = await listPlans()

  // Build plan lookup map.
  const planById = new Map(plans.map((p) => [p.id, p]))

  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  // Aggregate diagnoses used this billing month per project, excluding shadow rows.
  const { data: diagUsage } = await db
    .from('usage_events')
    .select('project_id, quantity')
    .eq('event_name', 'diagnoses')
    .gte('occurred_at', periodStart.toISOString())

  // Sum per project (excluding shadow rows; real rows have no shadow flag).
  const diagByProject = new Map<string, number>()
  for (const row of diagUsage ?? []) {
    // Phase 1 shadow events may still appear briefly; skip them.
    const meta = (row as unknown as { metadata?: Record<string, unknown> }).metadata
    if (meta?.['shadow'] === 'true') continue
    diagByProject.set(row.project_id, (diagByProject.get(row.project_id) ?? 0) + Number(row.quantity))
  }

  if (diagByProject.size === 0) {
    aLog.info('no diagnoses this month — nothing to alert', {})
    return new Response(JSON.stringify({ ok: true, checked: 0, sent: 0 }), { status: 200 })
  }

  // Fetch subscriptions + project settings for projects with usage.
  const projectIds = Array.from(diagByProject.keys())

  const [{ data: subs }, { data: settings }] = await Promise.all([
    db
      .from('billing_subscriptions')
      .select('project_id, plan_id, status, monthly_spend_cap_usd_override')
      .in('project_id', projectIds)
      .in('status', ['active', 'trialing', 'past_due']),
    db
      .from('project_settings')
      .select('project_id, last_usage_alert_50_at, last_usage_alert_80_at, last_usage_alert_100_at, alert_email')
      .in('project_id', projectIds),
  ])

  const subByProject = new Map<string, { plan_id: string | null; monthly_spend_cap_usd_override?: number | null }>()
  for (const s of subs ?? []) subByProject.set(s.project_id, s)

  const settingsByProject = new Map<string, {
    last_usage_alert_50_at: string | null
    last_usage_alert_80_at: string | null
    last_usage_alert_100_at: string | null
    alert_email: string | null
  }>()
  for (const s of settings ?? []) settingsByProject.set(s.project_id, s)

  // Fetch project owner emails for projects without an explicit alert_email.
  const { data: projects } = await db
    .from('projects')
    .select('id, name')
    .in('id', projectIds)
  const projectById = new Map((projects ?? []).map((p) => [p.id, p]))

  // Fetch owner emails: project_members → auth.users (via service role RPC).
  // Service role can read auth.users directly via a raw SQL query.
  const { data: members } = await db
    .from('project_members')
    .select('project_id, user_id, role')
    .in('project_id', projectIds)
    .eq('role', 'owner')

  const ownerUserIds = Array.from(new Set((members ?? []).map((m) => m.user_id)))
  let emailByUserId = new Map<string, string>()
  if (ownerUserIds.length > 0) {
    // Service role can call the get_user_emails_by_ids SECURITY DEFINER RPC
    // (migration 20260621120000) which queries auth.users in one round-trip.
    // db.rpc() returns a PostgrestFilterBuilder (thenable but no .catch method),
    // so we use await + try/catch instead of chaining .catch() — MUSHI-MUSHI-SERVER-13.
    let authUsers: { id: string; email: string }[] | null = null
    try {
      const { data, error } = await db.rpc('get_user_emails_by_ids', { p_user_ids: ownerUserIds })
      if (error) throw error
      authUsers = data as { id: string; email: string }[] | null
    } catch (err) {
      aLog.warn('get_user_emails_by_ids failed — falling back to admin API', { err: String(err) })
    }
    if (authUsers) {
      emailByUserId = new Map(authUsers.map((u) => [u.id, u.email]))
    } else {
      // Fallback: per-user auth.admin call (max 50 to avoid runaway).
      for (const uid of ownerUserIds.slice(0, 50)) {
        try {
          const { data } = await db.auth.admin.getUserById(uid)
          if (data?.user?.email) emailByUserId.set(uid, data.user.email)
        } catch {
          // best-effort — skip this user if admin API fails
        }
      }
    }
  }

  const ownerEmailByProject = new Map<string, string>()
  for (const m of members ?? []) {
    if (!ownerEmailByProject.has(m.project_id) && emailByUserId.get(m.user_id)) {
      ownerEmailByProject.set(m.project_id, emailByUserId.get(m.user_id)!)
    }
  }

  let sent = 0
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

  for (const [projectId, diagUsed] of diagByProject) {
    const sub = subByProject.get(projectId)
    const planId = sub?.plan_id ?? 'free_cloud'
    const plan = planById.get(planId)
    if (!plan) continue

    const diagLimit = plan.included_diagnoses_per_month
    if (!diagLimit || diagLimit <= 0) continue // unlimited / enterprise

    const pct = Math.round((diagUsed / diagLimit) * 100)
    if (pct < 50) continue

    const s = settingsByProject.get(projectId)
    const toEmail =
      s?.alert_email ??
      ownerEmailByProject.get(projectId) ??
      null

    const proj = projectById.get(projectId)
    const projectName = proj?.name ?? projectId
    const spendCap =
      (sub as unknown as { monthly_spend_cap_usd_override?: number | null } | null)
        ?.monthly_spend_cap_usd_override ??
      plan.monthly_spend_cap_usd ??
      null

    const isOver = pct >= 100
    const alertTier: 50 | 80 | 100 = isOver ? 100 : pct >= 80 ? 80 : 50
    const lastAlertKey =
      alertTier === 100
        ? 'last_usage_alert_100_at'
        : alertTier === 80
          ? 'last_usage_alert_80_at'
          : 'last_usage_alert_50_at'
    const lastAlert = s?.[lastAlertKey] ? new Date(s[lastAlertKey]!).getTime() : null
    const alreadySentThisMonth =
      lastAlert !== null && now.getTime() - lastAlert < thirtyDaysMs

    if (alreadySentThisMonth) continue

    // Build and send email.
    if (toEmail) {
      const { subject, html } = buildAlertEmail({
        projectName,
        diagnosesUsed: diagUsed,
        diagnosesLimit: diagLimit,
        pct,
        planName: plan.display_name,
        spendCapUsd: spendCap,
        projectId,
        alertTier,
      })
      await sendEmail(toEmail, subject, html)
      aLog.info('usage alert sent', { projectId, pct, toEmail })
      sent++
    }

    // Also ping the operator via Slack (informational — no PII, just project name).
    await notifyOperator({
      title:
        alertTier === 100
          ? 'Diagnosis quota reached'
          : alertTier === 80
            ? 'Diagnosis quota 80% alert'
            : 'Diagnosis quota 50% alert',
      body: `${projectName} is at ${pct}% of ${diagLimit.toLocaleString()} diagnoses/month (${plan.display_name}).`,
      level: isOver ? 'urgent' : 'warn',
      fields: [
        { label: 'Project', value: projectName },
        { label: 'Plan', value: plan.display_name },
        { label: 'Usage', value: `${diagUsed} / ${diagLimit} (${pct}%)` },
        { label: 'Spend cap', value: spendCap ? `$${spendCap}` : 'none set' },
      ],
      url: `${CONSOLE_URL}/billing?project=${projectId}`,
    })

    // Stamp the alert timestamp so we don't re-fire within the same month.
    await db
      .from('project_settings')
      .upsert({ project_id: projectId, [lastAlertKey]: now.toISOString() }, { onConflict: 'project_id' })
  }

  aLog.info('usage-alerts run complete', { checked: diagByProject.size, sent })
  return new Response(JSON.stringify({ ok: true, checked: diagByProject.size, sent }), { status: 200 })
}))
