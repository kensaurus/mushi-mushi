/**
 * FILE: packages/cli/src/endpoint.ts
 * PURPOSE: Single source of truth for the Mushi Mushi API endpoint and the
 *          validation used everywhere we accept one (CLI flag, config set,
 *          login). Keeps the default, the scheme policy, and the localhost
 *          escape-hatch in one place.
 */

export const DEFAULT_ENDPOINT = 'https://api.mushimushi.dev'

const TEST_REPORT_TIMEOUT_MS = 10_000

export const TEST_REPORT_FETCH_TIMEOUT_MS = TEST_REPORT_TIMEOUT_MS

/**
 * Require https:// endpoints except for local development (localhost /
 * 127.0.0.1 / ::1 / *.local). Returns a normalized origin + pathname.
 * Throws on invalid URL or insecure scheme.
 */
export function assertEndpoint(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid endpoint URL: ${url}`)
  }
  const host = parsed.hostname
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')
  if (parsed.protocol !== 'https:' && !isLocal) {
    throw new Error(`Endpoint must use https:// (got ${parsed.protocol}//${host}).`)
  }
  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname)
}

/** Strip trailing slashes so `${endpoint}/v1/...` never double-slashes. */
export function normalizeEndpoint(url: string | undefined): string {
  return (url ?? DEFAULT_ENDPOINT).replace(/\/+$/, '')
}
