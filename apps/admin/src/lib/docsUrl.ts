/**
 * Docs site base URL for admin outbound links.
 *
 * Production ships at kensaur.us/mushi-mushi/docs (static export + CloudFront).
 * Local dev runs `apps/docs` via Next (`next --turbopack`, default :3000).
 *
 * Override with VITE_DOCS_URL when docs runs on another host/port.
 */

const PROD_DOCS_BASE = 'https://kensaur.us/mushi-mushi/docs'
const DEV_DOCS_BASE = 'http://localhost:3000'

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/** Docs origin + path prefix, without a trailing slash. */
export function getDocsBase(): string {
  const fromEnv = String(import.meta.env.VITE_DOCS_URL ?? '').trim()
  if (fromEnv) return stripTrailingSlash(fromEnv)
  // import.meta.env.DEV is a boolean in production bundles but vi.stubEnv()
  // patches it as a string ('true'/'false') in Vitest — handle both shapes.
  const dev = import.meta.env.DEV
  if (dev === true || dev === 'true') return DEV_DOCS_BASE
  return PROD_DOCS_BASE
}

/**
 * Build a docs URL.
 *
 * Trailing-slash quirk of the static export deploy:
 *   - Index is only reachable at `/docs/` (not bare `/docs`).
 *   - Subpages are flat HTML without a trailing slash on the directory.
 */
export function docsUrl(path = ''): string {
  const base = getDocsBase()
  if (!path) return `${base}/`
  if (path.startsWith('#')) return `${base}/${path}`
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}
