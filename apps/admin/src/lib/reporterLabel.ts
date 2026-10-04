/**
 * FILE: apps/admin/src/lib/reporterLabel.ts
 * PURPOSE: What the report header calls the person who filed a report.
 *
 * Why (2026-10-04 console audit): with no display name the API falls back to
 * the host app's user id, so the header read "REPORTER a076d7d9-9eea-…". A
 * value that is an id is never shown as a name; the id goes in the tooltip.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ReporterFields {
  reporter_display_name?: string | null
  reporter_identity?: { display_name: string | null; external_user_id: string } | null
}

export interface ReporterLabel {
  /** Name, or a plain description when there is none. */
  text: string
  /** Short id shown in small monospace after the text, when useful. */
  shortId: string | null
  /** Full id for the tooltip. */
  title: string | null
}

export function reporterLabel(report: ReporterFields, reporterShort: string): ReporterLabel {
  const externalId = report.reporter_identity?.external_user_id ?? null
  const candidates = [report.reporter_identity?.display_name, report.reporter_display_name]
  for (const raw of candidates) {
    const name = raw?.trim()
    if (name && !UUID_RE.test(name) && name !== externalId) {
      return { text: name, shortId: null, title: externalId ? `App user id ${externalId}` : null }
    }
  }
  // A signed-in user of the host app without a name: the id is the app's own.
  const appUserId =
    externalId ?? candidates.map((c) => c?.trim()).find((c): c is string => Boolean(c && UUID_RE.test(c))) ?? null
  if (appUserId) {
    return { text: 'Signed-in user', shortId: appUserId.slice(0, 8), title: `App user id ${appUserId}` }
  }
  return { text: 'Anonymous reporter', shortId: reporterShort, title: null }
}
