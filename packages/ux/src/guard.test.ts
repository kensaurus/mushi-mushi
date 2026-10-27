// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { isCaptchaUrl, isDestructiveLabel, isFreshEyesRefusedLabel, isRequestAllowed, requestRefusal } from './guard.js'

describe('isRequestAllowed', () => {
  it('lets reads through and blocks writes by default', () => {
    expect(isRequestAllowed('GET', 'http://localhost:3000/api/items', [])).toBe(true)
    expect(isRequestAllowed('OPTIONS', 'http://localhost:3000/api/items', [])).toBe(true)
    expect(isRequestAllowed('POST', 'http://localhost:3000/api/items', [])).toBe(false)
    expect(isRequestAllowed('DELETE', 'http://localhost:3000/api/items/1', [])).toBe(false)
    expect(isRequestAllowed('PATCH', 'http://localhost:3000/api/items/1', [])).toBe(false)
  })

  it('honours method-scoped and any-method allow rules', () => {
    const allow = ['POST /rest/v1/rpc/*', '/graphql']
    expect(isRequestAllowed('POST', 'https://x.supabase.co/rest/v1/rpc/get_stats', allow)).toBe(true)
    expect(isRequestAllowed('DELETE', 'https://x.supabase.co/rest/v1/rpc/get_stats', allow)).toBe(false)
    expect(isRequestAllowed('POST', 'http://localhost/graphql', allow)).toBe(true)
    expect(isRequestAllowed('POST', 'http://localhost/graphql/mutate', allow)).toBe(false)
  })

  it('blocks a write it cannot parse', () => {
    expect(isRequestAllowed('POST', 'not a url', ['*'])).toBe(false)
  })
})

describe('isRequestAllowed with writes: same-origin (fresh-eyes, ADR 0051)', () => {
  const policy = { writes: 'same-origin' as const, appOrigins: ['https://app.test', 'https://abc.supabase.co'] }

  it('lets writes reach the app origins only', () => {
    expect(isRequestAllowed('POST', 'https://app.test/api/projects', [], policy)).toBe(true)
    expect(isRequestAllowed('POST', 'https://abc.supabase.co/auth/v1/token?grant_type=password', [], policy)).toBe(true)
    expect(isRequestAllowed('PATCH', 'https://abc.supabase.co/rest/v1/projects?id=eq.1', [], policy)).toBe(true)
  })

  it('still blocks cross-origin writes, a look-alike host, another port and another scheme', () => {
    expect(isRequestAllowed('POST', 'https://evil.test/collect', [], policy)).toBe(false)
    expect(isRequestAllowed('POST', 'https://app.test.evil.test/api', [], policy)).toBe(false)
    expect(isRequestAllowed('POST', 'https://app.test:8443/api', [], policy)).toBe(false)
    expect(isRequestAllowed('POST', 'http://app.test/api', [], policy)).toBe(false)
    expect(isRequestAllowed('POST', 'https://other.supabase.co/rest/v1/x', [], policy)).toBe(false)
  })

  it('never calls the public sign-up, OTP, magic-link or recovery endpoints, even on the app origin', () => {
    for (const path of ['/auth/v1/signup', '/auth/v1/otp', '/auth/v1/recover', '/auth/v1/magiclink', '/auth/v1/resend']) {
      expect(isRequestAllowed('POST', `https://abc.supabase.co${path}`, [], policy)).toBe(false)
      expect(isRequestAllowed('POST', `https://abc.supabase.co${path}`, ['*'], policy)).toBe(false)
    }
  })

  it('blocks payment hosts for writes and navigations, in every mode and despite the allowlist', () => {
    for (const p of [policy, {}]) {
      expect(isRequestAllowed('POST', 'https://api.stripe.com/v1/payment_intents', ['*'], p)).toBe(false)
      expect(isRequestAllowed('GET', 'https://checkout.stripe.com/c/pay/cs_test', [], p, true)).toBe(false)
      expect(isRequestAllowed('GET', 'https://www.paypal.com/checkoutnow', [], p, true)).toBe(false)
    }
    // Stripe.js on a billing page is a script, not a payment.
    expect(isRequestAllowed('GET', 'https://js.stripe.com/v3/', [], policy, false)).toBe(true)
  })

  it('blocks third-party sign-in, by host, by URL and when started through the app', () => {
    expect(isRequestAllowed('GET', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1', [], policy, true)).toBe(false)
    expect(isRequestAllowed('GET', 'https://github.com/login/oauth/authorize?client_id=1', [], policy, true)).toBe(false)
    expect(isRequestAllowed('GET', 'https://appleid.apple.com/auth/authorize', [], policy, true)).toBe(false)
    expect(isRequestAllowed('GET', 'https://abc.supabase.co/auth/v1/authorize?provider=github&redirect_to=x', [], policy, true)).toBe(false)
    expect(isRequestAllowed('GET', 'https://abc.supabase.co/auth/v1/authorize?provider=google', [], policy, false)).toBe(false)
    // Reading a GitHub repo page is not signing in.
    expect(isRequestAllowed('GET', 'https://github.com/kensaurus/mushi-mushi', [], policy, true)).toBe(true)
  })
})

describe('requestRefusal and isCaptchaUrl', () => {
  it('names why', () => {
    expect(requestRefusal('POST', 'https://api.stripe.com/v1/charges', false)).toMatch(/^payment/)
    expect(requestRefusal('GET', 'https://accounts.google.com/signin', true)).toMatch(/third-party sign-in/)
    expect(requestRefusal('POST', 'https://x.supabase.co/auth/v1/signup', false)).toMatch(/public account endpoint/)
    expect(requestRefusal('POST', 'https://x.supabase.co/auth/v1/token?grant_type=password', false)).toBeNull()
    expect(requestRefusal('POST', 'not a url', false)).toBeNull()
  })

  it('recognises captcha providers', () => {
    expect(isCaptchaUrl('https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html')).toBe(true)
    expect(isCaptchaUrl('https://www.google.com/recaptcha/api2/anchor?k=1')).toBe(true)
    expect(isCaptchaUrl('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(true)
    expect(isCaptchaUrl('https://www.google.com/search?q=recaptcha')).toBe(false)
  })
})

describe('isDestructiveLabel', () => {
  it.each(['Delete account', 'Remove repo', 'Log out', 'Sign out', 'Pay now', 'Send invite', 'Merge PR', 'Submit'])(
    'refuses %s',
    (label) => expect(isDestructiveLabel(label)).toBe(true),
  )
  it.each(['Details', 'Invite people', 'Settings', 'Open menu', 'Overview'])('allows %s', (label) =>
    expect(isDestructiveLabel(label)).toBe(false),
  )
})

describe('isFreshEyesRefusedLabel', () => {
  it.each(['Delete project', 'Revoke key', 'Upgrade to Pro', 'Checkout', 'Sign out', 'Continue with GitHub', 'Sign in with Google', 'Log in with Apple', 'Subscribe', 'Invite teammate', 'Send invite'])(
    'refuses %s',
    (label) => expect(isFreshEyesRefusedLabel(label)).toBe(true),
  )
  it.each(['Sign up', 'Create account', 'Submit', 'Send report', 'Get started', 'Sign in', 'Create app', 'Copy key'])('allows %s', (label) =>
    expect(isFreshEyesRefusedLabel(label)).toBe(false),
  )
})
