/**
 * FILE: apps/admin/src/lib/sentryImport.ts
 * PURPOSE: Pure helpers for the Sentry import panel on the Integrations page.
 */

/** Max issues per import — mirrors SENTRY_IMPORT_MAX on the server. */
export const SENTRY_IMPORT_MAX = 10

/** "WEB-12, 4501 WEB-13" → ["WEB-12", "4501", "WEB-13"] (deduped, order kept). */
export function parseIssueIdInput(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))]
}

/** Request body: explicit ids, or the newest 5 unresolved when none given. */
export function sentryImportBody(ids: readonly string[]): { issueIds: string[] } | { limit: number } {
  return ids.length > 0 ? { issueIds: [...ids] } : { limit: 5 }
}
