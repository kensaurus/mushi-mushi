/**
 * FILE: apps/admin/src/lib/rememberedLogin.test.ts
 * PURPOSE: Guard the login screen's remembered-email UX. Only email is stored;
 *          credentials remain with Supabase Auth/browser password managers.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  REMEMBERED_LOGIN_EMAIL_KEY,
  forgetRememberedLoginEmail,
  normalizeLoginEmail,
  readRememberedLoginEmail,
  rememberLoginEmail,
} from './rememberedLogin'

describe('remembered login email', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('normalizes email before storing', () => {
    expect(rememberLoginEmail('  Kenji@Example.COM ')).toBe('kenji@example.com')
    expect(window.localStorage.getItem(REMEMBERED_LOGIN_EMAIL_KEY)).toBe('kenji@example.com')
    expect(readRememberedLoginEmail()).toBe('kenji@example.com')
  })

  it('does not store an empty email', () => {
    expect(rememberLoginEmail('   ')).toBeNull()
    expect(readRememberedLoginEmail()).toBeNull()
  })

  it('forgets the remembered email', () => {
    rememberLoginEmail('kenji@example.com')
    forgetRememberedLoginEmail()
    expect(readRememberedLoginEmail()).toBeNull()
  })

  it('exposes pure normalization for form use', () => {
    expect(normalizeLoginEmail(' USER@Example.com ')).toBe('user@example.com')
  })
})
