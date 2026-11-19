/**
 * FILE: apps/admin/src/components/marketplace/types.ts
 * PURPOSE: Shapes + status/category lookups shared across marketplace
 *          subcomponents. Keeps the page itself focused on data + actions.
 */

import { runStatusChipTone } from '../../lib/chipTone'

export type MarketplaceTabId = 'overview' | 'browse' | 'installed' | 'deliveries'

type MarketplaceTopPriority =
  | 'no_project'
  | 'delivery_failures'
  | 'plugins_paused'
  | 'no_plugins_installed'
  | 'healthy'

export interface MarketplacePlugin {
  slug: string
  name: string
  short_description: string
  long_description: string | null
  publisher: string
  source_url: string | null
  manifest: { subscribes?: string[]; config?: Record<string, string> } | null
  required_scopes: string[]
  install_count: number
  category: string
  is_official: boolean
}

export interface InstalledPlugin {
  id?: string
  plugin_name: string
  plugin_slug: string | null
  webhook_url: string | null
  subscribed_events: string[]
  is_active: boolean
  last_delivery_at: string | null
  last_delivery_status: 'ok' | 'error' | 'timeout' | 'skipped' | null
}

export interface DispatchEntry {
  id: number
  delivery_id: string
  plugin_slug: string
  event: string
  status: 'pending' | 'ok' | 'error' | 'timeout' | 'skipped'
  http_status: number | null
  duration_ms: number | null
  response_excerpt: string | null
  created_at: string
}

export interface ReliabilityStats {
  total: number
  ok: number
  error: number
  avgLatency: number
}

export interface MarketplaceStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  catalogTotal: number
  installedTotal: number
  installedActive: number
  installedPaused: number
  deliveries7d: number
  deliveriesOk: number
  deliveriesFailed: number
  deliverySuccessRatePct: number
  lastDeliveryAt: string | null
  daysSinceLastDelivery: number | null
  failingPlugins: number
  neverDeliveredPlugins: number
  topPriority: MarketplaceTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_MARKETPLACE_STATS: MarketplaceStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  catalogTotal: 0,
  installedTotal: 0,
  installedActive: 0,
  installedPaused: 0,
  deliveries7d: 0,
  deliveriesOk: 0,
  deliveriesFailed: 0,
  deliverySuccessRatePct: 0,
  lastDeliveryAt: null,
  daysSinceLastDelivery: null,
  failingPlugins: 0,
  neverDeliveredPlugins: 0,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}

export const STATUS_CHIP: Record<string, string> = {
  ok: runStatusChipTone('ok'),
  error: runStatusChipTone('error'),
  timeout: runStatusChipTone('timeout'),
  skipped: runStatusChipTone('skipped'),
  pending: runStatusChipTone('pending'),
}

export const CATEGORY_LABEL: Record<string, string> = {
  incident: 'Incident response',
  'project-management': 'Project management',
  integration: 'Integration',
  notification: 'Notifications',
  analytics: 'Analytics',
}

/**
 * Catalog plugins that duplicate a native card on Integrations. Their card
 * links there instead of offering a second, webhook-based install.
 */
export const INTEGRATIONS_HREF_BY_PLUGIN_SLUG: Record<string, string> = {
  sentry: '/integrations/config#platform-card-sentry',
  linear: '/integrations/config#integrations-linear',
  jira: '/integrations/config#integrations-routing',
  pagerduty: '/integrations/config#integrations-routing',
  'cursor-cloud-agent': '/integrations/config#platform-card-cursor_cloud',
  'claude-code-agent': '/integrations/config#platform-card-claude_code_agent',
}

/**
 * Round-2 sweep 2026-11-18: five of six catalogue cards were full cards that
 * only said "Already on Integrations →", each with an "Official" chip. The
 * catalogue now draws a card only for a plugin you can install (or have
 * installed) here; the ones Integrations covers fold into one row of links.
 */
export function splitCatalog<T extends { slug: string }>(
  catalog: readonly T[],
  installedSlugs: ReadonlySet<string>,
): { own: T[]; covered: Array<T & { href: string }> } {
  const own: T[] = []
  const covered: Array<T & { href: string }> = []
  for (const p of catalog) {
    const href = INTEGRATIONS_HREF_BY_PLUGIN_SLUG[p.slug]
    if (href && !installedSlugs.has(p.slug)) covered.push({ ...p, href })
    else own.push(p)
  }
  return { own, covered }
}

