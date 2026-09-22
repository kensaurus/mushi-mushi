import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  LIFECYCLE_EMAIL_KEYS,
  buildLifecycleEmail,
  decideLifecycleEmail,
  needsUnsubscribeLink,
} from '../../_shared/lifecycle-emails.ts'
import {
  signUnsubscribeToken,
  timingSafeEqualString,
  verifyUnsubscribeToken,
} from '../../_shared/lifecycle-unsubscribe.ts'

const HOUR = 60 * 60 * 1000
const confirmedAt = new Date('2026-09-14T09:00:00Z')
const at = (hours: number) => new Date(confirmedAt.getTime() + hours * HOUR)
const none = new Set<string>()

function decide(hours: number, overrides: Partial<Parameters<typeof decideLifecycleEmail>[0]> = {}) {
  return decideLifecycleEmail({
    confirmedAt,
    now: at(hours),
    realReports: 0,
    mcpSetupDone: false,
    sent: none,
    ...overrides,
  })
}

Deno.test('day0_welcome fires within 2 h of confirmation and never twice', () => {
  assertEquals(decide(0.5), 'day0_welcome')
  assertEquals(decide(2), 'day0_welcome')
  assertEquals(decide(2.5), null)
  assertEquals(decide(0.5, { sent: new Set(['day0_welcome']) }), null)
  assertEquals(decide(-1), null)
})

Deno.test('day2_nudge fires 44–72 h with no real report and exits on a report', () => {
  assertEquals(decide(43), null)
  assertEquals(decide(44), 'day2_nudge')
  assertEquals(decide(71.9), 'day2_nudge')
  assertEquals(decide(72), null)
  assertEquals(decide(50, { realReports: 1 }), null)
  assertEquals(decide(50, { sent: new Set(['day2_nudge']) }), null)
})

Deno.test('day 7 splits into stalled vs activated and exits on mcp_setup_done', () => {
  assertEquals(decide(167), null)
  assertEquals(decide(168), 'day7_stalled')
  assertEquals(decide(191.9, { realReports: 0 }), 'day7_stalled')
  assertEquals(decide(192), null)
  assertEquals(decide(170, { realReports: 3 }), 'day7_activated')
  assertEquals(decide(170, { realReports: 3, mcpSetupDone: true }), null)
  assertEquals(decide(170, { realReports: 3, sent: new Set(['day7_activated']) }), null)
  assertEquals(decide(170, { sent: new Set(['day7_stalled']) }), null)
})

Deno.test('day0 is the only email without an unsubscribe link', () => {
  assertEquals(needsUnsubscribeLink('day0_welcome'), false)
  for (const key of LIFECYCLE_EMAIL_KEYS.filter((k) => k !== 'day0_welcome')) {
    assertEquals(needsUnsubscribeLink(key), true)
  }
  assertThrows(() => buildLifecycleEmail({ key: 'day2_nudge', adminUrl: 'https://x.test/admin' }))
})

Deno.test('templates carry the deep links, plain text + html, and List-Unsubscribe headers', () => {
  const admin = 'https://kensaur.us/mushi-mushi/admin'
  const unsub = 'https://api.test/v1/public/email/unsubscribe?t=abc'

  const day0 = buildLifecycleEmail({ key: 'day0_welcome', adminUrl: admin })
  assert(day0.text.includes(`${admin}/onboarding?action=test-report`))
  assert(day0.text.includes('npx mushi-mushi setup --ide cursor'))
  assert(day0.text.includes("import { Mushi } from '@mushi-mushi/web'"))
  assert(day0.html.includes('href="https://kensaur.us/mushi-mushi/admin/onboarding?action=test-report"'))
  assertEquals(day0.headers, {})
  // Sober subject lines: no mascot, no emoji.
  assert(!/mushi-chan|🐛/i.test(day0.subject))

  for (const key of ['day2_nudge', 'day7_stalled', 'day7_activated'] as const) {
    const email = buildLifecycleEmail({ key, adminUrl: admin, unsubscribeUrl: unsub, signedUpOn: '2026-09-14' })
    assertEquals(email.headers['List-Unsubscribe'], `<${unsub}>`)
    assertEquals(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
    assert(email.text.includes(unsub))
    assert(email.html.includes('<a href="https://api.test/v1/public/email/unsubscribe?t=abc">'))
    assert(email.text.includes('2026-09-14'))
    assert(!/🐛|✨|🚀/.test(email.subject))
    // No tracking pixels.
    assert(!/<img/i.test(email.html))
  }
  assert(buildLifecycleEmail({ key: 'day7_activated', adminUrl: admin, unsubscribeUrl: unsub }).text.includes('npx mushi-mushi setup --ide cursor'))
})

Deno.test('unsubscribe tokens round-trip and reject tampering', async () => {
  const secret = 'test-secret-with-enough-length'
  const userId = '5f7a4c3e-1b2d-4e6f-8a9b-0c1d2e3f4a5b'
  const token = await signUnsubscribeToken(userId, secret)
  assert(token.startsWith(`${userId}.`))
  assertEquals(await verifyUnsubscribeToken(token, secret), userId)
  assertEquals(await verifyUnsubscribeToken(token.toUpperCase(), secret), userId)
  assertEquals(await verifyUnsubscribeToken(token, 'another-secret-with-enough-len'), null)
  assertEquals(await verifyUnsubscribeToken(`${token.slice(0, -1)}0`, secret), token.endsWith('0') ? userId : null)
  assertEquals(await verifyUnsubscribeToken('not-a-token', secret), null)
  assertEquals(await verifyUnsubscribeToken(undefined, secret), null)
  assertEquals(await verifyUnsubscribeToken(`${userId}.deadbeef`, secret), null)
  await assertThrowsAsync(() => signUnsubscribeToken('nope', secret))
})

Deno.test('timingSafeEqualString compares full strings', () => {
  assertEquals(timingSafeEqualString('abc', 'abc'), true)
  assertEquals(timingSafeEqualString('abc', 'abd'), false)
  assertEquals(timingSafeEqualString('abc', 'ab'), false)
})

async function assertThrowsAsync(fn: () => Promise<unknown>) {
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  }
  assert(threw, 'expected rejection')
}
