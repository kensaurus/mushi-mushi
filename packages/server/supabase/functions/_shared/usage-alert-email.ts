/**
 * FILE: packages/server/supabase/functions/_shared/usage-alert-email.ts
 * PURPOSE: The usage-alerts emails (diagnosis quota at 50 / 80 / 100 % and
 *          the monthly AI budget alerts) on the KENSAURUS email kit
 *          (`renderMail`, yen-yen ADR 0100) as kind `transactional`: an
 *          account notice, so no unsubscribe, with the kit's legal footer and
 *          its "More from KENSAURUS" row.
 *
 * Pure: no Deno globals, so api/routes/usage-alert-email.test.ts imports it
 * directly. usage-alerts/index.ts passes in its console URL.
 */
import { renderMail, type MailBlock } from './kensaurus-spine/mail.ts'

export interface AlertEmail {
  subject: string
  html: string
  text: string
}

export interface QuotaAlertInput {
  /** The console base (MUSHI_CONSOLE_URL or this install's own), no trailing slash. */
  consoleUrl: string
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
}

export function buildQuotaAlertEmail(opts: QuotaAlertInput): AlertEmail {
  const isOver = opts.alertTier >= 100
  const threshold = `${opts.alertTier}%`
  const used = opts.diagnosesUsed.toLocaleString()
  const limit = opts.diagnosesLimit.toLocaleString()
  const billingUrl = `${opts.consoleUrl}/billing?project=${opts.projectId}`

  const subject = isOver
    ? `⚠️ Diagnosis quota reached — ${opts.projectName}`
    : opts.alertTier === 50
      ? `Early heads-up: ${opts.projectName} is at ${threshold} of monthly diagnoses`
      : `Heads up: ${opts.projectName} is at ${threshold} of monthly diagnoses`

  const status = isOver
    ? 'New reports will continue to be received, but diagnoses (Stage-2 AI analysis) will pause until you upgrade or a new billing month starts.'
    : opts.alertTier === 50
      ? "You've crossed half your monthly diagnosis quota. You still have room — this is an early heads-up so you can adjust your spend cap or upgrade before triage pauses."
      : "You are approaching your monthly diagnosis quota. Once you hit 100%, new bug reports will still be captured but won't receive AI triage until the cycle resets."

  const capNote = opts.noOverage
    ? 'Annual plans include a fixed number of diagnoses each month and have no overage, so nothing is charged above your plan price. For more diagnoses, switch to monthly or to Pro with Change plan in Billing.'
    : opts.spendCapUsd
      ? `Your spend cap is set to $${opts.spendCapUsd}/month. Diagnoses will pause gracefully once you reach the cap — no surprise charges.`
      : 'Tip: set a hard spend cap in Billing settings to prevent surprise charges.'

  const blocks: MailBlock[] = [
    { type: 'heading', text: isOver ? 'Quota reached' : 'Quota alert' },
    { type: 'facts', items: [`${used} of ${limit} diagnoses`, `${opts.pct}% of this month's quota`], id: 'usage' },
    { type: 'paragraph', text: `Your team has used ${used} of ${limit} diagnoses this month (${opts.pct}%).` },
    { type: 'paragraph', text: status },
    { type: 'paragraph', text: capNote },
    { type: 'button', label: isOver ? 'Upgrade plan' : 'View usage', url: billingUrl, id: 'billing' },
    { type: 'note', text: `You're receiving this because you're an owner of the team ${opts.projectName}.` },
  ]

  const mail = renderMail({
    app: 'mushi-mushi',
    lang: 'en',
    kind: 'transactional',
    campaign: `usage-alert-${opts.alertTier}`,
    subject,
    preheader: `Your team has used ${used} of ${limit} diagnoses this month (${opts.pct}%).`,
    eyebrow: `${opts.projectName} · ${opts.planName} plan`,
    blocks,
  })
  return { subject: mail.subject, html: mail.html, text: mail.text }
}

/** The AI budget alert (_shared/llm-budget-alerts.ts writes the words): one paragraph per blank line. */
export function buildBudgetAlertEmail(subject: string, text: string): AlertEmail {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const mail = renderMail({
    app: 'mushi-mushi',
    lang: 'en',
    kind: 'transactional',
    campaign: 'llm-budget-alert',
    subject,
    preheader: paragraphs[0] ?? subject,
    blocks: paragraphs.map((p): MailBlock => ({ type: 'paragraph', text: p })),
  })
  return { subject: mail.subject, html: mail.html, text: mail.text }
}
