/**
 * FILE: apps/admin/src/lib/loginSubmit.test.ts
 * PURPOSE: The login form does what the selected tab says on both tracks
 *          (QA #13: the tester track sent an email link for every submit).
 */

import { describe, expect, it } from 'vitest'
import { NO_ACCOUNT_FOR_EMAIL_LINK, classifyAuthError, loginActionFor } from './loginSubmit'

describe('loginActionFor', () => {
  it('honours the Password tab on the tester track', () => {
    expect(loginActionFor('login', 'tester')).toBe('password')
  })

  it('creates a tester account from the sign-up form', () => {
    expect(loginActionFor('signup', 'tester')).toBe('tester-signup')
  })

  it('uses the tester email link, which may create the account, on the tester track', () => {
    expect(loginActionFor('magic', 'tester')).toBe('tester-email-link')
  })

  it('keeps the console email link (existing accounts only) on the console track', () => {
    expect(loginActionFor('magic', 'console')).toBe('email-link')
    expect(loginActionFor('signup', 'console')).toBe('signup')
    expect(loginActionFor('login', 'console')).toBe('password')
  })

  it('sends a reset email from the forgot form on either track', () => {
    expect(loginActionFor('forgot', 'console')).toBe('reset')
    expect(loginActionFor('forgot', 'tester')).toBe('reset')
  })
})

describe('classifyAuthError', () => {
  it('explains the email-link refusal for an unknown email, with the fix', () => {
    // LoginPage shows a "Create an account" button beside this exact text.
    expect(classifyAuthError('Signups not allowed for otp', { cloud: true })).toBe(NO_ACCOUNT_FOR_EMAIL_LINK)
  })

  it('keeps the existing mappings', () => {
    expect(classifyAuthError('Invalid login credentials', { cloud: true })).toMatch(/Invalid email or password/)
    expect(classifyAuthError('User already registered', { cloud: true })).toMatch(/already exists/)
  })
})
