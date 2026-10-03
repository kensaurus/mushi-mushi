/**
 * FILE: packages/server/supabase/functions/_shared/platform-config.ts
 * PURPOSE: The values GET /v1/admin/integrations/platform returns per card.
 *
 * The effective-settings resolver (integration-settings.ts) only tracks the
 * fields that can inherit from org defaults or env vars. Every other card
 * field (`sentry_project_slug`, `sentry_dsn`, `github_default_branch`, the
 * boolean toggles…) used to come back null, and the console's edit form then
 * sent `''` for it on save, which cleared the stored value. Those fields are
 * read straight from the project row instead.
 *
 * Pure: no Deno globals, no npm: specifiers.
 */

/** Project-only list fields shown on a card but never inherited or copied
 *  to other projects (so they stay out of PLATFORM_KIND_FIELDS, which the
 *  org-default and apply-to-all routes iterate). */
export const PROJECT_LIST_FIELDS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  sentry: ['sentry_extra_project_slugs'],
}

/**
 * One card's raw values: resolver-tracked fields from the effective settings
 * (project → org → env), the rest from the project row, list fields as
 * string arrays (empty when the column is missing or unset).
 */
export function platformCardValues(
  kind: string,
  fields: readonly string[],
  effective: Record<string, unknown>,
  trackedByResolver: Readonly<Record<string, unknown>>,
  projectRow: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    out[f] = f in trackedByResolver ? (effective[f] ?? null) : (projectRow?.[f] ?? null)
  }
  for (const f of PROJECT_LIST_FIELDS_BY_KIND[kind] ?? []) {
    const v = projectRow?.[f]
    out[f] = Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  }
  return out
}
