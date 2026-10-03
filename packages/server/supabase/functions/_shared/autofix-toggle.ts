/**
 * FILE: packages/server/supabase/functions/_shared/autofix-toggle.ts
 * PURPOSE: The rule behind POST /v1/admin/projects/:id/autofix/toggle, kept
 *          pure so it is unit-tested without the api.
 *
 * Turning autofix on lets Mushi dispatch fix agents (and spend the project's
 * LLM budget) without a person clicking, so only a project owner or admin may
 * flip it, and the body must say which way: `{ enabled: true | false }`. The
 * route used to read `Boolean(body.enabled)`, so a script or agent that sent
 * no body (now possible with an API key) silently turned autofix off.
 */

export type AutofixToggleDecision =
  | { ok: true; enabled: boolean }
  | { ok: false; status: 403; code: 'FORBIDDEN'; message: string }
  | { ok: false; status: 400; code: 'BAD_BODY'; message: string }

/** `role` is the caller's project role (owner | admin | member | viewer), or null without access. */
export function decideAutofixToggle(role: string | null | undefined, body: unknown): AutofixToggleDecision {
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only a project owner or admin can turn autofix on or off.' }
  }
  const enabled = typeof body === 'object' && body !== null ? (body as { enabled?: unknown }).enabled : undefined
  if (typeof enabled !== 'boolean') {
    return { ok: false, status: 400, code: 'BAD_BODY', message: 'Send { "enabled": true } or { "enabled": false }.' }
  }
  return { ok: true, enabled }
}
