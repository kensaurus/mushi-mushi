/**
 * FILE: apps/admin/src/lib/authRequestOptions.ts
 * PURPOSE: The options the console sends to Supabase Auth for email links and
 *          email/password sign-up, built in one place so the rules are tested.
 *
 * Rules:
 *   - Console email links never create an account (`shouldCreateUser: false`).
 *     A new console user signs up with a password or OAuth.
 *   - The tester track may create an account from an email link, and stamps
 *     `signup_intent: 'tester'` so the `handle_new_tester_user` trigger
 *     (AFTER INSERT on auth.users) provisions the tester rows. That trigger
 *     runs only for a newly created user, so an existing account gets no new
 *     tester rows from this path; it enrols from the tester portal instead.
 *   - Every link returns to the page the user was trying to reach (`next`),
 *     sanitised by `authRedirectUrl`, instead of always `/dashboard`.
 */

import { authRedirectUrl } from './authRedirect'
import { compactSignupMeta, type SignupMeta } from './signupAttribution'

export type SignupIntent = 'tester'

/** Where a tester lands when no deep link says otherwise. */
const TESTER_LANDING_PATH = '/tester'

/** Post-signup lands on the wizard so the first action is "send a test
 *  report", not a dashboard of zeros (docs/plan-gtm.md, Workstream B §2a). */
const SIGNUP_LANDING_PATH = '/onboarding'

export interface EmailLinkOptions {
  emailRedirectTo: string
  shouldCreateUser: boolean
  data?: { signup_intent: SignupIntent }
}

/** Options for `supabase.auth.signInWithOtp` (the "Email link" tab). */
export function emailLinkOptions(opts: { next?: string; intent?: SignupIntent }): EmailLinkOptions {
  if (opts.intent === 'tester') {
    return {
      emailRedirectTo: authRedirectUrl(opts.next ?? TESTER_LANDING_PATH),
      shouldCreateUser: true,
      data: { signup_intent: 'tester' },
    }
  }
  return {
    emailRedirectTo: authRedirectUrl(opts.next ?? '/dashboard'),
    shouldCreateUser: false,
  }
}

export interface PasswordSignUpOptions {
  emailRedirectTo: string
  data?: SignupMeta & { signup_intent?: SignupIntent }
}

/** Options for `supabase.auth.signUp` (the "Create account" form). */
export function passwordSignUpOptions(
  signupMeta: SignupMeta | undefined,
  opts: { next?: string; intent?: SignupIntent } = {},
): PasswordSignUpOptions {
  const meta = signupMeta ? compactSignupMeta(signupMeta) : {}
  // Added after compactSignupMeta, which keeps attribution keys only.
  const data = opts.intent ? { ...meta, signup_intent: opts.intent } : meta
  const landing = opts.intent === 'tester' ? TESTER_LANDING_PATH : SIGNUP_LANDING_PATH
  return {
    // The confirmation link drops the new user where they were heading.
    emailRedirectTo: authRedirectUrl(opts.next ?? landing),
    // Persisted to auth.users.raw_user_meta_data → growth funnel by source.
    ...(Object.keys(data).length > 0 ? { data } : {}),
  }
}
