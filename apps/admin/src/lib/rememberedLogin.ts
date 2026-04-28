/**
 * FILE: apps/admin/src/lib/rememberedLogin.ts
 * PURPOSE: Local, opt-in remembered-email helpers for the login screen.
 *
 * We intentionally remember only the email address. Passwords and tokens stay
 * with Supabase Auth's session storage / browser password managers.
 */

export const REMEMBERED_LOGIN_EMAIL_KEY = 'mushi:login:last_email'

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function readRememberedLoginEmail(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(REMEMBERED_LOGIN_EMAIL_KEY)
    return value ? normalizeLoginEmail(value) : null
  } catch {
    return null
  }
}

export function rememberLoginEmail(email: string): string | null {
  const normalized = normalizeLoginEmail(email)
  if (!normalized) return null
  if (typeof window === 'undefined') return normalized
  try {
    window.localStorage.setItem(REMEMBERED_LOGIN_EMAIL_KEY, normalized)
  } catch {
    // Private browsing can reject localStorage; the sign-in should still work.
  }
  return normalized
}

export function forgetRememberedLoginEmail(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(REMEMBERED_LOGIN_EMAIL_KEY)
  } catch {
    // Best-effort only.
  }
}
