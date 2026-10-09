/**
 * FILE: apps/admin/src/lib/sentryImport.ts
 * PURPOSE: Pure helpers for the Sentry import panel on the Integrations page.
 */

/** Max issues per import — mirrors SENTRY_IMPORT_MAX on the server. */
export const SENTRY_IMPORT_MAX = 10

/** Page size of a plain "newest unresolved" import. */
export const SENTRY_IMPORT_NEWEST = 5

/** "Seen in" choices for a search import; 0 = any time. Server max is 90. */
export const SENTRY_SINCE_DAYS_OPTIONS = [0, 7, 14, 30, 90] as const

/** "WEB-12, 4501 WEB-13" → ["WEB-12", "4501", "WEB-13"] (deduped, order kept). */
export function parseIssueIdInput(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))]
}

/** Request body: explicit ids, or the newest 5 unresolved when none given. */
export function sentryImportBody(ids: readonly string[]): { issueIds: string[] } | { limit: number } {
  return ids.length > 0 ? { issueIds: [...ids] } : { limit: SENTRY_IMPORT_NEWEST }
}

export interface SentrySearchParams {
  /** One of the project's Sentry projects; omitted = the primary. */
  sentryProject?: string
  /** Only issues seen in the last N days; 0 / omitted = any time. */
  sinceDays?: number
}

export interface SentrySearchBody {
  limit: number
  sinceDays?: number
  sentryProject?: string
  cursor?: string
}

/**
 * Body for a search import (no issue ids). A backlog search (`sinceDays`
 * set) pulls full pages of 10; the plain "newest" import stays at 5. Pass the
 * previous answer's `nextCursor` to fetch the next page of the same search.
 */
export function sentrySearchBody(params: SentrySearchParams, cursor?: string | null): SentrySearchBody {
  const body: SentrySearchBody = { limit: params.sinceDays ? SENTRY_IMPORT_MAX : SENTRY_IMPORT_NEWEST }
  if (params.sinceDays) body.sinceDays = params.sinceDays
  if (params.sentryProject) body.sentryProject = params.sentryProject
  if (cursor) body.cursor = cursor
  return body
}
