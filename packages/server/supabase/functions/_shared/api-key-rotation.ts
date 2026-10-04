/**
 * FILE: packages/server/supabase/functions/_shared/api-key-rotation.ts
 * PURPOSE: Pure rules for rotating one project API key (POST
 *          /v1/admin/projects/:id/keys/rotate) and for the CI-secret sync's
 *          "revoke the old CI key only after GitHub accepted the new one"
 *          step. No imports, so vitest can load it directly.
 */

/** The replacement keeps its predecessor's label, so the key list still says what it is for. */
export function rotatedKeyLabel(previous: string | null | undefined): string {
  const base = (previous ?? '').replace(/ · rotated$/, '').trim();
  return base ? `${base} · rotated`.slice(0, 64) : 'rotated';
}

/** The replacement keeps its predecessor's scopes; a scope-less legacy row gets the column default. */
export function rotationScopes(previous: unknown): string[] {
  const scopes = Array.isArray(previous)
    ? previous.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];
  return scopes.length > 0 ? [...new Set(scopes)] : ['report:write'];
}

/**
 * Whether the sync may revoke the previous `ci-auto:*` keys: only when the
 * secret that carries the NEW key was written to GitHub. Writing only the
 * project-id or endpoint variables leaves CI on the old key, and revoking it
 * then breaks the next build and every installed app (QA #30).
 */
export function mayRevokePriorCiKeys(written: readonly string[], apiKeyVarName: string): boolean {
  return written.includes(apiKeyVarName);
}
