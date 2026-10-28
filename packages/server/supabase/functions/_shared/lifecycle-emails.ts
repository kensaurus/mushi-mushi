/**
 * FILE: packages/server/supabase/functions/_shared/lifecycle-emails.ts
 * PURPOSE: Pure policy + copy for the four lifecycle emails
 *          (docs/plan-gtm.md → Workstream B §3). No Deno / DB imports so the
 *          windows, exits and templates are unit-testable with plain
 *          `deno test` (api/routes/lifecycle-emails.test.ts).
 *
 * | key            | window after email_confirmed_at | condition                          | exit                 |
 * |----------------|----------------------------------|------------------------------------|----------------------|
 * | day0_welcome   | ≤ 2 h                            | —                                  | —                    |
 * | day2_nudge     | 44–72 h                          | 0 real reports                     | any real report      |
 * | day7_stalled   | 7–8 d                            | 0 real reports                     | any real report      |
 * | day7_activated | 7–8 d                            | ≥ 1 real report, no mcp_setup_done | mcp_setup_done       |
 *
 * "Real report" excludes metadata.source admin_test_report /
 * mushi-marketing-seed — the same predicate as first_report_received.
 * Opted-out users, operators, synthetic test accounts and tester-only accounts
 * are excluded before this policy runs.
 *
 * Voice: docs/marketing/VOICE.md, sober register. Plain text first; the HTML
 * is the same words with links. No mascot in subject lines, no pixels.
 */

export const LIFECYCLE_EMAIL_KEYS = ['day0_welcome', 'day2_nudge', 'day7_stalled', 'day7_activated'] as const
export type LifecycleEmailKey = (typeof LIFECYCLE_EMAIL_KEYS)[number]

const HOUR_MS = 60 * 60 * 1000

export interface LifecycleCandidate {
  /** auth.users.email_confirmed_at */
  confirmedAt: Date
  now: Date
  /** Reports on the user's owned projects excluding test/seed sources. */
  realReports: number
  /** setup_funnel_events mcp_setup_done exists for this user. */
  mcpSetupDone: boolean
  /** Keys already in lifecycle_email_sends for this user. */
  sent: ReadonlySet<string>
}

/**
 * Which email (if any) this user should get on this tick. At most one per
 * tick; the windows do not overlap so the order below is only a tie-break
 * for the two day-7 variants.
 */
export function decideLifecycleEmail(c: LifecycleCandidate): LifecycleEmailKey | null {
  const ageH = (c.now.getTime() - c.confirmedAt.getTime()) / HOUR_MS
  if (!Number.isFinite(ageH) || ageH < 0) return null

  if (ageH <= 2 && !c.sent.has('day0_welcome')) return 'day0_welcome'
  if (ageH >= 44 && ageH < 72 && c.realReports === 0 && !c.sent.has('day2_nudge')) return 'day2_nudge'
  if (ageH >= 168 && ageH < 192) {
    if (c.realReports === 0 && !c.sent.has('day7_stalled')) return 'day7_stalled'
    if (c.realReports >= 1 && !c.mcpSetupDone && !c.sent.has('day7_activated')) return 'day7_activated'
  }
  return null
}

/**
 * Every lifecycle email carries List-Unsubscribe and a visible link, the
 * day-0 welcome included (owner's GTM plan, 2026-10-28): it is a product
 * nudge, not a receipt. Kept as a function so a future account-service email
 * has one place to opt out.
 */
export function needsUnsubscribeLink(_key: LifecycleEmailKey): boolean {
  return true
}

/** Resend `Idempotency-Key` for one lifecycle email to one user (Resend keeps keys 24 h). */
export function lifecycleIdempotencyKey(userId: string, key: LifecycleEmailKey): string {
  return `lifecycle/${userId.toLowerCase()}/${key}`
}

/** The failure half of _shared/email.ts SendEmailResult. */
export interface LifecycleSendFailure {
  ok: false
  reason: string
  error: string
}

/**
 * Whether a failed send may give its lifecycle_email_sends claim back so a
 * later tick retries it. Not on Resend's 409: the same Idempotency-Key was
 * used while the first request was still running (or with another body), so
 * the email may already be out. A timeout is retried: the retry carries the
 * same Idempotency-Key, and Resend answers it with the first send's result
 * instead of sending again.
 */
export function shouldReleaseClaim(result: LifecycleSendFailure): boolean {
  return !(result.reason === 'http_error' && /^Resend 409\b/.test(result.error))
}

/**
 * A Mushi Bounties tester who builds nothing gets no builder emails: the
 * copy is about installing the SDK in their app. Same rule as the company
 * funnel's people set (signup_track 'tester', the older signup_intent
 * stamp, or a mushi_testers row, and no project owned).
 */
export function isTesterOnlyAccount(
  meta: Record<string, unknown> | null | undefined,
  ownsProject: boolean,
  isMarketplaceTester: boolean,
): boolean {
  if (ownsProject) return false
  return isMarketplaceTester || meta?.signup_track === 'tester' || meta?.signup_intent === 'tester'
}

export interface LifecycleEmailInput {
  key: LifecycleEmailKey
  /** Console base, e.g. https://kensaur.us/mushi-mushi/admin (no trailing slash). */
  adminUrl: string
  /** Signed one-click link; required for every key. */
  unsubscribeUrl?: string | null
  /** Account creation date shown in the footer (YYYY-MM-DD). */
  signedUpOn?: string | null
}

