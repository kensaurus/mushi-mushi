/**
 * FILE: apps/admin/src/components/marketplace/types.ts
 * PURPOSE: Shapes + status/category lookups shared across marketplace
 *          subcomponents. Keeps the page itself focused on data + actions.
 */

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

export const STATUS_CHIP: Record<string, string> = {
  ok: 'bg-emerald-500/10 text-emerald-500',
  error: 'bg-red-500/10 text-red-500',
  timeout: 'bg-amber-500/10 text-amber-500',
  skipped: 'bg-fg-muted/10 text-fg-muted',
  pending: 'bg-blue-500/10 text-blue-500',
}

export const CATEGORY_LABEL: Record<string, string> = {
  incident: 'Incident response',
  'project-management': 'Project management',
  integration: 'Integration',
  notification: 'Notifications',
  analytics: 'Analytics',
}

export const STATUS_FILTER_OPTIONS = ['', 'ok', 'error', 'timeout', 'skipped', 'pending']
