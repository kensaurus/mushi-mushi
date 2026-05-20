/**
 * Safe JSON parsing for edge-function fetch() responses.
 *
 * Supabase edge runtimes often return plain-text "Internal Server Error" on
 * unhandled failures. Calling res.json() on those bodies throws SyntaxError
 * (Sentry MUSHI-MUSHI-SERVER-11 / MUSHI-MUSHI-SERVER-12).
 */

export async function parseJsonResponse(
  res: Response,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; status: number; body: string }> {
  const body = await res.text()
  if (!body.trim()) {
    return { ok: false, status: res.status, body: `(empty body, HTTP ${res.status})` }
  }
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, json: parsed as Record<string, unknown> }
    }
    return { ok: false, status: res.status, body: body.slice(0, 500) }
  } catch {
    return { ok: false, status: res.status, body: body.slice(0, 500) }
  }
}
