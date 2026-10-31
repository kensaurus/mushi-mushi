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

/** Shown when a console email link is asked for an email with no account.
 *  The login form renders a "Create an account" button beside it. */
export const NO_ACCOUNT_FOR_EMAIL_LINK =
  'No account uses this email yet. Create one with a password, or check the address for typos.'

/** Supabase Auth error text → a sentence that says what to do next. */
/**
 * A browser accepts `name@gmail` as an email; the mail server does not, and
 * Supabase then answers 500 with an empty body after creating the user. Ask
 * for a dot in the domain and no spaces before sending anything.
 */
export function emailFormatProblem(raw: string): string | null {
  const email = raw.trim()
  if (!email) return null
  if (/\s/.test(email)) return 'Remove the spaces from the email address.'
  const at = email.lastIndexOf('@')
  if (at < 1) return 'Enter the whole email address, like name@example.com.'
  const domain = email.slice(at + 1)
  if (!/^[^.@]+(\.[^.@]+)+$/.test(domain) || /\.$/.test(domain)) {
    return `Check the part after @: "${domain || '…'}" is not a full domain (like gmail.com).`
  }
  return null
}

/** @internal Exported for tests only. */
export const CONFIRMATION_EMAIL_FAILED =
  'We could not send the confirmation email to that address. Check it is spelled right (name@example.com) and try again.'

export function classifyAuthError(raw: string, opts: { cloud: boolean }): string {
  const lower = raw.toLowerCase()
  const blank = !raw.trim() || raw.trim() === '{}'
  if (lower.includes('error sending confirmation') || lower.includes('invalid recipient') || lower.includes('unable to validate email'))
    return CONFIRMATION_EMAIL_FAILED
  if (lower.includes('invalid login') || lower.includes('invalid_credentials'))
    return 'Invalid email or password. Check your credentials and try again.'
  if (lower.includes('email not confirmed'))
    return 'Please confirm your email address first. Check your inbox for a verification link.'
  if (lower.includes('signups not allowed for otp') || lower.includes('otp_disabled'))
    return NO_ACCOUNT_FOR_EMAIL_LINK
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
  if (lower.includes('password should be at least') || lower.includes('weak_password'))
    return 'Use a password of at least 6 characters.'
  // An empty answer (`{}`) is a server-side failure with no message. Never
  // show the raw text; say what happened and what to do.
  if (blank || lower.includes('unexpected_failure') || lower.includes('internal server error'))
    return 'Something went wrong on our side and nothing was saved. Try again in a minute.'
  return raw
}
