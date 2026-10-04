/**
 * FILE: apps/admin/src/lib/loginSubmit.ts
 * PURPOSE: What the login form's submit button does for each tab and track,
 *          and the plain-English wording of Supabase Auth errors.
 *
 * The tester track (`/login?as=tester`, where the marketplace "Join to test"
 * link and TesterRoute send people) used to short-circuit every submit to the
 * console email link: the Password tab and the Create-account form silently
 * sent an email instead, and the console link refuses unknown emails, so a new
 * tester could not create an account at all.
 */

export type LoginFormMode = 'login' | 'magic' | 'signup' | 'forgot'
/** Which portal flow led the user to this login page. */
export type LoginTrack = 'tester' | 'console'

export type LoginAction =
  /** Send a password-reset email. */
  | 'reset'
  /** Console email link (existing accounts only). */
  | 'email-link'
  /** Tester email link (may create the account, provisions a tester profile). */
  | 'tester-email-link'
  /** Email + password account creation. */
  | 'signup'
  /** Email + password account creation that also provisions a tester profile. */
  | 'tester-signup'
  /** Email + password sign-in (both tracks). */
  | 'password'

export function loginActionFor(mode: LoginFormMode, track: LoginTrack): LoginAction {
  switch (mode) {
    case 'forgot':
      return 'reset'
    case 'magic':
      return track === 'tester' ? 'tester-email-link' : 'email-link'
    case 'signup':
      return track === 'tester' ? 'tester-signup' : 'signup'
    case 'login':
      return 'password'
  }
}

/** Supabase Auth error text → a sentence that says what to do next. */
export function classifyAuthError(raw: string, opts: { cloud: boolean }): string {
  const lower = raw.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid_credentials'))
    return 'Invalid email or password. Check your credentials and try again.'
  if (lower.includes('email not confirmed'))
    return 'Please confirm your email address first. Check your inbox for a verification link.'
  if (lower.includes('signups not allowed for otp') || lower.includes('otp_disabled'))
    return 'No account uses this email yet. Choose "Create account" to sign up with a password, or check the address for typos.'
  if (lower.includes('signups not allowed') || lower.includes('signup_disabled'))
    return 'New sign-ups are turned off on this server. Ask the workspace owner to invite you.'
  if (lower.includes('rate limit') || lower.includes('too many'))
    return 'Too many attempts. Wait a moment and try again.'
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed'))
    return opts.cloud
      ? 'Cannot reach the server. Please check your network connection and try again.'
      : 'Cannot reach the Supabase server. Check your .env configuration and network connection.'
  if (lower.includes('user already registered'))
    return 'An account with this email already exists. Try signing in instead.'
  return raw
}
