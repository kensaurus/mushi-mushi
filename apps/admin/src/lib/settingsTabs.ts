/**
 * FILE: apps/admin/src/lib/settingsTabs.ts
 * PURPOSE: Turn whatever a link or this browser remembers as the Settings
 *          tab into one of the real tabs.
 *
 *          Settings went from seven tabs to five (2026-10): Firecrawl and
 *          Browserbase moved under "Web tools", Health check and Developer
 *          under "SDK & connection". Links in old bookmarks, the server
 *          (settings-research.ts still sends `?tab=firecrawl`, radar.ts sends
 *          `?tab=keys`) and saved localStorage keep using the old ids, so each
 *          one has an entry here with the section it should scroll to.
 */

import { SETTINGS_TAB_IDS, type SettingsTabId } from '../components/settings/types'

/** Section ids on the Settings page that the aliases scroll to. */
export const SETTINGS_SECTION_IDS = {
  firecrawl: 'firecrawl',
  knownIssuesSearch: 'known-issues-search',
  browserbase: 'browserbase',
  connection: 'connection',
  debugLogging: 'debug-logging',
} as const

/** Where "Search the web for known fixes" lives (KnownIssuesSearchCard). */
export const KNOWN_ISSUES_SEARCH_HREF = `/settings?tab=tools#${SETTINGS_SECTION_IDS.knownIssuesSearch}`

export interface SettingsTabTarget {
  tab: SettingsTabId
  /** Element id to scroll to, without the `#`. */
  anchor: string | null
}

/** Old or alternative `?tab=` values and where each one now lives. */
const SETTINGS_TAB_ALIASES: Readonly<Record<string, SettingsTabTarget>> = {
  firecrawl: { tab: 'tools', anchor: SETTINGS_SECTION_IDS.firecrawl },
  browserbase: { tab: 'tools', anchor: SETTINGS_SECTION_IDS.browserbase },
  health: { tab: 'sdk', anchor: null },
  dev: { tab: 'sdk', anchor: SETTINGS_SECTION_IDS.debugLogging },
  keys: { tab: 'byok', anchor: null },
}

function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === 'string' && (SETTINGS_TAB_IDS as readonly string[]).includes(value)
}

/** A tab id, an alias, or null for anything else. */
export function resolveSettingsTab(value: unknown): SettingsTabTarget | null {
  if (isSettingsTabId(value)) return { tab: value, anchor: null }
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS_TAB_ALIASES, value)) {
    return SETTINGS_TAB_ALIASES[value]
  }
  return null
}

/** For the remembered tab: nothing saved yet, or something that still resolves. */
export function isStoredSettingsTab(value: unknown): value is string | null {
  return value === null || resolveSettingsTab(value) !== null
}

/**
 * The canonical location for an aliased `?tab=`, or null when the URL is
 * already canonical (or has no tab, or an unknown one). Other query params
 * stay; a hash already in the URL wins over the alias's section.
 */
export function normalizeSettingsLocation(
  search: string,
  hash: string,
): { search: string; hash: string } | null {
  const params = new URLSearchParams(search)
  const raw = params.get('tab')
  if (raw === null || isSettingsTabId(raw)) return null
  const target = resolveSettingsTab(raw)
  if (!target) return null
  if (target.tab === 'general') params.delete('tab')
  else params.set('tab', target.tab)
  const query = params.toString()
  return {
    search: query ? `?${query}` : '',
    hash: hash && hash !== '#' ? hash : target.anchor ? `#${target.anchor}` : '',
  }
}