/** "Official" only tells plugins apart when some are not; on an all-official list it is noise. */
export function showOfficialChip(catalog: ReadonlyArray<{ is_official: boolean }>): boolean {
  return catalog.some((p) => p.is_official) && catalog.some((p) => !p.is_official)
}

/** The product is "Mushi Mushi", never "Mushi" (catalogue rows still carry the short name). */
export function displayPublisher(publisher: string): string {
  return ['mushi', 'mushi-mushi', 'mushi mushi'].includes(publisher.trim().toLowerCase()) ? 'Mushi Mushi' : publisher
}

/** Same rule for catalogue descriptions: "any Mushi event" → "any Mushi Mushi event". */
export function displayPluginText(text: string): string {
  return text.replace(/\bMushi( Mushi)?\b/g, 'Mushi Mushi')
}

/**
 * The empty-state copy for a project with no plugins (2026-11-18). "No plugins installed
 * yet" sat above cards that mostly said "Already on Integrations", so it names the plugins
 * that are actually left to install here instead.
 */
export function marketplaceEmptyCopy(catalog: ReadonlyArray<{ slug: string; name: string }>): { title: string; description: string } {
  const PURPOSE = 'A plugin sends Mushi Mushi events (new report, fix merged) to your own HTTPS endpoint, signed so you can verify them.'
  const own = catalog.filter((p) => !INTEGRATIONS_HREF_BY_PLUGIN_SLUG[p.slug])
  const covered = catalog.length - own.length
  if (covered === 0 || catalog.length === 0) return { title: 'No plugins installed yet', description: PURPOSE }
  if (own.length === 0) return { title: 'Every plugin here is set up from Integrations', description: PURPOSE }
  const names = own.map((p) => p.name)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return {
    title: `${list} ${own.length === 1 ? 'is the only plugin' : 'are the only plugins'} not covered by Integrations`,
    // The "Set up from Integrations:" link row under the cards names the others; the intro said
    // it a second time (2026-11-19).
    description: PURPOSE,
  }
}

/**
 * Minimum signing-secret length for a webhook plugin. One number for the
 * install form's field check and the submit guard (they used to say 32 and
 * 16). The generated secret is 64 hex characters.
 */
export const PLUGIN_SECRET_MIN_LENGTH = 32

/** True for a URL the plugin PATCH / install will accept (public https). */
export function pluginWebhookUrlError(raw: string): string | null {
  const v = raw.trim()
  if (!v) return 'Paste the HTTPS URL of your webhook receiver.'
  let url: URL
  try {
    url = new URL(v)
  } catch {
    return 'That is not a valid URL. Paste the full https:// address of your receiver.'
  }
  if (url.protocol !== 'https:') return 'Webhook URLs must start with https:// so deliveries are encrypted.'
  return null
}

/**
 * A subscribed event in words. Zapier Bridge subscribes to "*", which the
 * catalog card showed as a lone asterisk (report fb35c525).
 */
export function pluginEventLabel(event: string): string {
  if (event === '*') return 'All events'
  const prefix = event.match(/^([a-z_]+)\.\*$/)?.[1]
  if (prefix) return `All ${prefix.replace(/_/g, ' ')} events`
  return event
}

export type PluginHealthTone = 'ok' | 'warn' | 'danger' | 'neutral'

/** One installed plugin's delivery health, in words. */
export function pluginHealth(
  plugin: Pick<InstalledPlugin, 'is_active' | 'last_delivery_at' | 'last_delivery_status'>,
  stats?: ReliabilityStats,
): { tone: PluginHealthTone; label: string } {
  if (!plugin.is_active) return { tone: 'neutral', label: 'Paused' }
  if (plugin.last_delivery_status === 'error' || plugin.last_delivery_status === 'timeout') {
    return { tone: 'danger', label: plugin.last_delivery_status === 'timeout' ? 'Last delivery timed out' : 'Last delivery failed' }
  }
  if (!plugin.last_delivery_at) return { tone: 'warn', label: 'Nothing sent yet' }
  if (stats && stats.error > 0) return { tone: 'warn', label: 'Delivering, with some failures' }
  return { tone: 'ok', label: 'Delivering' }
}

export const STATUS_FILTER_OPTIONS = ['', 'ok', 'error', 'timeout', 'skipped', 'pending']
