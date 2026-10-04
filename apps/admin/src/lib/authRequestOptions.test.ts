/**
 * FILE: apps/admin/src/lib/authRequestOptions.test.ts
 * PURPOSE: Pin what the console asks Supabase Auth to do for email links and
 *          sign-ups (QA #13 tester sign-up, #69 email link dropping `next=`).
 */

import { describe, expect, it } from 'vitest'
import { emailLinkOptions, passwordSignUpOptions } from './authRequestOptions'

const origin = window.location.origin

describe('emailLinkOptions', () => {
  it('never lets a console email link create an account', () => {
    expect(emailLinkOptions({}).shouldCreateUser).toBe(false)
    expect(emailLinkOptions({ next: '/invite/accept?token=abc' }).shouldCreateUser).toBe(false)
    expect(emailLinkOptions({}).data).toBeUndefined()
  })

  it('returns a console email link to the page the user asked for', () => {
    expect(emailLinkOptions({ next: '/invite/accept?token=abc' }).emailRedirectTo).toBe(
      `${origin}/invite/accept?token=abc`,
    )
    expect(emailLinkOptions({}).emailRedirectTo).toBe(`${origin}/dashboard`)
  })

  it('falls back to the dashboard for an off-site next', () => {
    expect(emailLinkOptions({ next: '//evil.example/steal' }).emailRedirectTo).toBe(
      `${origin}/dashboard`,
    )
    expect(emailLinkOptions({ next: 'https://evil.example' }).emailRedirectTo).toBe(
      `${origin}/dashboard`,
    )
  })

  it('lets a tester email link create the account and provision a tester profile', () => {
    const opts = emailLinkOptions({ intent: 'tester' })
    expect(opts).toEqual({
      emailRedirectTo: `${origin}/tester`,
      shouldCreateUser: true,
      data: { signup_intent: 'tester' },
    })
  })

  it('returns a tester to the tester page that sent them to sign in', () => {
    expect(emailLinkOptions({ intent: 'tester', next: '/tester/wallet' }).emailRedirectTo).toBe(
      `${origin}/tester/wallet`,
    )
  })
})

describe('passwordSignUpOptions', () => {
  it('sends a new console user to the onboarding wizard by default', () => {
    expect(passwordSignUpOptions(undefined)).toEqual({ emailRedirectTo: `${origin}/onboarding` })
  })

  it('keeps attribution metadata and drops empty keys', () => {
    const opts = passwordSignUpOptions({ signup_source: 'friend', signup_src: '' })
    expect(opts.data).toEqual({ signup_source: 'friend' })
  })

  it('stamps signup_intent for a tester so the DB trigger provisions the tester rows', () => {
    const opts = passwordSignUpOptions({ signup_track: 'tester' }, { intent: 'tester' })
    expect(opts.data).toEqual({ signup_track: 'tester', signup_intent: 'tester' })
    expect(opts.emailRedirectTo).toBe(`${origin}/tester`)
  })

  it('returns the confirmation link to an explicit next (an invite)', () => {
    expect(passwordSignUpOptions(undefined, { next: '/invite/accept?token=t' }).emailRedirectTo).toBe(
      `${origin}/invite/accept?token=t`,
    )
  })
})
