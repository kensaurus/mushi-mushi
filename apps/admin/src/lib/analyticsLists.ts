/**
 * FILE: apps/admin/src/lib/analyticsLists.ts
 * PURPOSE: List plumbing for /analytics that was wrong in the page.
 *
 *   QA 176  People "Load more" showed page 1 twice: the append effect ran
 *           when the cursor changed, while usePageData still held page 1.
 *           Pages are now merged by row identity, so a page can never be
 *           added twice and a repeated row is dropped.
 *   QA 290  "Distinct events" and every event picker read `top_events`,
 *           which the SQL caps at 20. The summary now also returns
 *           `distinct_events` and `event_names` (migration 20261004163000).
 */

export interface PersonRowKey {
  end_user_id: string | null
  external_user_id: string | null
  display_name: string | null
  first_seen_at: string
}

/** Stable identity of a People row: the end user, else the anonymous person's first sighting. */
function personKey(p: PersonRowKey): string {
  return p.end_user_id ?? `anon:${p.external_user_id ?? p.display_name ?? ''}:${p.first_seen_at}`
}

/** Append a page, skipping rows already shown. */
export function mergePeoplePage<T extends PersonRowKey>(prev: T[], page: T[]): T[] {
  const seen = new Set(prev.map(personKey))
  const out = [...prev]
  for (const p of page) {
    const k = personKey(p)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

export interface EventCatalogueSource {
  top_events: Array<{ name: string }>
  distinct_events?: number | null
  event_names?: string[] | null
}

/** Every event name for the pickers; the top 20 only while the server sends nothing more. */
export function eventCatalogue(summary: EventCatalogueSource | null | undefined): string[] {
  if (!summary) return []
  if (summary.event_names && summary.event_names.length > 0) return summary.event_names
  return summary.top_events.map((e) => e.name)
}

/**
 * The "Distinct events" stat. Without `distinct_events` the top-20 list is
 * all there is, so 20 names may mean "20 or more" and is shown as such.
 */
export function distinctEventsLabel(summary: EventCatalogueSource): string {
  if (summary.distinct_events != null) return String(summary.distinct_events)
  const n = summary.top_events.length
  return n >= 20 ? `${n}+` : String(n)
}
