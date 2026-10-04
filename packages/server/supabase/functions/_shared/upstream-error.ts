/**
 * FILE: packages/server/supabase/functions/_shared/upstream-error.ts
 * PURPOSE: Turn the body of a failed internal edge-function call into the
 *          standard `{ code, message }` error.
 *
 * The api proxies for pdca-runner (Trigger) and skill-sync (Sync now) used to
 * return `{ ok: false, error: <the worker's whole body> }`. A worker answers
 * `{ ok: false, error: 'Run not found or already taken' }` or
 * `{ ok: false, error: { code, message } }`, so the console read
 * `error.message` as undefined and showed only "Trigger failed" / "Sync
 * didn't start" (console QA #101, #245). One unwrap rule for every proxy.
 *
 * No imports: vitest loads this file directly.
 */

export interface UpstreamError {
  code: string
  message: string
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function unwrapUpstreamError(
  body: unknown,
  fallback: UpstreamError,
): UpstreamError {
  if (typeof body === 'string') {
    return { code: fallback.code, message: str(body) ?? fallback.message }
  }
  if (!body || typeof body !== 'object') return fallback
  const obj = body as Record<string, unknown>
  const inner = obj.error
  if (typeof inner === 'string') {
    return { code: str(obj.code) ?? fallback.code, message: str(inner) ?? fallback.message }
  }
  if (inner && typeof inner === 'object') {
    const e = inner as Record<string, unknown>
    return {
      code: str(e.code) ?? str(obj.code) ?? fallback.code,
      message: str(e.message) ?? fallback.message,
    }
  }
  return {
    code: str(obj.code) ?? fallback.code,
    message: str(obj.message) ?? fallback.message,
  }
}
