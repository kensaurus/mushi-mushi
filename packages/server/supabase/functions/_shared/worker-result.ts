/**
 * FILE: packages/server/supabase/functions/_shared/worker-result.ts
 * PURPOSE: Read the reply of an internal worker function (drift-walker,
 *          experiment-analyzer, generate-synthetic, …) that an admin route
 *          proxies. The routes used to `await res.json()` (a 500 when the
 *          worker answered with plain text) and pass `JSON.stringify(json)`
 *          to the console as the error message, so users saw a JSON blob.
 */

export type WorkerResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; message: string }

/** First human-readable sentence in a worker error body, if any. */
function messageFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const err = b.error
  if (typeof err === 'string' && err.trim()) return err.trim()
  if (err && typeof err === 'object') {
    const m = (err as Record<string, unknown>).message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }
  if (typeof b.message === 'string' && b.message.trim()) return b.message.trim()
  return null
}

/**
 * Normalise a worker reply. A body with `ok: false` counts as a failure even
 * on HTTP 200. `fallback` is the plain sentence used when the worker gave no
 * readable reason.
 */
export async function readWorkerResult(res: Response, fallback: string): Promise<WorkerResult> {
  const text = await res.text().catch(() => '')
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  const failed = !res.ok || (body != null && typeof body === 'object' && (body as { ok?: unknown }).ok === false)
  if (!failed && body && typeof body === 'object' && !Array.isArray(body)) {
    return { ok: true, body: body as Record<string, unknown> }
  }
  if (!failed) {
    return { ok: false, status: 502, message: fallback }
  }
  const message = messageFrom(body) ?? fallback
  const status = res.ok ? 502 : res.status >= 400 && res.status < 600 ? res.status : 502
  return { ok: false, status, message: message.slice(0, 300) }
}
