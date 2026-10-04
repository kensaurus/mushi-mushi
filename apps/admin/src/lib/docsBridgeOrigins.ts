/**
 * FILE: apps/admin/src/lib/docsBridgeOrigins.ts
 * PURPOSE: Which docs origins the docs bridge (/docs-bridge) may hand a
 *          sign-in token to.
 *
 * The hosted docs live at kensaur.us. Local docs dev servers (localhost /
 * 127.0.0.1 on :3000 or :3001) are allowed only when the console itself runs
 * locally: a production console must never post a live access token to
 * whatever happens to be listening on the user's machine. Operators can add
 * hosts with VITE_DOCS_ORIGIN_ALLOWLIST (mirrors MUSHI_DOCS_ORIGIN_ALLOWLIST on
 * the API); the same local-only rule applies to those entries.
 */

const HOSTED_DOCS_ORIGINS = ['https://kensaur.us', 'https://www.kensaur.us'] as const

const LOCAL_DOCS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
] as const

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase())
}

function isLocalOrigin(origin: string): boolean {
  try {
    return isLocalHostname(new URL(origin).hostname)
  } catch {
    return false
  }
}

/**
 * The allowed docs origins for a console served from `consoleHostname`.
 * `extraRaw` is the comma-separated VITE_DOCS_ORIGIN_ALLOWLIST value.
 */
export function docsBridgeAllowedOrigins(consoleHostname: string, extraRaw = ''): Set<string> {
  const consoleIsLocal = isLocalHostname(consoleHostname)
  const extras = extraRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const candidates = [...HOSTED_DOCS_ORIGINS, ...(consoleIsLocal ? LOCAL_DOCS_ORIGINS : []), ...extras]
  const out = new Set<string>()
  for (const raw of candidates) {
    const origin = normalizeOrigin(raw)
    if (!origin) continue
    if (isLocalOrigin(origin) && !consoleIsLocal) continue
    out.add(origin)
  }
  return out
}
