/**
 * FILE: packages/server/supabase/functions/_shared/autofix-toggle.ts
 * PURPOSE: The body rule behind POST /v1/admin/projects/:id/autofix/toggle,
 *          kept pure so it is unit-tested without the api.
 *
 * Turning autofix on lets Mushi dispatch fix agents (and spend the project's
 * LLM budget) without a person clicking, so the body must say which way:
 * `{ enabled: true | false }`. The route used to read `Boolean(body.enabled)`,
 * so a script or agent that sent no body (possible once API keys can call
 * the route) silently turned autofix off.
 */

export type AutofixToggleBody =
  | { ok: true; enabled: boolean }
  | { ok: false; status: 400; code: 'BAD_BODY'; message: string }

export function parseAutofixToggleBody(body: unknown): AutofixToggleBody {
  const enabled = typeof body === 'object' && body !== null ? (body as { enabled?: unknown }).enabled : undefined
  if (typeof enabled !== 'boolean') {
    return { ok: false, status: 400, code: 'BAD_BODY', message: 'Send { "enabled": true } or { "enabled": false }.' }
  }
  return { ok: true, enabled }
}
