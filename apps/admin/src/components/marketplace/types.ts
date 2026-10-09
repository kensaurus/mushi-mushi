/**
 * FILE: apps/admin/src/components/marketplace/types.ts
 * PURPOSE: Shapes + status/category lookups shared across marketplace
 *          subcomponents. Keeps the page itself focused on data + actions.
 */

import { runStatusChipTone } from '../../lib/chipTone'

export type MarketplaceTabId = 'overview' | 'browse' | 'installed' | 'deliveries'

export type MarketplaceTopPriority =
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

export const STATUS_FILTER_OPTIONS = ['', 'ok', 'error', 'timeout', 'skipped', 'pending']
