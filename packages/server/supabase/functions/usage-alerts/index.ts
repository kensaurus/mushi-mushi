/**
 * FILE: supabase/functions/usage-alerts/index.ts
 * PURPOSE: Cron edge function that fires 50%, 80%, and 100% diagnosis quota alerts
 *          to team owners (a plan's diagnoses are shared by every app in the
 *          team). Guards the "anti-Cursor $7,225" predictability
 *          promise: users always see a warning before the spend cap kicks in.
 *
 * OVERVIEW:
 * - Runs hourly via pg_cron (every hour, top of hour).
 * - Finds the teams with diagnoses this month, then counts each team's
 *   diagnoses across its apps against the team's plan (_shared/org-billing.ts).
 *   Complimentary teams are skipped.
 * - Fires a Resend email + operator Slack notification at 50%, 80%, and 100%
 *   thresholds (once each per billing month).
 * - Deduplication: checks `project_settings.last_usage_alert_50_at`,
 *   `last_usage_alert_80_at`, and `last_usage_alert_100_at` on one app per
 *   team (lowest id).
 *
 * DEPENDENCIES:
 * - _shared/db.ts, _shared/plans.ts, _shared/auth.ts, _shared/sentry.ts
 * - _shared/operator-notify.ts (operator Slack ping)
 * - Resend (RESEND_API_KEY + RESEND_FROM_EMAIL env vars)
 *
 * ENVIRONMENT:
 * - RESEND_API_KEY           — Resend API key for transactional email
 * - RESEND_FROM_EMAIL        — verified sender address (required; no default — see _shared/email.ts)
 * - MUSHI_CONSOLE_URL        — link in emails (default: https://app.mushi-mushi.dev)
 */

import { getServiceClient } from '../_shared/db.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { log } from '../_shared/logger.ts'
import { countOrgUsage, resolveOrgBilling } from '../_shared/org-billing.ts'
import { diagnosisOverageBillable } from '../_shared/billing-rules.ts'
import { notifyOperator } from '../_shared/operator-notify.ts'
import { sendTransactionalEmail } from '../_shared/email.ts'
import { runLlmBudgetAlerts } from '../_shared/llm-budget-alerts.ts'
import { sendBotMessage } from '../_shared/slack.ts'

const aLog = log.child('usage-alerts')

const CONSOLE_URL = Deno.env.get('MUSHI_CONSOLE_URL') ?? 'https://app.mushi-mushi.dev'

