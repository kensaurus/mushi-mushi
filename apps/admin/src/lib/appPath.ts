/**
 * FILE: apps/admin/src/lib/appPath.ts
 * PURPOSE: Keep raw links and hard navigations inside the console SPA.
 *
 * The console is served from a sub-path in production
 * (`/mushi-mushi/admin/` on kensaur.us; Vite's `BASE_URL`, set from
 * `VITE_BASE_PATH`). React Router's `<Link>` and `navigate()` add that base
 * through `BrowserRouter basename`, but a raw anchor to /billing, or a
 * `window.location` assignment of /dashboard, resolves against the domain root
 * and lands on `https://kensaur.us/billing`, a 404 outside the app.
 *
 * Prefer `<Link>` / `navigate()` for in-app moves. Use these helpers only when
 * a raw URL is unavoidable: a full reload (account switch), an error boundary
 * that renders outside the router, or a URL copied to the clipboard.
 */

/** `/mushi-mushi/admin/` → `/mushi-mushi/admin`; `/` → `` (no prefix). */
function basePrefix(basePath: string | undefined): string {
  return (basePath ?? '/').replace(/\/+$/, '')
}

/**
 * Prefix a root-relative in-app path with the SPA base path.
 *
 * Absolute URLs (`https:`, `mailto:` …), protocol-relative `//host` URLs,
 * relative paths and `#anchors` pass through untouched, and a path that already
 * carries the base is not prefixed twice.
 */
export function withBasePath(path: string, basePath: string = import.meta.env.BASE_URL): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path
  if (path.startsWith('//')) return path
  if (!path.startsWith('/')) return path
  const base = basePrefix(basePath)
  if (!base) return path
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}${path}`
}

/** Absolute URL for an in-app path, for clipboards and outbound messages. */
export function appUrl(
  path: string,
  opts?: { origin?: string; basePath?: string },
): string {
  const origin = opts?.origin ?? window.location.origin
  return `${origin}${withBasePath(path.startsWith('/') ? path : `/${path}`, opts?.basePath)}`
}

/**
 * Full-page navigation to an in-app path. Use only when a reload is the point
 * (dropping every in-memory cache after an account switch); otherwise use
 * `navigate()`.
 */
export function hardNavigate(path: string, opts?: { replace?: boolean }): void {
  if (typeof window === 'undefined') return
  const target = withBasePath(path)
  if (opts?.replace) window.location.replace(target)
  else window.location.assign(target)
}
