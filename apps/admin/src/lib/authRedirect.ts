/**
 * FILE: apps/admin/src/lib/authRedirect.ts
 * PURPOSE: Safe auth redirect helpers for basename-aware SPA routing.
 */

const FALLBACK_PATH = '/dashboard'
const AUTH_PATHS = new Set(['/login', '/reset-password'])

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') return '/'
  return `/${basePath.replace(/^\/+|\/+$/g, '')}/`
}

function normalizeRelativePath(path: string): string {
  if (!path.startsWith('/')) return FALLBACK_PATH
  if (path.startsWith('//')) return FALLBACK_PATH
  if (/[\u0000-\u001f\u007f]/.test(path)) return FALLBACK_PATH
  return path
}

export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return FALLBACK_PATH
  const normalized = normalizeRelativePath(next)
  const pathname = normalized.split(/[?#]/, 1)[0] || FALLBACK_PATH
  if (AUTH_PATHS.has(pathname)) return FALLBACK_PATH
  return normalized
}

export function pathFromLocationLike(location: {
  pathname?: string
  search?: string
  hash?: string
}): string {
  return sanitizeNextPath(
    `${location.pathname ?? FALLBACK_PATH}${location.search ?? ''}${location.hash ?? ''}`,
  )
}

export function nextPathFromLoginState(
  state: unknown,
  queryNext: string | null | undefined,
  fallbackPath: string = FALLBACK_PATH,
): string {
  const from = (state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from
  if (from) return pathFromLocationLike(from)
  if (queryNext) return sanitizeNextPath(queryNext)
  return fallbackPath
}

export function loginPathForLocation(location: {
  pathname?: string
  search?: string
  hash?: string
}): string {
  const next = pathFromLocationLike(location)
  return next === FALLBACK_PATH ? '/login' : `/login?next=${encodeURIComponent(next)}`
}

export function authRedirectUrl(path: string, opts?: { origin?: string; basePath?: string }): string {
  const origin = opts?.origin ?? window.location.origin
  const basePath = normalizeBasePath(opts?.basePath ?? import.meta.env.BASE_URL)
  const relative = normalizeRelativePath(path).replace(/^\/+/, '')
  return `${origin}${basePath}${relative}`
}

/**
 * Detects whether the current browser URL is a Supabase password-recovery
 * landing — i.e. the user just clicked the email link and Supabase has
 * redirected back to us with a recovery payload.
 *
 * Two flow shapes are supported and BOTH must keep the form mounted:
 *
 *   1. Legacy implicit flow (default for `/auth/v1/verify?type=recovery`):
 *        #access_token=...&refresh_token=...&type=recovery&...
 *      supabase-js with `detectSessionInUrl: true` parses this hash, sets
 *      the session, fires PASSWORD_RECOVERY, and then strips the hash from
 *      the URL via history.replaceState. We must capture this BEFORE the
 *      hash gets stripped so a late mount doesn't lose the signal.
 *
 *   2. PKCE flow (newer, used when the email template uses the raw
 *      `{{ .ConfirmationURL }}` token_hash syntax, or when the project
 *      enforces PKCE):
 *        ?token_hash=pkce_...&type=recovery   (or ?code=...&type=recovery)
 *      supabase-js processes this from query string and similarly strips it.
 *
 * Either signal is sufficient evidence that the visitor came from a
 * password-recovery email and should be allowed to set a new password,
 * EVEN IF the React tree mounted after supabase-js already cleared the URL
 * (the bug we shipped previously: ResetPasswordPage saw `isPasswordRecovery
 * = false` on first render and bounced the user to /login, destroying the
 * hash on the way out — see git blame for the full incident).
 *
 * Important: This must be called from a `useState` initializer so the
 * detection happens on the very first render of the component, before
 * any side effect has had a chance to mutate `window.location`.
 */
export function detectRecoveryFromUrl(): boolean {
  if (typeof window === 'undefined') return false
  const { hash, search } = window.location
  // Hash params (implicit flow): "#access_token=...&type=recovery&..."
  if (hash && /(?:^|[#&])type=recovery(?:&|$)/.test(hash)) return true
  // Query params (PKCE flow or new exchange-code flow).
  if (search && /(?:^|[?&])type=recovery(?:&|$)/.test(search)) return true
  return false
}
