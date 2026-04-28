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
): string {
  const from = (state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from
  if (from) return pathFromLocationLike(from)
  return sanitizeNextPath(queryNext)
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