export interface LifecycleEmailContent {
  subject: string
  text: string
  html: string
  headers: Record<string, string>
}

const CURSOR_SETUP = 'npx mushi-mushi setup --ide cursor'
const SNIPPET = [
  'npm install @mushi-mushi/web',
  '',
  "import { Mushi } from '@mushi-mushi/web'",
  "Mushi.init({ projectId: '<your project id>', apiKey: '<your api key>' })",
].join('\n')

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

type Block =
  | { p: string }
  | { link: string; label?: string }
  | { pre: string }

function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if ('p' in b) return b.p
      if ('link' in b) return `  ${b.link}`
      return b.pre
        .split('\n')
        .map((l) => (l ? `  ${l}` : ''))
        .join('\n')
    })
    .join('\n\n')
}

function blocksToHtml(blocks: Block[]): string {
  const body = blocks
    .map((b) => {
      if ('p' in b) return `<p>${escapeHtml(b.p)}</p>`
      if ('link' in b) {
        const label = escapeHtml(b.label ?? b.link)
        return `<p><a href="${escapeHtml(b.link)}">${label}</a></p>`
      }
      return `<pre style="background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto">${escapeHtml(b.pre)}</pre>`
    })
    .join('\n')
  return [
    '<!doctype html>',
    '<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#18181b;max-width:560px;margin:0 auto;padding:24px 16px">',
    body,
    '</body></html>',
  ].join('\n')
}

export function buildLifecycleEmail(input: LifecycleEmailInput): LifecycleEmailContent {
  // The Verify tab sends the test report; the console reads ?tab=, not ?action=
  // (OnboardingPage resolveTabParam), so the old link opened the wrong tab.
  const testReportUrl = `${input.adminUrl}/onboarding?tab=verify`
  const unsub = input.unsubscribeUrl ?? null
  if (needsUnsubscribeLink(input.key) && !unsub) {
    throw new Error(`buildLifecycleEmail: ${input.key} requires unsubscribeUrl`)
  }

  let subject: string
  let blocks: Block[]

  switch (input.key) {
    case 'day0_welcome':
      subject = 'Your first diagnosis is one click away'
      blocks = [
        { p: 'Hi,' },
        {
          p: 'Thanks for signing up for Mushi. The fastest way to see what it does is to send yourself a test report:',
        },
        { link: testReportUrl, label: 'Send a test report' },
        {
          p: 'It pushes a realistic bug (a login button that does nothing on iPad Safari) through the same pipeline your users’ reports take. About a minute later you get a plain-English diagnosis and a paste-ready fix.',
        },
        { p: 'To get real reports, drop the widget into your app:' },
        { pre: SNIPPET },
        { p: 'Both values are on the same setup page, under Configure & install the SDK.' },
        { p: 'Prefer to work from your editor? Connect Cursor so every diagnosis lands next to your code:' },
        { pre: CURSOR_SETUP },
        { p: 'Reply to this email if anything is unclear. A person reads it.' },
        { p: '— Kenji, Mushi Mushi' },
      ]
      break
    case 'day2_nudge':
      subject = 'No report yet? One click gets you a diagnosis'
      blocks = [
        { p: 'Hi,' },
        {
          p: 'Your Mushi project is set up but no report has come in yet. That is normal on day two; most people have not shipped the widget yet.',
        },
        { p: 'You do not have to wait. Send a test report and see a real diagnosis in about a minute:' },
        { link: testReportUrl, label: 'Send a test report' },
        {
          p: 'If something got in the way (a build error, an unclear step, a doubt about whether it fits your app), reply and tell me. I read every reply.',
        },
        { p: '— Kenji, Mushi Mushi' },
      ]
      break
    case 'day7_stalled':
      subject = 'One question about Mushi'
      blocks = [
        { p: 'Hi,' },
        {
          p: 'A week ago you created a Mushi project, and no report has come through since. No hard feelings. I would like to know why.',
        },
        { p: 'What got in the way?' },
        {
          p: 'Reply with one line. “Did not get to it”, “the install step was unclear”, “not sure it fits my app” are all useful answers. If it is something I can fix, I will.',
        },
        { p: '— Kenji, Mushi Mushi' },
      ]
      break
    case 'day7_activated':
      subject = 'Pull the fix into Cursor'
      blocks = [
        { p: 'Hi,' },
        {
          p: 'Your project has received its first report and Mushi has diagnosed it. The next step is to make the fix land where you work.',
        },
        { p: 'Connect Cursor (or Claude Code) to Mushi’s MCP server:' },
        { pre: CURSOR_SETUP },
        {
          p: 'After that, get_fix_context inside your editor pulls the diagnosis, the evidence and the suggested change for any report. No copy-paste.',
        },
        { p: 'Reply if the setup command does not work on your machine.' },
        { p: '— Kenji, Mushi Mushi' },
      ]
      break
  }

  const footer: Block[] = unsub
    ? [
        {
          p: `You get these few setup emails because you created a Mushi account${input.signedUpOn ? ` on ${input.signedUpOn}` : ''}. Unsubscribe with one click:`,
        },
        { link: unsub, label: 'Unsubscribe' },
      ]
    : [{ p: 'This is a one-time account email about your new Mushi project.' }]

  const all = [...blocks, ...footer]
  const headers: Record<string, string> = unsub
    ? {
        'List-Unsubscribe': `<${unsub}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    : {}

  return { subject, text: blocksToText(all), html: blocksToHtml(all), headers }
}
