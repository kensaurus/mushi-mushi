/**
 * FILE: packages/server/supabase/functions/_shared/autofix-toggle.ts
 * PURPOSE: The rule behind POST /v1/admin/projects/:id/autofix/toggle, kept
 *          pure so it is unit-tested without the api.
 *
 * Turning autofix on lets Mushi dispatch fix agents (and spend the project's
 * LLM budget) without a person clicking, so only a project owner or admin may
 * flip it, either way, and the body must say which way:
 * `{ enabled: true | false }`. The route used to read `Boolean(body.enabled)`,
 * so a script or agent that sent no body (possible once API keys can call
 * the route) silently turned autofix off.
 *
 * The role is the caller's real role on the project: an API key acts as its
 * owner (callerCanAccessProject), so a member's key is a member here too.
 * GET /autofix returns canToggleAutofix(role) as `can_toggle` so the console
 * can disable the switch for members instead of answering them with a 403.
 */

export type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer'

export type AutofixToggleBody =
  | { ok: true; enabled: boolean }
  | { ok: false; status: 400; code: 'BAD_BODY'; message: string }

export type AutofixToggleDecision =
  | AutofixToggleBody
  | { ok: false; status: 403; code: 'FORBIDDEN'; message: string }

export function canToggleAutofix(role: ProjectRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function parseAutofixToggleBody(body: unknown): AutofixToggleBody {
  const enabled = typeof body === 'object' && body !== null ? (body as { enabled?: unknown }).enabled : undefined
  if (typeof enabled !== 'boolean') {
    return { ok: false, status: 400, code: 'BAD_BODY', message: 'Send { "enabled": true } or { "enabled": false }.' }
  }
  return { ok: true, enabled }
}

/** The role first, so a caller who may not toggle learns nothing about the body shape. */
export function decideAutofixToggle(role: ProjectRole | null | undefined, body: unknown): AutofixToggleDecision {
  if (!canToggleAutofix(role)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only a project owner or admin can turn autofix on or off.' }
  }
  return parseAutofixToggleBody(body)
}
