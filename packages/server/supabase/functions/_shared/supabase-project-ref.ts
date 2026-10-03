/**
 * FILE: packages/server/supabase/functions/_shared/supabase-project-ref.ts
 * PURPOSE: One definition of a Supabase project ref (the 20-character id in
 *          `https://<ref>.supabase.co`). Used by the settings PATCH that links
 *          a project, the BYOK probe that puts the ref in a Management API
 *          path, and the Supabase connector. No imports, so vitest and Deno
 *          can both load it.
 */

export const SUPABASE_PROJECT_REF_RE = /^[a-z0-9]{20}$/

export function isSupabaseProjectRef(value: unknown): value is string {
  return typeof value === 'string' && SUPABASE_PROJECT_REF_RE.test(value)
}

/**
 * Validate a `supabase_project_ref` settings write. `null`, `''` and
 * whitespace clear the link; anything else must be exactly 20 lowercase
 * letters or digits. Input is trimmed but never lowercased: an uppercase ref
 * is a typo, not a ref.
 */
export function parseSupabaseProjectRefSetting(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string') {
    return { ok: false, message: 'supabase_project_ref must be a string or null' }
  }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (!SUPABASE_PROJECT_REF_RE.test(trimmed)) {
    return {
      ok: false,
      message:
        'supabase_project_ref must be the 20-character project ref (lowercase letters and digits), as in https://<ref>.supabase.co',
    }
  }
  return { ok: true, value: trimmed }
}
