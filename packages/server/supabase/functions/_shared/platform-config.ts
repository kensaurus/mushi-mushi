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

/** Shown on a card, written only by the server (never accepted by a PUT). */
export const READ_ONLY_FIELDS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  sentry: ['sentry_auto_import_last_at'],
}

/**
 * Card fields that name the app itself rather than the account it reports
 * to: which Sentry project, which DSN, which repo. "Apply to all projects in
 * org" copied them along with the token, so applying Sentry from one app
 * pointed every other app at that app's Sentry project (2026-10-09).
 */
export const PER_APP_FIELDS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  sentry: ['sentry_project_slug', 'sentry_dsn', 'sentry_auto_import'],
  github: ['github_repo_url', 'github_default_branch', 'github_deploy_key'],
}

/** The fields of `kind` that "Apply to all projects in org" copies. */
export function fieldsSharedAcrossApps(kind: string, fields: readonly string[]): string[] {
  const perApp = new Set(PER_APP_FIELDS_BY_KIND[kind] ?? [])
  return fields.filter((f) => !perApp.has(f))
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
  for (const f of READ_ONLY_FIELDS_BY_KIND[kind] ?? []) out[f] = projectRow?.[f] ?? null
  return out
}
