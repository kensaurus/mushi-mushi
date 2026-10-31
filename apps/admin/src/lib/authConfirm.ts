/**
 * FILE: apps/admin/src/lib/authConfirm.ts
 * PURPOSE: Where the email-confirmation link (/auth/confirm) sends a person.
 *
 * The confirmation email links to the console's own domain with a token hash
 * (supabase templates/confirmation.html) instead of a raw *.supabase.co
 * address. `redirect_to` is the sign-up's return address; only a path inside
 * this console is honoured, and a generic landing becomes setup.
 */

import { sanitizeNextPath } from './authRedirect'
import { signupLandingPath } from './firstRun'

export type ConfirmOtpType = 'email' | 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change'

const OTP_TYPES = new Set<ConfirmOtpType>(['email', 'signup', 'invite', 'magiclink', 'recovery', 'email_change'])

export function readConfirmParams(search: string): { tokenHash: string | null; type: ConfirmOtpType; redirectTo: string | null } {
  // redirect_to is last in the link and may carry its own query, so take
  // everything after it instead of letting `&` split it.
  const raw = search.startsWith('?') ? search.slice(1) : search
  const at = raw.indexOf('redirect_to=')
  const redirectTo = at >= 0 ? decodeURIComponent(raw.slice(at + 'redirect_to='.length)) : null
  const params = new URLSearchParams(at >= 0 ? raw.slice(0, at) : raw)
  const type = params.get('type') as ConfirmOtpType | null
  return {
    tokenHash: params.get('token_hash'),
    type: type && OTP_TYPES.has(type) ? type : 'email',
    redirectTo: redirectTo || null,
  }
}

/** A console path from the return address, or setup. Never another site. */
export function confirmLandingPath(redirectTo: string | null, origin: string, basePath: string): string {
  if (!redirectTo) return '/onboarding'
  let path = redirectTo
  try {
    const u = new URL(redirectTo, origin)
    if (u.origin !== origin) return '/onboarding'
    path = `${u.pathname}${u.search}${u.hash}`
  } catch {
    return '/onboarding'
  }
  const base = `/${basePath.replace(/^\/+|\/+$/g, '')}`
  if (base !== '/' && path.startsWith(base)) path = path.slice(base.length) || '/'
  return signupLandingPath(sanitizeNextPath(path))
}

/** Plain words for what went wrong with the link. */
export function confirmErrorMessage(raw: string | null | undefined): string {
  const lower = (raw ?? '').toLowerCase()
  if (lower.includes('expired') || lower.includes('invalid') || lower.includes('not found') || lower.includes('otp')) {
    return 'This confirmation link has expired or was already used. Sign in if you already confirmed, or send yourself a new link.'
  }
  if (lower.includes('fetch') || lower.includes('network')) {
    return 'Could not reach Mushi Mushi to confirm your email. Check your connection and open the link again.'
  }
  return 'Your email could not be confirmed with this link. Sign in if you already confirmed, or send yourself a new link.'
}
