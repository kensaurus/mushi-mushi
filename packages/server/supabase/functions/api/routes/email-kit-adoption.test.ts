/**
 * Lifecycle and usage-alert emails on the KENSAURUS email kit (yen-yen ADR
 * 0100): the layout moved, the subjects, links and unsubscribe did not.
 * Lives under api/routes so CI's Deno test step runs it (it skips _shared/).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { LIFECYCLE_EMAIL_KEYS, buildLifecycleEmail } from '../../_shared/lifecycle-emails.ts'
import { signUnsubscribeToken } from '../../_shared/lifecycle-unsubscribe.ts'
import { buildBudgetAlertEmail, buildQuotaAlertEmail } from '../../_shared/usage-alert-email.ts'
import { MAIL_SENDER, escapeMailHtml } from '../../_shared/kensaurus-spine/mail.ts'

const ADMIN = 'https://kensaur.us/mushi-mushi/admin'
const API = 'https://jghcferpoaqntpfqvayf.supabase.co/functions/v1/api'
const PHONE = /070|\+81|\+65|8459/

const SUBJECTS: Record<string, string> = {
  day0_welcome: 'Your first diagnosis is one click away',
  day2_nudge: 'No report yet? One click gets you a diagnosis',
  day7_stalled: 'One question about Mushi Mushi',
  day7_activated: 'Pull the fix into Cursor',
}

function assertFooter(name: string, mail: { html: string; text: string }) {
  for (const fact of [MAIL_SENDER.legalNameJa, MAIL_SENDER.legalNameEn, MAIL_SENDER.address, MAIL_SENDER.email]) {
    assert(mail.html.includes(escapeMailHtml(fact)), `${name} html footer: ${fact}`)
    assert(mail.text.includes(fact), `${name} text footer: ${fact}`)
  }
  assert(!PHONE.test(mail.html + mail.text), `${name} prints a phone number`)
}

Deno.test('lifecycle mail: same subjects, the signed unsubscribe URL byte for byte, footer, cross-links', async () => {
  // The URL exactly as lifecycle-emails/index.ts builds it.
  const token = await signUnsubscribeToken('5f7a4c3e-1b2d-4e6f-8a9b-0c1d2e3f4a5b', 'test-secret-with-enough-length')
  const unsub = `${API}/v1/public/email/unsubscribe?t=${encodeURIComponent(token)}`
  for (const key of LIFECYCLE_EMAIL_KEYS) {
    const mail = buildLifecycleEmail({ key, adminUrl: ADMIN, unsubscribeUrl: unsub, signedUpOn: '2026-09-14' })
    assertEquals(mail.subject, SUBJECTS[key])
    // The one-click header and the visible opt-out link are the signed URL itself.
    assertEquals(mail.headers['List-Unsubscribe'], `<${unsub}>`)
    assert(!/mailto:/i.test(JSON.stringify(mail.headers)), `${key} carries a mailto unsubscribe`)
    assertEquals(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
    assert(mail.html.includes(`href="${escapeMailHtml(unsub)}"`), `${key} opt-out href`)
    assert(mail.text.includes(`Unsubscribe: ${unsub}`), `${key} text opt-out`)
    assert(mail.html.includes('More from KENSAURUS'), `${key} cross-link row`)
    assert(mail.html.includes('https://kensaur.us/go/?a=glot-it&amp;ref=mushi-mushi'), `${key} go-link`)
    assertFooter(key, mail)
    assert(new TextEncoder().encode(mail.html).length < 60_000)
  }
  // Install snippets render as the kit's monospace block.
  const day0 = buildLifecycleEmail({ key: 'day0_welcome', adminUrl: ADMIN, unsubscribeUrl: unsub })
  assert(/<pre[^>]*>npx mushi-mushi setup --ide cursor<\/pre>/.test(day0.html), 'snippet is a <pre>')
})

Deno.test('usage alerts: same subjects, the billing link, footer', () => {
  const base = {
    consoleUrl: ADMIN,
    projectName: 'Acme',
    diagnosesUsed: 400,
    diagnosesLimit: 500,
    pct: 80,
    planName: 'Builder',
    spendCapUsd: null,
    projectId: 'p_123',
  }
  const cases: Array<[50 | 80 | 100, string]> = [
    [50, 'Early heads-up: Acme is at 50% of monthly diagnoses'],
    [80, 'Heads up: Acme is at 80% of monthly diagnoses'],
    [100, '⚠️ Diagnosis quota reached — Acme'],
  ]
  for (const [alertTier, subject] of cases) {
    const mail = buildQuotaAlertEmail({ ...base, alertTier })
    assertEquals(mail.subject, subject)
    assert(mail.html.includes(`href="${ADMIN}/billing?project=p_123&amp;utm_source=email&amp;utm_medium=transactional`))
    assert(mail.text.includes(`${ADMIN}/billing?project=p_123`))
    assert(!mail.html.includes('Unsubscribe'), 'an account notice has no opt-out')
    assertFooter(`tier ${alertTier}`, mail)
  }
  // Self-hosted consoles keep their own host, untagged.
  const own = buildQuotaAlertEmail({ ...base, alertTier: 80, consoleUrl: 'https://bugs.example.com/admin' })
  assert(own.html.includes('href="https://bugs.example.com/admin/billing?project=p_123"'))
})

Deno.test('budget alert: one paragraph per blank line, escaped, with the footer', () => {
  const mail = buildBudgetAlertEmail('AI budget 80% — Acme', 'Acme has used $40 of $50.\n\n<b>Raise it</b> in Settings.')
  assertEquals(mail.subject, 'AI budget 80% — Acme')
  assert(mail.html.includes('&lt;b&gt;Raise it&lt;/b&gt;'))
  assert(!mail.html.includes('<b>Raise'))
  assertFooter('budget', mail)
})
