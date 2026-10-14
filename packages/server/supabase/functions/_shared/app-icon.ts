/**
 * FILE: app-icon.ts
 * PURPOSE: Each app's own icon for the console (Portfolio cards, project
 *          switcher). Owner, 2026-10-14: "show the apps' own icons", not
 *          letter monograms.
 *
 * Order: the App Store icon (iTunes lookup `artworkUrl512`), then the Google
 * Play listing image; the console falls back to the site favicon and then to
 * initials. Store ids come from the current App Store Connect / Play Console
 * connector snapshots (`facts.apps[].appleId` / `.package`), so an app needs no
 * extra setup. The result is stored on `projects` (icon_url, icon_source,
 * icon_checked_at) and refreshed after ICON_REFRESH_MS, so page loads never
 * ask a store.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { parseItunesLookup, parsePlayListing, type ProbeFetcher } from './radar/public-probes.ts'

const log = rootLog.child('app-icon')

export const ICON_REFRESH_MS = 7 * 86_400_000

export type AppIconSource = 'app_store' | 'google_play'

export interface StoreIds {
  appleIds: string[]
  packages: string[]
}

export interface ResolvedIcon {
  url: string
  source: AppIconSource
}

/** Hosts the stores serve icons from; anything else is not trusted as an icon. */
const ICON_HOST_RE = /(^|\.)mzstatic\.com$|(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$/i

export function isStoreIconUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ICON_HOST_RE.test(u.hostname)
  } catch {
    return false
  }
}

/** Store ids from one project's current connector snapshots. */
export function storeIdsFromSnapshots(rows: ReadonlyArray<{ kind: string; snapshot: unknown }>): StoreIds {
  const appleIds = new Set<string>()
  const packages = new Set<string>()
  for (const row of rows) {
    const apps = (row.snapshot as { facts?: { apps?: unknown } } | null)?.facts?.apps
    if (!Array.isArray(apps)) continue
    for (const app of apps) {
      const a = app as { appleId?: unknown; package?: unknown }
      if (row.kind === 'app_store_connect' && typeof a.appleId === 'string' && /^\d{5,12}$/.test(a.appleId)) appleIds.add(a.appleId)
      if (row.kind === 'play_console' && typeof a.package === 'string' && /^[A-Za-z][\w.]{2,150}$/.test(a.package)) packages.add(a.package)
    }
  }
  return { appleIds: [...appleIds], packages: [...packages] }
}

/**
 * The first store icon found: App Store ids first, then Play packages.
 * `complete` is false when a store could not be read (network error or a
 * 5xx/429), so "no icon" is not yet an answer.
 */
export async function resolveStoreIcon(ids: StoreIds, fetcher: ProbeFetcher): Promise<{ icon: ResolvedIcon | null; complete: boolean }> {
  let complete = true
  const transient = (status: number) => status === 429 || status >= 500
  for (const id of ids.appleIds) {
    try {
      const res = await fetcher(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}`)
      if (transient(res.status)) complete = false
      const url = res.status === 200 ? parseItunesLookup(res.text)?.iconUrl : null
      if (isStoreIconUrl(url)) return { icon: { url, source: 'app_store' }, complete: true }
    } catch (err) {
      complete = false
      log.warn('App Store lookup failed', { appleId: id, err: String(err).slice(0, 160) })
    }
  }
  for (const pkg of ids.packages) {
    try {
      const res = await fetcher(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en`)
      if (transient(res.status)) complete = false
      const url = res.status === 200 ? parsePlayListing(res.text)?.iconUrl : null
      if (isStoreIconUrl(url)) return { icon: { url, source: 'google_play' }, complete: true }
    } catch (err) {
      complete = false
      log.warn('Google Play listing read failed', { package: pkg, err: String(err).slice(0, 160) })
    }
  }
  return { icon: null, complete }
}

/** Projects whose icon has never been looked up, or not within ICON_REFRESH_MS. */
export function iconsDue(rows: ReadonlyArray<{ id: string; icon_checked_at: string | null }>, now: Date): string[] {
  return rows
    .filter((r) => !r.icon_checked_at || now.getTime() - Date.parse(r.icon_checked_at) > ICON_REFRESH_MS)
    .map((r) => r.id)
}

/**
 * Look up and store the icon of each project in `projectIds`. Never throws:
 * an icon is cosmetic, so a failure is logged and the project keeps its old
 * value. icon_checked_at is stamped only when every store read for it
 * finished, so one outage does not hide an icon for a week.
 */
export async function refreshAppIcons(db: SupabaseClient, projectIds: readonly string[], fetcher: ProbeFetcher, now: Date): Promise<void> {
  if (projectIds.length === 0) return
  const { data, error } = await db
    .from('connector_snapshots')
    .select('project_id, kind, snapshot')
    .in('project_id', projectIds as string[])
    .eq('is_current', true)
    .in('kind', ['app_store_connect', 'play_console'])
  if (error) {
    log.warn('connector snapshots unreadable; icons not refreshed', { err: error.message })
    return
  }
  const byProject = new Map<string, Array<{ kind: string; snapshot: unknown }>>()
  for (const row of (data ?? []) as Array<{ project_id: string; kind: string; snapshot: unknown }>) {
    const list = byProject.get(row.project_id) ?? []
    list.push(row)
    byProject.set(row.project_id, list)
  }
  for (const projectId of projectIds) {
    const ids = storeIdsFromSnapshots(byProject.get(projectId) ?? [])
    const { icon, complete } = await resolveStoreIcon(ids, fetcher)
    // A store was unreachable and nothing was found: ask again next time.
    if (!icon && !complete) continue
    // No store ids, or no icon in any listing: record the check, keep no URL.
    const patch = icon
      ? { icon_url: icon.url, icon_source: icon.source, icon_checked_at: now.toISOString() }
      : { icon_url: null, icon_source: null, icon_checked_at: now.toISOString() }
    const { error: upErr } = await db.from('projects').update(patch).eq('id', projectId)
    if (upErr) log.warn('icon not saved', { projectId, err: upErr.message })
  }
}
