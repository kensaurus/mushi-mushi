/**
 * FILE: internal-headers.ts
 * PURPOSE: Propagate correlation headers on server-to-server fetch calls.
 *
 * USAGE:
 *   import { propagateRequestId } from './internal-headers.ts'
 *   fetch(url, { headers: propagateRequestId({ Authorization: '...' }, requestId) })
 */

/** Attach X-Request-Id when a correlation id is known. */
export function propagateRequestId(
  headers: Record<string, string>,
  requestId?: string | null,
): Record<string, string> {
  if (requestId?.trim()) {
    headers['X-Request-Id'] = requestId.trim()
  }
  return headers
}
