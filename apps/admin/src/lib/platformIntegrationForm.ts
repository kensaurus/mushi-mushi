/**
 * FILE: apps/admin/src/lib/platformIntegrationForm.ts
 * PURPOSE: Pure draft ↔ request-body mapping for the platform integration
 *          cards (IntegrationsPage). Most fields are plain strings; a `list`
 *          field (e.g. Sentry's extra project slugs) is a comma-separated
 *          string in the form and a string array on the wire.
 */

import type { PlatformDef } from '../components/integrations/types'

/** "a, b  c,,b" → ["a", "b", "c"] (trimmed, deduped, order kept). */
export function parseListInput(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))]
}

/** Saved GET values → editable draft strings (lists joined with ", "). */
export function draftFromSaved(saved: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(saved).map(([k, v]) => [
      k,
      v == null ? '' : Array.isArray(v) ? v.filter((s) => typeof s === 'string').join(', ') : String(v),
    ]),
  )
}

function sameList(a: readonly string[], b: unknown): boolean {
  const saved = Array.isArray(b) ? b.filter((s): s is string => typeof s === 'string') : []
  return a.length === saved.length && a.every((v, i) => v === saved[i])
}

/**
 * Request body for PUT /v1/admin/integrations/platform/:kind. A list field is
 * sent as an array, and only when it changed: a save that never touched it
 * then keeps working before the server migration that adds its column.
 */
export function platformSaveBody(
  def: Pick<PlatformDef, 'fields'>,
  draft: Record<string, string>,
  saved: Record<string, unknown>,
): Record<string, unknown> {
  const listFields = new Set(def.fields.filter((f) => f.list).map((f) => f.name))
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(draft)) {
    if (!listFields.has(k)) {
      body[k] = v
      continue
    }
    const next = parseListInput(v)
    if (!sameList(next, saved[k])) body[k] = next
  }
  return body
}

/** Primary Sentry project slug first, then the extras; deduped. */
export function sentryProjectsFromConfig(config: Record<string, unknown>): string[] {
  const primary = typeof config.sentry_project_slug === 'string' ? config.sentry_project_slug.trim() : ''
  const extra = Array.isArray(config.sentry_extra_project_slugs)
    ? config.sentry_extra_project_slugs.filter((s): s is string => typeof s === 'string')
    : []
  return [...new Set([primary, ...extra].map((s) => s.trim()).filter(Boolean))]
}
