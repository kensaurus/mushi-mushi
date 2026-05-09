/**
 * Shared test helpers for adapter HMAC verification tests.
 *
 * Import these utilities in each adapter test file to produce
 * signatures that match what real webhook senders would generate.
 */
import { createHmac } from 'node:crypto'

/**
 * Computes an HMAC-SHA256 hex digest of `body` keyed with `key`.
 * Matches the format used by: New Relic (`X-NewRelic-Signature`),
 * Bugsnag (`X-Bugsnag-Signature`).
 */
export function computeHmacSha256Hex(key: string, body: string): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('hex')
}

/**
 * Computes a `sha256=<hex>` prefixed HMAC-SHA256 digest of `body`.
 * Matches the format used by: Honeycomb (`X-Honeycomb-Signature`).
 */
export function computeHmacSha256Prefixed(key: string, body: string): string {
  return `sha256=${computeHmacSha256Hex(key, body)}`
}

/**
 * Computes an HMAC-SHA256 base64 digest of `body` keyed with `key`.
 * Matches the format used by: OpsGenie (`X-OG-Signature`).
 */
export function computeHmacSha256Base64(key: string, body: string): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('base64')
}

/** Returns a minimal no-op sink that captures the last call. */
export function makeSink() {
  const calls: unknown[] = []
  const sink = async (input: unknown): Promise<string> => {
    calls.push(input)
    return 'rpt_test_id'
  }
  return { sink, calls }
}

/** Builds a fake request object for handler tests. */
export function makeReq(
  body: unknown,
  headers: Record<string, string> = {},
): { headers: Record<string, string>; rawBody: string } {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
  return { headers, rawBody }
}
