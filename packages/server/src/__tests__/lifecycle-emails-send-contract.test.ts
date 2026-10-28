/**
 * FILE: packages/server/src/__tests__/lifecycle-emails-send-contract.test.ts
 * PURPOSE: Before lifecycle_emails_enabled is turned on (November GTM plan
 *          §6.2), pin who the hourly job may email and that it never sends
 *          one email twice. The pure rules are Deno-tested next to the
 *          templates (api/routes/lifecycle-emails.test.ts); this reads the
 *          send loop, which talks to the database and Resend.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, '../../supabase/functions/lifecycle-emails/index.ts'), 'utf8')
const email = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/email.ts'), 'utf8')

describe('lifecycle-emails send loop', () => {
  it('leaves out operators, opt-outs, synthetic test accounts and tester-only accounts', () => {
    const load = src.slice(src.indexOf('async function loadSignals'), src.indexOf('async function sendOne'))
    expect(load).toContain("from('operator_users')")
    expect(load).toContain("from('lifecycle_email_optout')")
    expect(load).toContain("from('synthetic_accounts')")
    expect(load).toContain("from('mushi_testers')")
    expect(load).toContain('isTesterOnlyAccount(')
  })

  it('claims before sending, sends with an Idempotency-Key, and releases only when the email certainly did not go out', () => {
    const send = src.slice(src.indexOf('async function sendOne'), src.indexOf('async function runLifecycleEmails'))
    expect(send.indexOf("from('lifecycle_email_sends')")).toBeLessThan(send.indexOf('sendTransactionalEmail('))
    expect(send).toContain('idempotencyKey: lifecycleIdempotencyKey(user.id, key)')
    expect(send).toMatch(/if \(shouldReleaseClaim\(result\)\) await release\(\)/)
    expect(email).toContain("'Idempotency-Key'")
  })

  it('every email gets a signed unsubscribe link, the welcome included', () => {
    const send = src.slice(src.indexOf('async function sendOne'), src.indexOf('async function runLifecycleEmails'))
    expect(send).not.toContain('needsUnsubscribeLink(key)')
    expect(send).toContain('signUnsubscribeToken(user.id, ctx.unsubSecret)')
  })

  it('the sender comes from RESEND_FROM_EMAIL', () => {
    expect(email).toContain("Deno.env.get('RESEND_FROM_EMAIL')")
  })
})