/**
 * Send a transactional email via the shared Resend sender. Fail-soft: a
 * missing RESEND_FROM_EMAIL / RESEND_API_KEY or a Resend error is logged and
 * the alert is skipped. The caller still stamps the once-per-month dedup
 * column (unchanged behavior), so the warning is the only signal — keep the
 * sender configured.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const result = await sendTransactionalEmail({ to, subject, html })
  if (!result.ok) {
    aLog.warn('usage alert email skipped', { reason: result.reason, error: result.error, subject })
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
  /** Annual subscription: no overage item, so diagnoses stop at the limit. */
  noOverage?: boolean
}): { subject: string; html: string } {
  const isOver = opts.alertTier >= 100
  const threshold = `${opts.alertTier}%`
  const accentColor = isOver ? '#dc2626' : opts.alertTier >= 80 ? '#d97706' : '#2563eb'
  const used = opts.diagnosesUsed.toLocaleString()
  const limit = opts.diagnosesLimit.toLocaleString()
  const capNote = opts.noOverage
    ? `<p>Annual plans include a fixed number of diagnoses each month and have no overage, so nothing is charged above your plan price. For more diagnoses, switch to monthly or to Pro with <strong>Change plan</strong> in <a href="${CONSOLE_URL}/billing">Billing</a>.</p>`
    : opts.spendCapUsd
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

  <p>Your team has used <strong>${used} of ${limit} diagnoses</strong> this month (${opts.pct}%).</p>

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
    You're receiving this because you're an owner of the team <strong>${opts.projectName}</strong>.
  </p>
</body>
</html>`

  return { subject, html }
}

Deno.serve(withSentry('usage-alerts', async (req) => {
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getServiceClient()

  // Monthly AI budget alerts first: the diagnosis check below returns early in
  // a month with no diagnoses, and the budget can still be spent by chat.
  const budget = await runLlmBudgetAlerts(db, {
    email: async (to, subject, text) => {
      const html = `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n\n/g, '</p><p>')}</p>`
      await sendEmail(to, subject, html)
    },
    slack: async (projectId, channel, text) => {
      const r = await sendBotMessage({ db, projectId, channel, text })
      if (!r.ok) throw new Error(`slack: ${r.error}`)
    },
    operator: async (a, text) => {
      await notifyOperator({
        title: a.tier === 100 ? 'AI budget reached' : `AI budget ${a.tier}% alert`,
        body: text,
        level: a.tier === 100 ? 'urgent' : 'warn',
        fields: [
          { label: 'Project', value: a.projectName },
          { label: 'Spend', value: `$${a.spendUsd.toFixed(2)} / $${a.budgetUsd.toFixed(0)}` },
        ],
        url: a.consoleUrl,
      })
    },
    ownerEmail: async (projectId) => {
      const { data: owner } = await db.from('project_members').select('user_id').eq('project_id', projectId).eq('role', 'owner').limit(1).maybeSingle()
      const uid = (owner as { user_id?: string } | null)?.user_id
      if (!uid) return null
      const { data } = await db.rpc('get_user_emails_by_ids', { p_user_ids: [uid] })
      return ((data ?? []) as Array<{ email?: string }>)[0]?.email ?? null
    },
  }, { consoleUrl: CONSOLE_URL }).catch((err) => {
    aLog.error('AI budget alerts failed', { err: err instanceof Error ? err.message : String(err) })
    return { checked: 0, sent: 0, errors: 1 }
  })
  aLog.info('AI budget alerts', budget)

  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  // Which apps had a diagnosis this month (only to find the teams to check;
  // the count itself is exact, per team, below).
  const { data: diagUsage } = await db
    .from('usage_events')
    .select('project_id')
    .eq('event_name', 'diagnoses')
    .gte('occurred_at', periodStart.toISOString())

  const activeProjectIds = Array.from(new Set((diagUsage ?? []).map((r) => (r as { project_id: string }).project_id)))
  if (activeProjectIds.length === 0) {
    aLog.info('no diagnoses this month — nothing to alert', {})
    return new Response(JSON.stringify({ ok: true, checked: 0, sent: 0 }), { status: 200 })
  }

  // A plan and its diagnoses belong to the team (organization): one alert per
  // team, on its pooled count, against the team's plan.
  const { data: activeProjects } = await db
    .from('projects')
    .select('organization_id')
    .in('id', activeProjectIds)
  const orgIds = Array.from(
    new Set(
      ((activeProjects ?? []) as Array<{ organization_id: string | null }>)
        .map((p) => p.organization_id)
        .filter((x): x is string => Boolean(x)),
    ),
  )
  const { data: orgRows } = orgIds.length > 0
    ? await db.from('organizations').select('id, name').in('id', orgIds)
    : { data: [] as Array<{ id: string; name: string | null }> }
  const orgNameById = new Map(((orgRows ?? []) as Array<{ id: string; name: string | null }>).map((o) => [o.id, o.name]))

  let sent = 0
  let checked = 0
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

  for (const orgId of orgIds) {
    let billing: Awaited<ReturnType<typeof resolveOrgBilling>>
    try {
      billing = await resolveOrgBilling(db, orgId, { includeProjectIds: true })
    } catch (err) {
      aLog.warn('team billing read failed; skipping', { orgId, err: err instanceof Error ? err.message : String(err) })
      continue
    }
    // Mushi Mushi pays for complimentary teams; there is nothing to warn about.
    if (billing.billingMode === 'complimentary') continue
    const plan = billing.plan
    const sub = billing.liveSub
    const diagLimit = plan.included_diagnoses_per_month
    if (!diagLimit || diagLimit <= 0) continue // unlimited / enterprise

    const { count: diagUsed, error: countErr } = await countOrgUsage(
      db,
      billing.projectIds,
      'diagnoses',
      { startIso: periodStart.toISOString(), endIso: periodEnd.toISOString() },
      { excludeShadow: true },
    )
    if (countErr) {
      aLog.warn('team diagnosis count failed; skipping', { orgId, err: countErr.message })
      continue
    }
    checked++

    const pct = Math.round((diagUsed / diagLimit) * 100)
    if (pct < 50) continue

    // The team's alert state and alert address live on one app: the oldest
    // in id order, so every run picks the same one.
    const projectId = [...billing.projectIds].sort()[0]
    if (!projectId) continue
    const [{ data: settingRows }, { data: owner }] = await Promise.all([
      db
        .from('project_settings')
        .select('project_id, last_usage_alert_50_at, last_usage_alert_80_at, last_usage_alert_100_at, alert_email')
        .in('project_id', billing.projectIds),
      db
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle(),
    ])
    const rows = (settingRows ?? []) as Array<{
      project_id: string
      last_usage_alert_50_at: string | null
      last_usage_alert_80_at: string | null
      last_usage_alert_100_at: string | null
      alert_email: string | null
    }>
    const settings = rows.find((r) => r.project_id === projectId) ?? null

    const teamName = orgNameById.get(orgId) ?? 'Your team'
    const spendCap = sub?.monthly_spend_cap_usd_override ?? plan.monthly_spend_cap_usd ?? null

    const isOver = pct >= 100
    const alertTier: 50 | 80 | 100 = isOver ? 100 : pct >= 80 ? 80 : 50
    const lastAlertKey =
      alertTier === 100
        ? 'last_usage_alert_100_at'
        : alertTier === 80
          ? 'last_usage_alert_80_at'
          : 'last_usage_alert_50_at'
    const lastAlert = settings?.[lastAlertKey] ? new Date(settings[lastAlertKey]!).getTime() : null
    const alreadySentThisMonth =
      lastAlert !== null && now.getTime() - lastAlert < thirtyDaysMs

    if (alreadySentThisMonth) continue

    // An alert address set on any app's card counts for the team.
    let toEmail = settings?.alert_email ?? rows.find((r) => r.alert_email)?.alert_email ?? null
    const ownerId = (owner as { user_id?: string } | null)?.user_id
    if (!toEmail && ownerId) {
      try {
        const { data, error } = await db.rpc('get_user_emails_by_ids', { p_user_ids: [ownerId] })
        if (error) throw error
        toEmail = ((data ?? []) as Array<{ email?: string }>)[0]?.email ?? null
      } catch {
        try {
          const { data } = await db.auth.admin.getUserById(ownerId)
          toEmail = data?.user?.email ?? null
        } catch {
          // best-effort — no address, no email
        }
      }
    }

    // Build and send email.
    if (toEmail) {
      const { subject, html } = buildAlertEmail({
        projectName: teamName,
        diagnosesUsed: diagUsed,
        diagnosesLimit: diagLimit,
        pct,
        planName: plan.display_name,
        spendCapUsd: spendCap,
        projectId,
        alertTier,
        noOverage: !!sub && !diagnosisOverageBillable(sub),
      })
      await sendEmail(toEmail, subject, html)
      aLog.info('usage alert sent', { orgId, pct, toEmail })
      sent++
    }

    // Also ping the operator via Slack (informational — no PII, just the team name).
    await notifyOperator({
      title:
        alertTier === 100
          ? 'Diagnosis quota reached'
          : alertTier === 80
            ? 'Diagnosis quota 80% alert'
            : 'Diagnosis quota 50% alert',
      body: `${teamName} is at ${pct}% of ${diagLimit.toLocaleString()} diagnoses/month (${plan.display_name}).`,
      level: isOver ? 'urgent' : 'warn',
      fields: [
        { label: 'Team', value: teamName },
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

  aLog.info('usage-alerts run complete', { checked, sent })
  return new Response(JSON.stringify({ ok: true, checked, sent }), { status: 200 })
}))
