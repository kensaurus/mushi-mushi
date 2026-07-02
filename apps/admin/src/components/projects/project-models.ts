/**
 * Shared project domain types and helpers for Projects hub panels.
 */

import { CHIP_TONE } from '../../lib/chipTone'
import type { SdkStatus } from '../SdkVersionBadge'

export type ScopePresetId = 'sdk' | 'mcp-read' | 'mcp-write'

export const SCOPE_PRESETS: Array<{ id: ScopePresetId; label: string; scopes: string[]; hint: string }> = [
  {
    id: 'sdk',
    label: 'SDK ingest',
    scopes: ['report:write'],
    hint: "For your app's Mushi SDK — submit reports, nothing else.",
  },
  {
    id: 'mcp-read',
    label: 'MCP read-only',
    scopes: ['mcp:read'],
    hint: 'Coding agent can browse reports, fixes, graph — but not act.',
  },
  {
    id: 'mcp-write',
    label: 'MCP read + write',
    scopes: ['mcp:write'],
    hint: 'Coding agent can dispatch fixes, run judge, transition status.',
  },
]

export function scopeBadgeTone(scope: string): string {
  if (scope === 'mcp:write') return CHIP_TONE.dangerSubtle
  if (scope === 'mcp:read') return CHIP_TONE.infoSubtle
  return CHIP_TONE.neutral
}

export interface ApiKey {
  id: string
  key_prefix: string
  created_at: string
  is_active: boolean
  revoked: boolean
  scopes?: string[]
  label?: string | null
  last_seen_at?: string | null
  last_seen_origin?: string | null
  last_seen_user_agent?: string | null
  last_seen_endpoint_host?: string | null
}

type PdcaStageId = 'plan' | 'do' | 'check' | 'act'

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | null

export interface ProjectRepoLite {
  id: string
  repo_url: string | null
  role: string | null
  default_branch: string | null
  is_primary: boolean
  indexing_enabled: boolean
  last_indexed_at: string | null
  last_index_attempt_at: string | null
  last_index_error: string | null
  github_app_connected: boolean
}

interface SeverityBreakdown {
  critical: number
  major: number
  minor: number
  trivial: number
  other: number
  total: number
}

export interface Project {
  id: string
  name: string
  slug: string
  created_at: string
  organization_id: string | null
  organization_role: OrgRole
  api_keys: ApiKey[]
  active_key_count: number
  member_count: number
  members: Array<{ user_id: string; role: string }>
  report_count: number
  last_report_at: string | null
  pdca_bottleneck: PdcaStageId | null
  pdca_bottleneck_label: string | null
  pdca_bottleneck_count?: number | null
  failed_fixes_preview?: Array<{
    id: string
    report_id: string
    error_head: string | null
    report_title: string | null
  }>
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_deprecation_message?: string | null
  sdk_status?: SdkStatus
  plan_tier?: string | null
  data_residency_region?: string | null
  primary_repo?: ProjectRepoLite | null
  repos?: ProjectRepoLite[]
  indexed_file_count?: number
  severity_breakdown_30d?: SeverityBreakdown
  sentry_connected?: boolean
  sentry_connected_reports_30d?: number
  trend_7d?: {
    last7d: number
    prev7d: number
    delta: number
    direction: 'up' | 'down' | 'flat'
  }
}

export function canDeleteProject(project: Project): boolean {
  if (project.organization_role === null) return true
  return project.organization_role === 'owner' || project.organization_role === 'admin'
}

export const LINK_CHIP_CLASS =
  'inline-flex items-center justify-center px-2 py-1 text-xs font-medium rounded-sm gap-1.5 ' +
  'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'motion-safe:transition-colors motion-safe:duration-150'

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function shortRepoLabel(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const trimmed = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '')
    return trimmed || u.host
  } catch {
    return url
  }
}

export type IndexHealth = 'ok' | 'stale' | 'failed' | 'off' | 'never'

export function indexHealth(repo: ProjectRepoLite): IndexHealth {
  if (!repo.indexing_enabled) return 'off'
  if (
    repo.last_index_error &&
    (!repo.last_indexed_at ||
      (repo.last_index_attempt_at &&
        new Date(repo.last_index_attempt_at) > new Date(repo.last_indexed_at)))
  ) {
    return 'failed'
  }
  if (!repo.last_indexed_at) return 'never'
  const ageMs = Date.now() - new Date(repo.last_indexed_at).getTime()
  if (ageMs > 7 * 86_400_000) return 'stale'
  return 'ok'
}

export const INDEX_HEALTH_LABEL: Record<IndexHealth, string> = {
  ok: 'Indexed',
  stale: 'Stale',
  failed: 'Failed',
  off: 'Off',
  never: 'Pending',
}

export const INDEX_HEALTH_CHIP_TONE: Record<IndexHealth, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  ok: 'ok',
  stale: 'warn',
  failed: 'danger',
  off: 'neutral',
  never: 'neutral',
}
