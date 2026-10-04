/**
 * Shared project domain types and helpers for Projects hub panels.
 */

import { CHIP_TONE } from '../../lib/chipTone'
import type { SdkStatus } from '../SdkVersionBadge'

export type ScopePresetId = 'sdk' | 'mcp-read' | 'mcp-write' | 'voice'

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
  {
    id: 'voice',
    label: 'Voice intake',
    scopes: ['voice:write'],
    hint: 'For a phone (iPhone Shortcut) — submit voice transcripts and confirm them, nothing else.',
  },
]

export function isScopePresetId(value: string | null | undefined): value is ScopePresetId {
  return SCOPE_PRESETS.some((p) => p.id === value)
}

export function scopeBadgeTone(scope: string): string {
  if (scope === 'mcp:write') return CHIP_TONE.dangerSubtle
  if (scope === 'mcp:read') return CHIP_TONE.infoSubtle
  if (scope === 'voice:write') return CHIP_TONE.warnSubtle
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

/**
 * Active / never-used key counts for ONE project. The setup readout used the
 * workspace-wide totals from /projects/stats next to one project's name and
 * key prefixes, so the two disagreed (QA bug 135).
 */
export function projectKeyCounts(keys: readonly Pick<ApiKey, 'is_active' | 'last_seen_at'>[]): {
  active: number
  neverSeen: number
} {
  const active = keys.filter((k) => k.is_active)
  return { active: active.length, neverSeen: active.filter((k) => !k.last_seen_at).length }
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
  /** Last sweep, complete or partial (older servers omit it). */
  index_swept_at?: string | null
  /** complete | filling | capped | stalled */
  index_coverage_state?: string | null
  index_files_indexed?: number | null
  index_files_eligible?: number | null
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
  /** Server-computed (api/_shared/project-capabilities.ts). Absent on older servers. */
  my_role?: 'owner' | 'admin' | 'member' | 'viewer' | null
  /** May mint/rotate/revoke keys and change SDK, assistant and identity settings. */
  can_manage?: boolean
  /** May rename and delete the project. */
  can_delete?: boolean
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

/**
 * Rename / Delete. Uses the server's `can_delete`. The old guess read a null
 * `organization_role` as "owner", but it is null for anyone who reaches the
 * project through a project_members row or a legacy owner_id, so those
 * users saw Rename and Delete and always got a 403 (QA bug 129).
 */
export function canDeleteProject(project: Project): boolean {
  if (typeof project.can_delete === 'boolean') return project.can_delete
  return project.organization_role === 'owner' || project.organization_role === 'admin'
}

/**
 * Keys, SDK config, assistant and signed identity: owner/admin only on the
 * server. Members saw these controls and got 403s, "Project not found" or a
 * spinner that never ended (QA bug 128).
 */
export function canManageProject(project: Project): boolean {
  if (typeof project.can_manage === 'boolean') return project.can_manage
  return project.organization_role === 'owner' || project.organization_role === 'admin'
}

export const LINK_CHIP_CLASS =
  'inline-flex items-center justify-center px-2 py-1 text-xs font-medium rounded-sm gap-1.5 ' +
  'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'motion-safe:transition-opacity motion-safe:duration-150'

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

export type IndexHealth = 'ok' | 'partial' | 'stale' | 'failed' | 'off' | 'never'

/**
 * The last successful sweep: `last_indexed_at` moves only when the whole repo
 * was covered, `index_swept_at` on every sweep, so take the later one.
 */
export function lastIndexSweepAt(repo: Pick<ProjectRepoLite, 'last_indexed_at' | 'index_swept_at'>): string | null {
  const a = repo.last_indexed_at
  const b = repo.index_swept_at ?? null
  if (!a) return b
  if (!b) return a
  return new Date(b) > new Date(a) ? b : a
}

export function indexHealth(repo: ProjectRepoLite): IndexHealth {
  if (!repo.indexing_enabled) return 'off'
  const swept = lastIndexSweepAt(repo)
  if (
    repo.last_index_error &&
    (!swept ||
      (repo.last_index_attempt_at &&
        new Date(repo.last_index_attempt_at) > new Date(swept)))
  ) {
    return 'failed'
  }
  if (!swept) return 'never'
  const ageMs = Date.now() - new Date(swept).getTime()
  if (ageMs > 7 * 86_400_000) return 'stale'
  if (
    repo.index_coverage_state === 'filling' ||
    repo.index_coverage_state === 'capped' ||
    repo.index_coverage_state === 'stalled'
  ) {
    return 'partial'
  }
  return 'ok'
}

/** "1,500 of 4,700 files" when the last sweep measured coverage. */
export function indexCoverageText(repo: Pick<ProjectRepoLite, 'index_files_indexed' | 'index_files_eligible'>): string | null {
  if (repo.index_files_indexed == null || repo.index_files_eligible == null) return null
  return `${repo.index_files_indexed.toLocaleString('en-US')} of ${repo.index_files_eligible.toLocaleString('en-US')} files`
}

export const INDEX_HEALTH_LABEL: Record<IndexHealth, string> = {
  ok: 'Indexed',
  stale: 'Stale',
  failed: 'Failed',
  off: 'Off',
  never: 'Pending',
  partial: 'Partial',
}

export const INDEX_HEALTH_CHIP_TONE: Record<IndexHealth, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  ok: 'ok',
  stale: 'warn',
  failed: 'danger',
  off: 'neutral',
  never: 'neutral',
  partial: 'warn',
}
