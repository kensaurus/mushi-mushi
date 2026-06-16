/**
 * FILE: apps/admin/src/pages/ProjectsPage.tsx
 * PURPOSE: List, create, and operate on every project the user owns. Includes
 *          per-project stats, member chips, deep links into project-scoped
 *          surfaces (settings, reports, integrations), and a "send test
 *          report" action so admins can verify the pipeline end-to-end without
 *          copy-pasting an API key.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { usePageCopy } from '../lib/copy'
import { useRealtimeReload } from '../lib/realtime'
import { pluralize, pluralizeWithCount } from '../lib/format'
import { PageScopeHint,SnapshotSectionHint,PageHeader,
  PageHelp,
  Section,
  Card,
  Btn,
  ErrorAlert,
  Input,
  EmptyState,
  Badge,
  Tooltip,
  StatCard,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction, } from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { canCreateProject, viewerRoleHint } from '../lib/orgPermissions'
import { useCreateProject } from '../lib/useCreateProject'
import { useUpdateProject } from '../lib/useUpdateProject'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useActiveOrgId, type OrganizationSummary } from '../components/OrgSwitcher'
import { ProjectsStatusBanner } from '../components/projects/ProjectsStatusBanner'
import { ProjectFolderTabRail } from '../components/projects/ProjectFolderTabRail'
import {
  EMPTY_PROJECTS_STATS,
  type ProjectsStats,
  type ProjectsTabId,
} from '../components/projects/types'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  ACTIVE_PROJECT_STORAGE_KEY,
  setActiveProjectIdSnapshot,
} from '../lib/activeProject'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'
import { RevealedKeyCard } from '../components/RevealedKeyCard'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { SdkHealthSummary } from '../components/SdkHealthSummary'
import { ConfigHelp } from '../components/ConfigHelp'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DangerConfirm } from '../components/DangerConfirm'
import { MigrationsInProgressCard } from '../components/migrations/MigrationsInProgressCard'
import { SdkVersionBadge, type SdkStatus } from '../components/SdkVersionBadge'
import { SdkUpgradeCTA } from '../components/SdkUpgradeCTA'
import { VerifySetupPanel } from '../components/VerifySetupPanel'
import { CodeInline } from '../components/CodePanel'
import { ProjectFavicon } from '../components/ProjectFavicon'
import { sdkOriginFromApiKeys } from '../lib/resolveProjectDomain'
import { PDCA_BOTTLENECK_TONE, bottleneckDeepLink } from '../lib/pdcaBottleneck'
import {
  IconCheck,
  IconClose,
  IconPencil,
  IconTrash,
  IconGit,
  IconExternalLink,
  IconStorage,
  IconReports,
  IconIntegrations,
  IconSettings,
  IconSend,
  IconKey,
  IconCopy,
  IconExplore,
  IconClock,
  IconUser,
  IconGauge,
  IconTerminal,
} from '../components/icons'

// Undo window for soft-delete operations on this page (project delete,
// API key revoke). Long enough for the "wait, that wasn't who I meant"
// reaction (Nielsen reports ~5-10 s for recognition errors), short enough
// that the user doesn't think the action silently failed. Mirrors the
// member-remove window in OrganizationSettingsPage.
const UNDO_WINDOW_MS = 8000

const TABS: Array<{ id: ProjectsTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Workspace posture — project count, ingest coverage, SDK heartbeats, and recommended next steps.',
  },
  {
    id: 'list',
    label: 'Your projects',
    description: 'Switch context, mint keys, send test reports, and inspect per-project SDK health.',
  },
  {
    id: 'create',
    label: 'New project',
    description: 'Create a project for one app or environment — API keys and scoped inbox follow on the list tab.',
  },
]

function resolveProjectsTab(value: string | null): ProjectsTabId {
  if (value === 'list' || value === 'create') return value
  return 'overview'
}

interface ApiKey {
  id: string
  key_prefix: string
  created_at: string
  is_active: boolean
  revoked: boolean
  scopes?: string[]
  label?: string | null
  // Heartbeat columns surfaced by /v1/admin/projects so the SdkHealthSummary
  // card can render per-key connectivity status without a second round-trip.
  // Optional because legacy responses (pre-2026-05-07 audit) didn't return
  // them; the helper functions in SdkHealthSummary treat absence as "never".
  last_seen_at?: string | null
  last_seen_origin?: string | null
  last_seen_user_agent?: string | null
  last_seen_endpoint_host?: string | null
}

/**
 * Scope presets surfaced in the "New key" picker. Each preset bundles one or
 * more raw scopes so users can pick a capability (what agents do with the
 * key) instead of reasoning about the underlying vocabulary.
 *
 * Mirror of the check constraint on `project_api_keys.scopes` — if you add
 * a preset here you must also add the raw scope to migration
 * `20260421003000_api_key_scopes.sql`.
 */
type ScopePresetId = 'sdk' | 'mcp-read' | 'mcp-write'

const SCOPE_PRESETS: Array<{ id: ScopePresetId; label: string; scopes: string[]; hint: string }> = [
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

function scopeBadgeTone(scope: string): string {
  if (scope === 'mcp:write') return 'bg-danger-muted text-danger border border-danger/30'
  if (scope === 'mcp:read') return 'bg-info-muted text-info border border-info/30'
  return 'bg-surface-overlay text-fg-muted border border-edge-subtle'
}

interface Member {
  user_id: string
  role: string
}

type PdcaStageId = 'plan' | 'do' | 'check' | 'act'

/**
 * Org role of the current user IN the project's organization. Returned by
 * GET /v1/admin/projects so the FE can gate destructive actions (delete
 * project) on role without a second round-trip per row. `null` is the
 * legacy-fallback shape (project predates the orgs backfill); treat null as
 * "owner" for back-compat.
 */
type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | null

interface ProjectRepoLite {
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

interface Project {
  id: string
  name: string
  slug: string
  created_at: string
  organization_id: string | null
  organization_role: OrgRole
  api_keys: ApiKey[]
  active_key_count: number
  member_count: number
  members: Member[]
  report_count: number
  last_report_at: string | null
  pdca_bottleneck: PdcaStageId | null
  pdca_bottleneck_label: string | null
  /** SDK identity columns and freshness verdict, plumbed by
   *  GET /v1/admin/projects (see billing-projects-queue-graph.ts). The
   *  backend joins `reports.sdk_package`/`reports.sdk_version` for the
   *  most recent report against the `sdk_versions` catalogue and emits
   *  `sdk_status` so the FE doesn't need a second round-trip to render
   *  the badge. `unknown` = no reports landed yet, in which case the
   *  badge silently renders nothing. */
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_deprecation_message?: string | null
  sdk_status?: SdkStatus
  /** Project-level metadata threaded through 2026-05-07 to give the FE
   *  enough context to render an "About this project" surface without
   *  any second round-trips. Each block is optional because legacy
   *  responses (and projects with nothing connected) won't include it. */
  plan_tier?: string | null
  data_residency_region?: string | null
  primary_repo?: ProjectRepoLite | null
  repos?: ProjectRepoLite[]
  indexed_file_count?: number
  severity_breakdown_30d?: SeverityBreakdown
  /** True when ≥1 report in the last 30 days carried a Sentry trace id.
   *  Drives the "Sentry connected" badge on the row. Backend computes
   *  this from `reports.sentry_trace_id IS NOT NULL` over the same
   *  30-day window as the severity breakdown. */
  sentry_connected?: boolean
  sentry_connected_reports_30d?: number
  /** 7-day vs prior-7-day report count. Powers the trend arrow chip
   *  on each project row — "is this project getting noisier?". */
  trend_7d?: {
    last7d: number
    prev7d: number
    delta: number
    direction: 'up' | 'down' | 'flat'
  }
}

/**
 * True iff the current user is allowed to delete this project. Backend
 * mirrors this exact rule (org owner/admin OR legacy direct owner_id).
 */
function canDeleteProject(project: Project): boolean {
  if (project.organization_role === null) return true // legacy: treated as owner
  return project.organization_role === 'owner' || project.organization_role === 'admin'
}

const LINK_CHIP_CLASS =
  'inline-flex items-center justify-center px-2 py-1 text-xs font-medium rounded-sm gap-1.5 ' +
  'border border-edge text-fg-secondary hover:bg-surface-overlay hover:text-fg ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'motion-safe:transition-colors motion-safe:duration-150'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Strip a `https://github.com/owner/repo` URL down to `owner/repo` so
 * the project row can render the repo without eating half the line.
 * Falls back to the raw URL when the host isn't GitHub-shaped, so
 * self-hosted GitLab / Gitea installs are still readable.
 */
function shortRepoLabel(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const trimmed = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '')
    return trimmed || u.host
  } catch {
    return url
  }
}

/**
 * Per-repo indexing freshness. The backend writes `last_indexed_at` on
 * every successful index pass and `last_index_error` on a failed one,
 * so we infer "ok / stale / failed / off / never" entirely from those.
 *
 * - `off` — indexing explicitly disabled (`indexing_enabled = false`).
 * - `failed` — last attempt errored (`last_index_error` set, no
 *   subsequent success).
 * - `stale` — no successful index in > 7 days.
 * - `ok` — indexed in the last 7 days.
 * - `never` — repo connected but never indexed (initial state).
 */
type IndexHealth = 'ok' | 'stale' | 'failed' | 'off' | 'never'

function indexHealth(repo: ProjectRepoLite): IndexHealth {
  if (!repo.indexing_enabled) return 'off'
  if (repo.last_index_error && (!repo.last_indexed_at ||
      (repo.last_index_attempt_at && new Date(repo.last_index_attempt_at) > new Date(repo.last_indexed_at)))) {
    return 'failed'
  }
  if (!repo.last_indexed_at) return 'never'
  const ageMs = Date.now() - new Date(repo.last_indexed_at).getTime()
  if (ageMs > 7 * 86_400_000) return 'stale'
  return 'ok'
}

const INDEX_HEALTH_LABEL: Record<IndexHealth, string> = {
  ok: 'Indexed',
  stale: 'Stale',
  failed: 'Failed',
  off: 'Off',
  never: 'Pending',
}

const INDEX_HEALTH_CHIP_TONE: Record<IndexHealth, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  ok: 'ok',
  stale: 'warn',
  failed: 'danger',
  off: 'neutral',
  never: 'neutral',
}

export function ProjectsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const copy = usePageCopy('/projects')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()

  const tabParam = searchParams.get('tab')
  const activeTab: ProjectsTabId = resolveProjectsTab(tabParam)
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const setTab = useCallback(
    (tab: ProjectsTabId) => {
      const next = new URLSearchParams(searchParams)
      if (tab === 'overview') next.delete('tab')
      else next.set('tab', tab)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const [newName, setNewName] = useState('')
  const [busyProject, setBusyProject] = useState<string | null>(null)
  const [revealedKeys, setRevealedKeys] = useState<
    Record<string, { key: string; scopes: string[] }>
  >({})
  /* SDK configurator open/closed state per project. The default is "open iff
     this row is the project we're currently viewing", but the user can
     manually toggle a row open or closed and that override should stick
     until they Switch to a different project (at which point the override
     map clears so the new active row auto-opens and the previously-active
     row auto-collapses). Tracking overrides explicitly — instead of letting
     <details> own its own state — is what lets us collapse the prior row
     on Switch without fighting the user's manual toggles in steady state. */
  const [sdkOpenOverride, setSdkOpenOverride] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setSdkOpenOverride({})
  }, [activeProjectId])
  // Per-project preset selection so multiple keys can be minted without
  // losing the user's last choice on rerender.
  const [keyScopePreset, setKeyScopePreset] = useState<Record<string, ScopePresetId>>({})

  // Delete-project flow (type-the-slug to confirm). `pendingDelete` holds the
  // project the user is currently confirming. The actual DELETE call lives
  // in `scheduleDeleteProject` and is deferred behind a `UNDO_WINDOW_MS`
  // toast — see the soft-delete state below.
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)

  // Inline rename state. Only one project can be in rename mode at a time —
  // a single id avoids an N-key map and keeps the affordance visually
  // singular (the user's mental model is "I'm editing this one"). Draft is
  // co-located so cancel restores the previous server name without an
  // extra round-trip.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Soft-delete state for project delete. After the type-the-slug confirm,
  // the actual DELETE call is deferred for `UNDO_WINDOW_MS` so the user
  // gets one last "wait, no" toast they can cancel from. The Set drives
  // optimistic row hiding; the Map keeps each scheduled timer addressable
  // by id so concurrent deletes don't race.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const deleteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Same shape for key-revoke. Indexed by `${projectId}:${keyId}` so a user
  // can revoke a key in one project while another project's revoke is
  // still in its undo window without the two interfering.
  const [pendingRevokeIds, setPendingRevokeIds] = useState<Set<string>>(new Set())
  const revokeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Key-revoke confirm (themed replacement for the old window.confirm()).
  // `pendingRevoke` holds {projectId, keyId, prefix} of the key being
  // confirmed for revocation. Kept lightweight on purpose — keys are easy
  // to re-mint, so this is a single "Are you sure?" not a type-to-confirm.
  // The actual DELETE is deferred behind an undo toast — see
  // `scheduleRevokeKey` below.
  const [pendingRevoke, setPendingRevoke] = useState<
    | { projectId: string; keyId: string; keyPrefix: string }
    | null
  >(null)

  const { data, loading, error, reload, lastFetchedAt, isValidating } = usePageData<{ projects: Project[]; admin_host: string | null }>(
    '/v1/admin/projects',
    { scope: 'enumeration' },
  )
  const { data: statsData, reload: reloadStats, lastFetchedAt: statsFetchedAt, isValidating: statsValidating } = usePageData<ProjectsStats>(
    '/v1/admin/projects/stats',
    { scope: 'enumeration' },
  )
  const activeOrgId = useActiveOrgId()
  const { data: orgData } = usePageData<{ organizations: OrganizationSummary[] }>('/v1/org', {
    scope: 'none',
  })
  const activeOrg = orgData?.organizations?.find((o) => o.id === activeOrgId) ?? null
  const activeTeamName = activeOrg?.name ?? null
  const activeOrgRole = activeOrg?.role ?? null
  const stats = { ...EMPTY_PROJECTS_STATS, ...statsData }
  const fetchedAt = statsFetchedAt ?? lastFetchedAt
  const validating = isValidating || statsValidating

  const reloadAll = useCallback(() => {
    reload()
    reloadStats()
  }, [reload, reloadStats])

  useRealtimeReload(['projects', 'project_api_keys', 'reports'], reloadAll)
  // Hide rows that the user is currently undoing — they're already
  // pretending to be deleted from the user's POV. If the timer fires and
  // the DELETE succeeds, the next reload drops them for real; if the user
  // hits Undo, `cancelScheduledDelete` restores them.
  const projects = useMemo(
    () => (data?.projects ?? []).filter((p) => !pendingDeleteIds.has(p.id)),
    [data, pendingDeleteIds],
  )
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  )
  // Captured once per response and threaded into every SdkHealthSummary so
  // each card can compare the SDK's last-seen endpoint against the host
  // THIS admin reads from. Mismatch = silent backend split = the bug class
  // we're surfacing here.
  const adminHost = data?.admin_host ?? null

  usePublishPageContext({
    route: '/projects',
    title: `${activeMeta.label} · Projects`,
    summary: activeMeta.description,
    filters: { tab: activeTab, active_project_id: activeProjectId ?? undefined },
    criticalCount:
      stats.topPriority === 'healthy'
        ? 0
        : stats.topPriority === 'partial_ingest'
          ? stats.neverIngestedCount
          : 1,
  })

  const canManageProjects = canCreateProject(activeOrgRole)
  const roleHint = viewerRoleHint(activeOrgRole)

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      { id: 'list' as const, label: 'Your projects', count: stats.projectCount || undefined },
      ...(canManageProjects ? [{ id: 'create' as const, label: 'New project' }] : []),
    ],
    [stats.projectCount, canManageProjects],
  )

  const {
    create: createProjectRaw,
    creating,
    error: createError,
    clearError: clearCreateError,
  } = useCreateProject({
    onCreated: () => {
      setNewName('')
      reloadAll()
      setTab('list')
    },
  })

  const { update: updateProject, updating: renamingProject } = useUpdateProject({
    onUpdated: () => {
      setRenamingId(null)
      setRenameDraft('')
      reload()
    },
  })

  async function createProject() {
    await createProjectRaw(newName)
  }

  function startRename(project: Project) {
    setRenamingId(project.id)
    setRenameDraft(project.name)
  }

  function cancelRename() {
    if (renamingProject) return
    setRenamingId(null)
    setRenameDraft('')
  }

  async function submitRename(projectId: string) {
    const next = renameDraft.trim()
    if (!next || next === projects.find((p) => p.id === projectId)?.name) {
      cancelRename()
      return
    }
    await updateProject(projectId, next)
  }

  async function generateKey(projectId: string) {
    const presetId = keyScopePreset[projectId] ?? 'sdk'
    const preset = SCOPE_PRESETS.find((p) => p.id === presetId) ?? SCOPE_PRESETS[0]
    setBusyProject(projectId)
    try {
      const res = await apiFetch<{ key: string; prefix: string; scopes: string[] }>(
        `/v1/admin/projects/${projectId}/keys`,
        {
          method: 'POST',
          body: JSON.stringify({ scopes: preset.scopes }),
        },
      )
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed to generate key')
      const key = res.data?.key
      const scopes = res.data?.scopes ?? preset.scopes
      if (key) {
        setRevealedKeys((prev) => ({ ...prev, [projectId]: { key, scopes } }))
        try {
          await navigator.clipboard.writeText(key)
          toast.success(
            `${preset.label} key copied to clipboard`,
            'It will not be shown again — store it in your secrets manager.',
          )
        } catch {
          toast.success(
            `${preset.label} key generated`,
            'Copy it now — it will not be shown again.',
          )
        }
      }
      reload()
    } catch (err) {
      toast.error('Failed to generate key', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyProject(null)
    }
  }

  // Cancel any in-flight delete / revoke timers when the page unmounts.
  // Without this, navigating away after clicking Delete and *before* the
  // 8 s timer fires would still drop the project on the next tick — with
  // no toast left to undo from. Capturing the ref values lets the cleanup
  // function run with the same map identity React saw at effect setup.
  useEffect(() => {
    const dTimers = deleteTimers.current
    const rTimers = revokeTimers.current
    return () => {
      dTimers.forEach((t) => clearTimeout(t))
      dTimers.clear()
      rTimers.forEach((t) => clearTimeout(t))
      rTimers.clear()
    }
  }, [])

  // Open the themed revoke modal. Kept as a thin wrapper so the row's
  // Revoke button doesn't need to know about modal state.
  function requestRevokeKey(projectId: string, keyId: string, keyPrefix: string) {
    setPendingRevoke({ projectId, keyId, keyPrefix })
  }

  function cancelScheduledRevoke(projectId: string, keyId: string) {
    const composite = `${projectId}:${keyId}`
    const timer = revokeTimers.current.get(composite)
    if (timer) clearTimeout(timer)
    revokeTimers.current.delete(composite)
    setPendingRevokeIds((prev) => {
      if (!prev.has(composite)) return prev
      const next = new Set(prev)
      next.delete(composite)
      return next
    })
  }

  function scheduleRevokeKey() {
    if (!pendingRevoke) return
    const { projectId, keyId, keyPrefix } = pendingRevoke
    const composite = `${projectId}:${keyId}`

    // Optimistically hide the key. The toast becomes the user's only
    // affordance for the next 8 s.
    setPendingRevokeIds((prev) => new Set(prev).add(composite))
    setPendingRevoke(null)

    const timer = setTimeout(async () => {
      revokeTimers.current.delete(composite)
      const res = await apiFetch(`/v1/admin/projects/${projectId}/keys/${keyId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        // Restore the row so the user can retry. Surface the server's
        // verbatim error since revoke failures are usually permission-
        // shaped ("only owners can revoke this kind of key").
        setPendingRevokeIds((prev) => {
          const next = new Set(prev)
          next.delete(composite)
          return next
        })
        toast.error('Failed to revoke key', res.error?.message)
        return
      }
      setPendingRevokeIds((prev) => {
        const next = new Set(prev)
        next.delete(composite)
        return next
      })
      reload()
    }, UNDO_WINDOW_MS)
    revokeTimers.current.set(composite, timer)

    toast.push({
      tone: 'success',
      title: 'API key revoked',
      description: `${keyPrefix}… will stop working in a few seconds.`,
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => cancelScheduledRevoke(projectId, keyId),
      },
    })
  }

  function cancelScheduledDelete(projectId: string) {
    const timer = deleteTimers.current.get(projectId)
    if (timer) clearTimeout(timer)
    deleteTimers.current.delete(projectId)
    setPendingDeleteIds((prev) => {
      if (!prev.has(projectId)) return prev
      const next = new Set(prev)
      next.delete(projectId)
      return next
    })
  }

  // Project deletion with undo window. Backend mirrors authorization
  // (owner/admin only) and verifies confirm_slug, but we send it from the
  // FE too so an attacker who tampers with the modal can't delete a
  // different project than the one they actually typed. The DELETE call
  // itself is deferred so the user has a last-chance Undo even after
  // typing the slug — type-the-slug confirms intent, undo recovers from
  // the post-confirm "wait, no" reaction.
  function scheduleDeleteProject() {
    if (!pendingDelete) return
    const project = pendingDelete

    // Optimistically hide the row and clear the modal so the user can see
    // the toast's countdown without the danger UI lingering on screen.
    setPendingDeleteIds((prev) => new Set(prev).add(project.id))
    setPendingDelete(null)

    // If the just-marked-deleted project was the active one in the switcher,
    // clear it so subsequent navigations don't keep filtering by a dead id.
    // We do this eagerly (rather than waiting for the DELETE to land) so
    // the rest of the chrome reads as "no project selected" during the
    // undo window — otherwise the header pill would still claim to be
    // viewing a project the user just deleted.
    try {
      if (window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) === project.id) {
        window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
      }
    } catch {
      // localStorage might be disabled in private browsing — non-fatal.
    }
    const nextParams = new URLSearchParams(searchParams)
    if (nextParams.get(ACTIVE_PROJECT_QUERY_PARAM) === project.id) {
      nextParams.delete(ACTIVE_PROJECT_QUERY_PARAM)
      setSearchParams(nextParams, { replace: true })
    }

    const timer = setTimeout(async () => {
      deleteTimers.current.delete(project.id)
      const res = await apiFetch<{ id: string; slug: string; name: string }>(
        `/v1/admin/projects/${project.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ confirm_slug: project.slug }),
        },
      )
      if (!res.ok) {
        // Restore the row so the user can retry. The active-project
        // localStorage clear is intentionally NOT undone — the user's
        // intent was to leave that project anyway, and switching context
        // back automatically would mask the failure.
        setPendingDeleteIds((prev) => {
          const next = new Set(prev)
          next.delete(project.id)
          return next
        })
        toast.error(
          `Failed to delete ${project.name}`,
          res.error?.message,
        )
        return
      }
      setPendingDeleteIds((prev) => {
        const next = new Set(prev)
        next.delete(project.id)
        return next
      })
      reload()
    }, UNDO_WINDOW_MS)
    deleteTimers.current.set(project.id, timer)

    toast.push({
      tone: 'success',
      title: `Deleted ${project.name}`,
      description: 'Reports, fixes, keys, and integrations will be removed in a few seconds.',
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => cancelScheduledDelete(project.id),
      },
    })
  }

  async function sendTestReport(projectId: string, name: string) {
    setBusyProject(projectId)
    try {
      const res = await apiFetch(`/v1/admin/projects/${projectId}/test-report`, { method: 'POST' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Test report failed')
      toast.success(
        `Test report queued for ${name}`,
        'Watch /reports for it to land in the next ~10s.',
      )
    } catch (err) {
      toast.error('Could not send test report', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyProject(null)
    }
  }

  function setActive(projectId: string, name: string) {
    setActiveProjectIdSnapshot(projectId)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_PROJECT_QUERY_PARAM, projectId)
    setSearchParams(next, { replace: true })
    toast.success(`Now viewing ${name}`)
  }

  if (loading)
    return <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading projects" />
  if (error) return <ErrorAlert message={`Failed to load projects: ${error}`} onRetry={reloadAll} />

  const createForm = (
    <div className="space-y-2">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            label="Project name"
            helpId="projects.create_project"
            type="text"
            placeholder="New project name (e.g. Acme iOS app)"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              if (createError) clearCreateError()
            }}
            onKeyDown={(e) => e.key === 'Enter' && createProject()}
            aria-invalid={createError ? true : undefined}
            aria-describedby={createError ? 'projects-create-error' : undefined}
          />
        </div>
        <Btn
          onClick={createProject}
          disabled={creating || !newName.trim() || !canManageProjects}
          title={
            !canManageProjects
              ? (roleHint ?? 'You cannot create projects in this team')
              : !newName.trim()
                ? 'Enter a project name to continue'
                : undefined
          }
        >
          {creating ? 'Creating...' : 'Create project'}
        </Btn>
      </div>
      {createError && (
        <div id="projects-create-error">
          <ErrorAlert
            title={
              createError.code === 'NO_ORGANIZATION'
                ? 'No writable team found'
                : createError.code === 'FORBIDDEN'
                ? 'Not allowed in this team'
                : createError.code === 'NETWORK_ERROR'
                ? 'Couldn\u2019t reach the server'
                : 'Couldn\u2019t create project'
            }
            message={createError.message}
            code={createError.code}
            actions={(() => {
              if (createError.code === 'NO_ORGANIZATION') {
                return [
                  { label: 'Open team settings', onClick: () => navigate('/organization/members') },
                  { label: 'Dismiss', onClick: clearCreateError },
                ]
              }
              if (createError.code === 'FORBIDDEN') {
                return [
                  { label: 'Switch team', onClick: () => navigate('/organization/members') },
                  { label: 'Dismiss', onClick: clearCreateError },
                ]
              }
              if (createError.code === 'NETWORK_ERROR') {
                return [
                  { label: 'Try again', onClick: () => void createProjectRaw(newName) },
                  { label: 'Dismiss', onClick: clearCreateError },
                ]
              }
              return [{ label: 'Dismiss', onClick: clearCreateError }]
            })()}
          />
        </div>
      )}
    </div>
  )

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    stats.topPriority === 'never_ingested' || stats.topPriority === 'no_sdk_heartbeat'
      ? 'warn'
      : stats.topPriority === 'healthy'
        ? 'ok'
        : stats.topPriority === 'no_projects'
          ? 'brand'
          : stats.topPriority === 'partial_ingest'
            ? 'info'
            : 'neutral'

  const headerBadge =
    stats.topPriority === 'healthy'
      ? 'INGESTING'
      : stats.topPriority === 'never_ingested'
        ? 'NO INGEST'
        : stats.topPriority === 'no_sdk_heartbeat'
          ? 'NO HEARTBEAT'
        : stats.topPriority === 'partial_ingest'
          ? `${stats.neverIngestedCount} STALE`
          : stats.projectCount === 0
            ? 'EMPTY'
            : 'SETUP'

  return (
    <div className="space-y-4" data-testid="mushi-page-projects">
      <PageHeader
        title={copy?.title ?? 'Projects'}
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'warn'
                ? 'bg-warn-muted text-warning-foreground'
                : bannerSeverity === 'brand'
                  ? 'bg-brand-subtle text-brand'
                  : bannerSeverity === 'info'
                    ? 'bg-info-muted text-info-foreground'
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {headerBadge}
        </Badge>
        <FreshnessPill at={fetchedAt} isValidating={validating} />
        <Btn variant="ghost" size="sm" onClick={reloadAll} loading={validating}>
          Refresh
        </Btn>
      </PageHeader>
      <PageScopeHint text={copy?.description ?? "Banner + PROJECTS SNAPSHOT — Overview for posture, Your projects to mint keys and verify ingest."} />

      <ProjectsStatusBanner
        stats={stats}
        activeTeamName={activeTeamName}
        roleHint={roleHint}
        onTab={setTab}
        onRefresh={reloadAll}
        refreshing={validating}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setTab}
        options={tabOptions}
        ariaLabel="Projects sections"
        size="sm"
      />

      <Section title="PROJECTS SNAPSHOT" freshness={{ at: fetchedAt, isValidating: validating }}>
        <SnapshotSectionHint text={activeMeta.description} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Projects"
            value={stats.projectCount}
            accent={stats.projectCount > 0 ? 'text-brand' : undefined}
            hint="Apps or environments tracked"
          />
          <StatCard
            label="Ingesting"
            value={stats.projectsWithReports}
            accent={stats.projectsWithReports > 0 ? 'text-ok' : 'text-warn'}
            hint={`${stats.neverIngestedCount} never received a report`}
          />
          <StatCard
            label="SDK connected"
            value={stats.sdkConnectedCount}
            accent={
              stats.sdkConnectedCount > 0
                ? 'text-ok'
                : stats.projectsWithReports > 0
                  ? 'text-warn'
                  : undefined
            }
            hint="Projects with key heartbeat"
          />
          <StatCard
            label="Active keys"
            value={stats.activeKeyCount}
            accent={stats.activeKeyCount > 0 ? 'text-info' : undefined}
            hint={`${stats.staleKeyCount} never seen`}
          />
          <StatCard
            label="Reports · 24h"
            value={stats.reportsLast24h}
            accent={stats.reportsLast24h > 0 ? 'text-ok' : undefined}
            hint={`${stats.reportsLast30d} in 30 days`}
          />
          <StatCard
            label="Viewing"
            value={stats.activeProjectName ? 'Set' : 'None'}
            accent={stats.activeProjectId ? 'text-brand' : undefined}
            hint={
              stats.activeProjectHasReports
                ? stats.activeProjectSdkConnected
                  ? 'Active project ingesting'
                  : 'Active project — no heartbeat'
                : 'Pick a project on list tab'
            }
          />
        </div>
      </Section>

      {stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'never_ingested' || stats.topPriority === 'no_sdk_heartbeat'
              ? 'border-warn/30'
              : stats.topPriority === 'no_projects'
                ? 'border-brand/30'
                : 'border-info/30'
          }`}
        >
          <SignalChip
            tone={
              stats.topPriority === 'never_ingested' || stats.topPriority === 'no_sdk_heartbeat'
                ? 'warn'
                : stats.topPriority === 'no_projects'
                  ? 'brand'
                  : 'info'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone="info">
            <p className="text-xs font-medium leading-snug text-fg">{stats.topPriorityLabel}</p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill to={stats.topPriorityTo} tone="brand">
              Take action →
            </ActionPill>
          </ActionPillRow>
        </Card>
      ) : null}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <PageHelp
            title={copy?.help?.title ?? 'About projects'}
            whatIsIt={
              copy?.help?.whatIsIt ??
              'A project is a container for one app or environment. Everything in Mushi — bugs, fixes, reports, integrations — belongs to a project.'
            }
            useCases={
              copy?.help?.useCases ?? [
                'Create a project for your main app (takes 30 seconds)',
                "Add a separate project for staging so test bugs don't mix with real ones",
                'Generate an API key, send a test report, and confirm SDK heartbeat before production',
              ]
            }
            howToUse={
              copy?.help?.howToUse ??
              'Use Your projects to switch context, mint keys, and read per-project health. The banner and KPI strip tell you which projects ingest and which keys have connected.'
            }
          />
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="All projects ingesting"
              description={stats.topPriorityLabel ?? `${stats.projectCount} projects with recent reports.`}
              cta={{ label: 'Open Reports', to: '/reports' }}
            />
          )}
          {stats.topPriority === 'no_projects' && (
            <RecommendedAction
              tone="info"
              title="Create your first project"
              description={stats.topPriorityLabel ?? 'One project per app or environment.'}
              cta={{ label: 'New project', to: '/projects?tab=create' }}
            />
          )}
          {stats.topPriority === 'never_ingested' && (
            <RecommendedAction
              tone="urgent"
              title="Send a test report"
              description={stats.topPriorityLabel ?? 'Mint a key and use Test report on a project card.'}
              cta={{ label: 'Open project list', to: '/projects?tab=list' }}
            />
          )}
          {stats.topPriority === 'no_sdk_heartbeat' && (
            <RecommendedAction
              tone="urgent"
              title="Debug SDK heartbeat"
              description={stats.topPriorityLabel ?? 'Expand a project card and compare endpoint host vs this admin.'}
              cta={{ label: 'View projects', to: '/projects?tab=list' }}
            />
          )}
          {stats.topPriority === 'partial_ingest' && (
            <RecommendedAction
              tone="info"
              title="Some projects never ingested"
              description={stats.topPriorityLabel ?? `${stats.neverIngestedCount} projects waiting for first report.`}
              cta={{ label: 'View projects', to: '/projects?tab=list' }}
            />
          )}
          <div className="overflow-hidden rounded-md border border-edge-subtle bg-surface-raised">
            <div className="grid grid-cols-1 gap-px bg-edge-subtle sm:grid-cols-3">
              <div className="bg-surface-raised p-3">
                <SignalChip tone="ok" className="uppercase tracking-wide">Ingest coverage</SignalChip>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ok">
                  {stats.projectCount > 0
                    ? `${Math.round((stats.projectsWithReports / stats.projectCount) * 100)}%`
                    : '—'}
                </p>
                <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0 text-2xs">
                  {stats.projectsWithReports}/{stats.projectCount} projects with reports
                </InlineProof>
              </div>
              <div className="bg-surface-raised p-3">
                <SignalChip tone="info" className="uppercase tracking-wide">SDK heartbeats</SignalChip>
                <p className="mt-1 text-lg font-semibold tabular-nums text-info">{stats.sdkConnectedCount}</p>
                <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0 text-2xs">
                  {stats.staleKeyCount} active keys never seen
                </InlineProof>
              </div>
              <div className="bg-surface-raised p-3">
                <SignalChip tone="brand" className="uppercase tracking-wide">Active context</SignalChip>
                <p className="mt-1 text-sm font-semibold text-fg-primary truncate">
                  {stats.activeProjectName ?? 'None selected'}
                </p>
                <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0 text-2xs">
                  {stats.activeProjectId
                    ? stats.activeProjectHasReports
                      ? 'Receiving reports'
                      : 'No reports yet'
                    : 'Switch on list tab'}
                </InlineProof>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'create' ? (
        <Section title="Create a project">
          <ContainedBlock tone="muted" className="mb-3">
            <p className="text-2xs leading-relaxed text-fg-muted">
              One project per app or environment — you&apos;ll get API keys and a scoped inbox on the next screen.
            </p>
          </ContainedBlock>
          {createForm}
          <PageHelp
            title={copy?.help?.title ?? 'About projects'}
            whatIsIt={copy?.help?.whatIsIt ?? ''}
            useCases={copy?.help?.useCases ?? []}
            howToUse={copy?.help?.howToUse ?? ''}
          />
        </Section>
      ) : activeTab === 'list' ? (
        <Section title="Your projects">
          {activeProjectId && (
            <MigrationsInProgressCard
              projectId={activeProjectId}
              title="Migrations in this project"
            />
          )}

          {projects.length === 0 ? (
            <EmptyState
              icon={<HeroPlugIntegration />}
              title="No projects yet"
              description="Switch to the New project tab to create your first project — you'll get an API key for the SDK or REST endpoint."
              action={
                <Btn size="sm" onClick={() => setTab('create')}>
                  New project
                </Btn>
              }
            />
          ) : (
            <div className="flex min-h-0 flex-col lg:flex-row lg:items-start lg:rounded-md lg:border lg:border-edge-subtle">
              <ProjectFolderTabRail
                projects={projects}
                activeId={selectedProject?.id ?? null}
                onSelect={setActive}
              />
              <div
                className="min-w-0 flex-1 lg:border-l lg:border-edge-subtle lg:bg-surface-raised"
                role="tabpanel"
                aria-label={selectedProject ? `Details for ${selectedProject.name}` : 'Project details'}
              >
                {selectedProject && (() => {
            const project = selectedProject
            const isBusy = busyProject === project.id
            const revealed = revealedKeys[project.id]
            return (
              <Card key={project.id} className="overflow-hidden rounded-none border-0 p-0 shadow-none lg:min-h-full">
                <div className="flex flex-col gap-2 border-b border-edge-subtle bg-surface-raised px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {renamingId === project.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            void submitRename(project.id)
                          }}
                          className="flex items-center gap-1.5"
                        >
                          {/* Native <input> instead of the labelled <Input>
                              primitive because we're editing inline next
                              to the project header — a labelled field
                              would shove the row's metadata down a line
                              and break the scannable card silhouette. */}
                          <input
                            autoFocus
                            type="text"
                            value={renameDraft}
                            maxLength={120}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelRename()
                              }
                            }}
                            disabled={renamingProject}
                            aria-label={`Rename ${project.name}`}
                            className="rounded-sm border border-edge bg-surface-root px-2 py-1 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-60"
                          />
                          <Btn
                            type="submit"
                            size="sm"
                            disabled={
                              renamingProject ||
                              !renameDraft.trim() ||
                              renameDraft.trim() === project.name
                            }
                            loading={renamingProject}
                            aria-label="Save project name"
                            title="Save project name"
                            className="px-2"
                          >
                            <IconCheck />
                          </Btn>
                          <Btn
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={cancelRename}
                            disabled={renamingProject}
                            aria-label="Cancel rename"
                            title="Cancel"
                            className="px-2"
                          >
                            <IconClose />
                          </Btn>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <ProjectFavicon
                            project_id={project.id}
                            project_name={project.name}
                            project_slug={project.slug}
                            sdk_origin={sdkOriginFromApiKeys(project.api_keys)}
                            size={16}
                          />
                          <h3 className="truncate text-base font-semibold text-fg">{project.name}</h3>
                        </div>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <span title="Reports, Fixes, Dashboard, and other pages are filtered to this project.">
                          <SignalChip tone="brand" className="normal-case tracking-normal">
                            Active
                          </SignalChip>
                        </span>
                        <ConfigHelp helpId="projects.active_project" />
                      </span>
                      <SignalChip tone="neutral" className="font-mono text-2xs">
                        {project.slug}
                      </SignalChip>
                      {project.pdca_bottleneck && project.pdca_bottleneck_label && (
                        <Link
                          to={bottleneckDeepLink(project.pdca_bottleneck, project.id)}
                          className={`inline-flex max-w-full min-w-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-2xs font-medium hover:opacity-90 motion-safe:transition-opacity ${PDCA_BOTTLENECK_TONE[project.pdca_bottleneck]}`}
                          title={`${project.pdca_bottleneck_label} — jump to this PDCA stage`}
                        >
                          <span className="shrink-0 font-mono uppercase">{project.pdca_bottleneck}</span>
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
                    {canDeleteProject(project) && renamingId !== project.id && (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => startRename(project)}
                        disabled={isBusy || renamingProject}
                        aria-label={`Rename ${project.name}`}
                        title={`Rename ${project.name}. Doesn't change the project slug or any URLs.`}
                        className="px-2"
                      >
                        <IconPencil />
                      </Btn>
                    )}
                    <Tooltip content="Reports">
                      <Link
                        to={`/reports?project=${project.id}`}
                        className={LINK_CHIP_CLASS}
                        aria-label={`Reports for ${project.name}`}
                      >
                        <IconReports />
                      </Link>
                    </Tooltip>
                    <Tooltip content="Integrations">
                      <Link
                        to={`/integrations/config?project=${project.id}`}
                        className={LINK_CHIP_CLASS}
                        aria-label={`Integrations for ${project.name}`}
                      >
                        <IconIntegrations />
                      </Link>
                    </Tooltip>
                    <Tooltip content="Settings">
                      <Link
                        to={`/settings?project=${project.id}`}
                        className={LINK_CHIP_CLASS}
                        aria-label={`Settings for ${project.name}`}
                      >
                        <IconSettings />
                      </Link>
                    </Tooltip>
                    <Tooltip content="Send test report (ingest only — does not mark SDK installed)">
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => sendTestReport(project.id, project.name)}
                        disabled={isBusy}
                        aria-label={`Send test report for ${project.name}`}
                        className="px-2"
                      >
                        <IconSend />
                      </Btn>
                    </Tooltip>
                    <div className="flex items-center gap-1" data-testid={`mint-key-${project.id}`}>
                      <label htmlFor={`key-scope-${project.id}`} className="sr-only">
                        API key scope for {project.name}
                      </label>
                      <ConfigHelp helpId="projects.api_key_scope" />
                      <select
                        id={`key-scope-${project.id}`}
                        data-testid={`key-scope-${project.id}`}
                        className="text-2xs bg-surface-raised border border-edge rounded-sm px-2 py-1 text-fg-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                        value={keyScopePreset[project.id] ?? 'sdk'}
                        onChange={(e) =>
                          setKeyScopePreset((prev) => ({
                            ...prev,
                            [project.id]: e.target.value as ScopePresetId,
                          }))
                        }
                        disabled={isBusy}
                        title={
                          SCOPE_PRESETS.find((p) => p.id === (keyScopePreset[project.id] ?? 'sdk'))
                            ?.hint
                        }
                      >
                        {SCOPE_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                      <Tooltip content="Generate API key">
                        <Btn
                          variant="ghost"
                          size="sm"
                          onClick={() => generateKey(project.id)}
                          disabled={isBusy}
                          loading={isBusy}
                          data-testid={`generate-key-${project.id}`}
                          aria-label={`Generate API key for ${project.name}`}
                          className="px-2"
                        >
                          <IconKey />
                        </Btn>
                      </Tooltip>
                    </div>
                    {/* Destructive last in tab order on purpose. Gated to
                        org owner/admin (or legacy direct owner). Members and
                        viewers don't see the button at all so they can't
                        even attempt the action — backend mirrors this with
                        a 403, but hiding it is better UX than letting them
                        click and bounce. */}
                    {canDeleteProject(project) && (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(project)}
                        disabled={isBusy}
                        data-testid={`delete-project-${project.id}`}
                        aria-label={`Delete ${project.name}`}
                        // Inline danger tone — only flips on hover so the
                        // row's neutral chrome stays calm at rest.
                        className="px-2 text-fg-secondary hover:text-danger hover:bg-danger-muted/15 hover:border-danger/30"
                        title={`Delete ${project.name} and every report, key, and integration tied to it. You'll get an Undo window.`}
                      >
                        <IconTrash />
                      </Btn>
                    )}
                  </div>
                </div>

                <div className="space-y-3 px-3 py-3">
                  <ProjectMetricsRail project={project} />
                  <ProjectContextRail project={project} />
                </div>

                {revealed && (
                  <div className="px-3 pb-3">
                    <RevealedKeyCard
                      projectId={project.id}
                      projectName={project.name}
                      projectSlug={project.slug}
                      apiKey={revealed.key}
                      scopes={revealed.scopes}
                      onDismiss={() =>
                        setRevealedKeys((prev) => {
                          const { [project.id]: _, ...rest } = prev
                          return rest
                        })
                      }
                    />
                  </div>
                )}

                {/* SDK CONNECTIVITY HEALTH — primary diagnostic surface for
                    "I generated a key 4 days ago, why am I seeing 0 reports?"
                    Renders only when at least one key exists, since pre-key
                    state already has the "Generate key" CTA above; before
                    that the card would just say "no key" and double up. */}
                {project.api_keys.length > 0 && (
                  <div className="px-3 pb-3 space-y-3">
                    <SdkHealthSummary
                      projectId={project.id}
                      projectName={project.name}
                      projectSlug={project.slug}
                      apiKeys={project.api_keys}
                      lastReportAt={project.last_report_at}
                      adminHost={adminHost}
                      reportCount={project.report_count}
                      compact
                      onTestReportSent={reload}
                    />
                    {project.sdk_status && project.sdk_version && (
                      <SdkUpgradeCTA
                        status={project.sdk_status}
                        package_={project.sdk_package ?? null}
                        observedVersion={project.sdk_version}
                        latestVersion={project.sdk_latest_version ?? null}
                        stackLabel={project.slug}
                        compact
                        projectId={project.primary_repo ? project.id : null}
                      />
                    )}
                    <VerifySetupPanel
                      projectId={project.id}
                      projectName={project.name}
                      adminHost={adminHost}
                      compact
                    />
                  </div>
                )}

                {project.api_keys.length > 0 && (() => {
                  // Hide keys that are mid-revoke (in their undo window) so
                  // the row reads as if the action already succeeded. The
                  // active count likewise drops by the number of pending
                  // revokes — otherwise the disclosure header lies about
                  // how many keys are live.
                  const visibleKeys = project.api_keys.filter(
                    (k) => !pendingRevokeIds.has(`${project.id}:${k.id}`),
                  )
                  if (visibleKeys.length === 0) return null
                  const visibleActiveCount = visibleKeys.filter(
                    (k) => !k.revoked,
                  ).length
                  return (
                    <details className="mx-3 mb-3 mt-0 border-t border-edge-subtle pt-2">
                      <summary className="cursor-pointer select-none list-none">
                        <span title={`${visibleKeys.length} keys · ${visibleActiveCount} active`}>
                          <SignalChip tone="neutral" className="hover:text-fg">
                            Keys ({visibleActiveCount})
                          </SignalChip>
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1">
                        {visibleKeys.map((key) => (
                          <div
                            key={key.id}
                            className="flex items-center justify-between text-2xs gap-2"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <SignalChip
                                tone={key.revoked ? 'neutral' : 'brand'}
                                className={`font-mono ${key.revoked ? 'line-through opacity-60' : ''}`}
                              >
                                {key.key_prefix}…
                              </SignalChip>
                              {(key.scopes ?? []).map((s) => (
                                <Badge key={s} className={scopeBadgeTone(s)}>
                                  {s}
                                </Badge>
                              ))}
                              <InlineProof className="border-0 bg-transparent px-0 py-0 text-2xs">
                                created {relativeTime(key.created_at)}
                              </InlineProof>
                              {key.revoked && (
                                <Badge className="bg-surface-overlay text-fg-faint">revoked</Badge>
                              )}
                            </div>
                            {!key.revoked && (
                              <Btn
                                variant="ghost"
                                size="sm"
                                onClick={() => requestRevokeKey(project.id, key.id, key.key_prefix)}
                                aria-label={`Revoke key ${key.key_prefix}`}
                                title={`Revoke key starting with ${key.key_prefix}…. You'll get an Undo window.`}
                                className="px-2 text-fg-secondary hover:text-danger hover:bg-danger-muted/15"
                              >
                                <IconTrash />
                              </Btn>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                })()}

                {/* Per-project SDK CONFIGURATOR + install snippet. Stays
                    collapsed by default so the row remains scannable when
                    the user is just managing keys, but the disclosure
                    header is now full-width with an icon + descriptive
                    sub-line so the eye actually catches it (the previous
                    tiny "SDK install snippet" link looked identical to
                    the keys row above and was getting missed). */}
                {/* SDK configurator defaults open in the folder-tab panel.
                    Override map clears when activeProjectId changes so tab
                    switches reset manual collapse state. */}
                <details
                  className="mt-3 border-t border-edge-subtle px-3 pt-3 group"
                  data-testid={`sdk-configurator-${project.id}`}
                  open={sdkOpenOverride[project.id] ?? true}
                  onToggle={(e) => {
                    const nextOpen = (e.currentTarget as HTMLDetailsElement).open
                    setSdkOpenOverride((prev) => {
                      if (nextOpen === true && !(project.id in prev)) return prev
                      return { ...prev, [project.id]: nextOpen }
                    })
                  }}
                >
                  <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 px-2 py-1.5 -mx-2 rounded-sm hover:bg-surface-overlay transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true" className="text-fg-muted text-xs">
                        {'\u{1F41B}'}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-fg">
                          Preview, configure & install the SDK widget
                        </div>
                        <div className="text-2xs">
                          <InlineProof className="border-0 bg-transparent px-0 py-0">
                            Live mock preview · 4-corner position picker · theme · capture flags · auto-updating snippet
                          </InlineProof>
                        </div>
                      </div>
                    </div>
                    <span
                      aria-hidden="true"
                      className="text-2xs text-fg-faint group-open:rotate-90 motion-safe:transition-transform"
                    >
                      ›
                    </span>
                  </summary>
                  <div className="mt-3">
                    {/* Pass `revealed?.key` so the snippet shows the real,
                        just-minted plaintext key instead of the `mushi_xxx`
                        placeholder. `revealed` is the same value the
                        RevealedKeyCard above uses, so the user can copy the
                        snippet without manually replacing a placeholder
                        whose actual value is sitting on screen literally
                        inches above. Once the user dismisses the reveal
                        (or reloads), `revealed` becomes undefined and the
                        card cleanly falls back to the placeholder — which
                        is what we want, since we don't persist plaintext. */}
                    <SdkInstallCard projectId={project.id} apiKey={revealed?.key} compact />
                  </div>
                </details>
              </Card>
            )
          })()}
              </div>
            </div>
          )}
        </Section>
      ) : null}

      {/* Type-the-slug-to-confirm modal for project deletion. Cascades
          take care of every dependent table (54 rows in the FK graph as
          of 2026-04-28: reports, comments, fix_attempts, api_keys, etc.).
          The list of consequences shows live counts so the user knows
          how much is on the line — vague warnings underweight the
          decision in dogfooding. */}
      {pendingDelete && (
        <DangerConfirm
          open={true}
          title={`Delete ${pendingDelete.name}?`}
          body="This permanently removes the project and every piece of data attached to it. This cannot be undone."
          consequences={[
            `${pluralizeWithCount(pendingDelete.report_count, 'report')} (and every comment, attachment, and fix attempt on them)`,
            `${pluralizeWithCount(pendingDelete.api_keys.length, 'API key')} (active and revoked)`,
            `${pluralizeWithCount(pendingDelete.member_count, 'project member')} role mapping`,
            'All integrations, settings, repo links, and per-project billing rows',
          ]}
          requiredText={pendingDelete.slug}
          inputLabel={`To confirm, type the project slug "${pendingDelete.slug}" below`}
          confirmLabel={`Delete ${pendingDelete.name}`}
          onConfirm={scheduleDeleteProject}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* Themed key-revoke confirm. Replaces window.confirm() so the
          dialog matches the rest of the app and is reachable from
          Playwright (the native dialog isn't part of the page DOM). */}
      {pendingRevoke && (
        <ConfirmDialog
          title="Revoke this API key?"
          body={`The key starting with ${pendingRevoke.keyPrefix}… will stop working after a short undo window. Any client still using it will start getting 401s. You can mint a replacement from the Generate key button after revoking.`}
          confirmLabel="Revoke key"
          cancelLabel="Keep key"
          tone="danger"
          onConfirm={scheduleRevokeKey}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </div>
  )
}

type MetricTone = 'reports' | 'keys' | 'members' | 'activity' | 'created' | 'sdk'

const METRIC_TONE: Record<
  MetricTone,
  { icon: string; value: string }
> = {
  reports: {
    icon: 'bg-info-muted text-info',
    value: 'text-info',
  },
  keys: {
    icon: 'bg-warn-muted text-warning-foreground',
    value: 'text-warn',
  },
  members: {
    icon: 'bg-brand-subtle text-brand',
    value: 'text-brand',
  },
  activity: {
    icon: 'bg-ok-muted text-ok',
    value: 'text-ok',
  },
  created: {
    icon: 'bg-surface-overlay text-fg-muted',
    value: 'text-fg',
  },
  sdk: {
    icon: 'bg-accent-muted text-accent-foreground',
    value: 'text-fg',
  },
}

/** Compact KPI strip — one row, color-accent values, dividers between tiles. */
function ProjectMetricsRail({ project }: { project: Project }) {
  const hasSdk = project.sdk_status && project.sdk_status !== 'unknown'

  return (
    <div className="overflow-hidden rounded-md border border-edge-subtle bg-surface-raised">
      <div
        className={`grid grid-cols-2 gap-px bg-edge-subtle sm:grid-cols-3 ${
          hasSdk ? 'lg:grid-cols-6' : 'lg:grid-cols-5'
        }`}
      >
        <MetricTile
          tone="reports"
          icon={<IconReports className="h-3.5 w-3.5" />}
          label="Reports"
          value={project.report_count.toLocaleString()}
        />
        <MetricTile
          tone="keys"
          icon={<IconKey className="h-3.5 w-3.5" />}
          label="Keys"
          value={String(project.active_key_count)}
          hint="Active API keys"
        />
        <MetricTile
          tone="members"
          icon={<IconUser className="h-3.5 w-3.5" />}
          label="Members"
          value={String(project.member_count)}
        />
        <MetricTile
          tone="activity"
          icon={<IconClock className="h-3.5 w-3.5" />}
          label="Last report"
          value={relativeTime(project.last_report_at)}
          title={project.last_report_at ? new Date(project.last_report_at).toLocaleString() : 'No reports yet'}
        />
        <MetricTile
          tone="created"
          icon={<IconClock className="h-3.5 w-3.5" />}
          label="Created"
          value={new Date(project.created_at).toLocaleDateString()}
        />
        {hasSdk && (
          <MetricTile
            tone="sdk"
            icon={<IconGauge className="h-3.5 w-3.5" />}
            label="SDK"
            value={
              <SdkVersionBadge
                status={project.sdk_status!}
                package_={project.sdk_package ?? null}
                observedVersion={project.sdk_version ?? null}
                latestVersion={project.sdk_latest_version ?? null}
                deprecationMessage={project.sdk_deprecation_message ?? null}
                compact
              />
            }
            compactValue
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 border-t border-edge-subtle bg-surface-overlay px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-3">
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-2xs font-medium text-fg-muted"
          title="Paste as MUSHI_PROJECT_ID in .env.local or CI"
        >
          <IconTerminal className="h-4 w-4 text-fg-faint" />
          Project ID
        </span>
        <ProjectIdCopy projectId={project.id} />
      </div>
    </div>
  )
}

function MetricTile({
  tone,
  icon,
  label,
  value,
  hint,
  title,
  compactValue,
}: {
  tone: MetricTone
  icon: ReactNode
  label: string
  value: ReactNode
  hint?: string
  title?: string
  compactValue?: boolean
}) {
  const styles = METRIC_TONE[tone]
  return (
    <div
      className="flex min-w-0 flex-col gap-0.5 bg-surface-raised px-3 py-2.5"
      title={title ?? hint}
    >
      <div className="inline-flex min-w-0 items-center gap-1.5 text-2xs font-medium text-fg-muted">
        <span className={`inline-flex shrink-0 items-center justify-center rounded p-0.5 ${styles.icon}`}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div
        className={
          compactValue
            ? 'mt-0.5 min-w-0'
            : `truncate font-mono text-lg font-semibold tabular-nums leading-tight ${styles.value}`
        }
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Per-project context rail — repo, index, trend, severity, and integrations
 * in one horizontal strip inside a ContainedBlock. Icon-led items use the
 * full card width instead of a left-piled grid of gray boxes.
 */
function ProjectContextRail({ project }: { project: Project }) {
  const repo = project.primary_repo
  const repoLabel = shortRepoLabel(repo?.repo_url ?? null)
  const sev = project.severity_breakdown_30d
  const sevTotal = sev?.total ?? 0
  const planTier = (project.plan_tier ?? '').trim()
  const region = (project.data_residency_region ?? '').trim()
  const indexedFiles = project.indexed_file_count ?? 0
  const extraRepos = (project.repos?.length ?? 0) - (repo ? 1 : 0)
  const trend = project.trend_7d
  const sentryConnected = !!project.sentry_connected
  const sentryReports = project.sentry_connected_reports_30d ?? 0
  // Trend chip is meaningful when there's been any meaningful traffic
  // — we hide it for the typical "no reports yet" case rather than
  // rendering a `flat 0 vs 0` chip that adds noise without signal.
  const showTrend =
    trend && (trend.last7d > 0 || trend.prev7d > 0) && trend.direction !== 'flat'

  const hasAnything =
    !!repo ||
    indexedFiles > 0 ||
    sevTotal > 0 ||
    planTier.length > 0 ||
    region.length > 0 ||
    showTrend ||
    sentryConnected
  if (!hasAnything) return null

  const health = repo ? indexHealth(repo) : null
  const indexHint = (() => {
    if (!repo) return undefined
    const lastIso = repo.last_indexed_at
    const attemptIso = repo.last_index_attempt_at
    if (health === 'failed') {
      const trimmed = (repo.last_index_error ?? '').slice(0, 220)
      return `Last index attempt failed${attemptIso ? ` (${relativeTime(attemptIso)})` : ''}.${
        trimmed ? `\n\n${trimmed}` : ''
      }`
    }
    if (health === 'off') return 'Indexing is disabled for this repo. Enable it in Settings to power codebase-aware triage and fix suggestions.'
    if (health === 'never') return 'Repo connected but no successful index pass yet. The first index runs in the background.'
    if (health === 'stale') return `Last successful index ${relativeTime(lastIso)}. Codebase-aware features may be using stale context.`
    return `Indexed ${relativeTime(lastIso)}.`
  })()

  return (
    <div className="overflow-hidden rounded-md border border-edge-subtle bg-surface-raised text-xs">
      {repo && repoLabel && (
        <ContextDetailRow label="Repository" icon={<IconGit className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {repo.repo_url ? (
                <a
                  href={repo.repo_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate font-mono text-sm text-fg hover:underline"
                  title={`Open ${repoLabel} on GitHub`}
                >
                  {repoLabel}
                </a>
              ) : (
                <span className="truncate font-mono text-sm text-fg">{repoLabel}</span>
              )}
              {repo.repo_url && <IconExternalLink className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
            </span>
            {repo.default_branch && (
              <>
                <ContextDivider />
                <SignalChip tone="neutral" className="font-mono uppercase">
                  {repo.default_branch}
                </SignalChip>
              </>
            )}
            {health && (
              <>
                <ContextDivider />
                <span
                  title={
                    health === 'ok' && repo.last_indexed_at
                      ? `${indexHint ?? ''} · ${relativeTime(repo.last_indexed_at)}`
                      : indexHint
                  }
                >
                  <SignalChip tone={INDEX_HEALTH_CHIP_TONE[health]}>
                    {INDEX_HEALTH_LABEL[health]}
                  </SignalChip>
                </span>
              </>
            )}
            {extraRepos > 0 && (
              <>
                <ContextDivider />
                <span className="shrink-0 text-fg-muted">
                  +{extraRepos} {extraRepos === 1 ? 'repo' : 'repos'}
                </span>
              </>
            )}
            {repo.github_app_connected && (
              <>
                <ContextDivider />
                <SignalChip tone="info">GitHub</SignalChip>
              </>
            )}
          </div>
        </ContextDetailRow>
      )}

      {indexedFiles > 0 && (
        <ContextDetailRow label="Code index" icon={<IconStorage className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span title={`${indexedFiles.toLocaleString()} indexed source files`}>
              <span className="font-mono text-sm text-fg">{indexedFiles.toLocaleString()}</span>{' '}
              <span className="text-fg-secondary">{pluralize(indexedFiles, 'file')}</span>
            </span>
            <ContextDivider />
            <Link
              to={`/explore?project=${project.id}`}
              className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay px-2 py-0.5 text-2xs text-fg-secondary transition-colors hover:border-edge hover:bg-surface-raised hover:text-fg"
              title="Open codebase atlas"
              onClick={(e) => e.stopPropagation()}
            >
              <IconExplore className="h-3 w-3" />
              Explore
            </Link>
          </div>
        </ContextDetailRow>
      )}

      {showTrend && trend && (
        <ContextDetailRow label="7-day trend" icon={<IconGauge className="h-4 w-4" />}>
          <span title={`${trend.last7d} reports last 7d vs ${trend.prev7d} prior week`}>
            <SignalChip
              tone={trend.direction === 'up' ? 'warn' : 'ok'}
              className="font-mono tabular-nums"
            >
              {trend.direction === 'up' ? '↑' : '↓'} {Math.abs(trend.delta)}
            </SignalChip>
          </span>
        </ContextDetailRow>
      )}

      {sevTotal > 0 && sev && (
        <ContextDetailRow label="Last 30 days" icon={<IconReports className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {sev.critical > 0 && (
              <span title={`${sev.critical} critical reports (30d)`}>
                <SignalChip tone="danger">Crit {sev.critical}</SignalChip>
              </span>
            )}
            {sev.major > 0 && (
              <span title={`${sev.major} major reports (30d)`}>
                <SignalChip tone="warn">Major {sev.major}</SignalChip>
              </span>
            )}
            {sev.minor > 0 && (
              <span title={`${sev.minor} minor reports (30d)`}>
                <SignalChip tone="info">Minor {sev.minor}</SignalChip>
              </span>
            )}
            {sev.trivial > 0 && (
              <span title={`${sev.trivial} trivial reports (30d)`}>
                <SignalChip tone="neutral">Low {sev.trivial}</SignalChip>
              </span>
            )}
          </div>
        </ContextDetailRow>
      )}

      {(planTier || region || sentryConnected) && (
        <ContextDetailRow label="Integrations" icon={<IconIntegrations className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {planTier && planTier !== 'free' && (
              <Badge className="border border-brand/20 bg-brand-subtle capitalize text-brand">
                {planTier}
              </Badge>
            )}
            {region && (
              <Badge className="border border-edge-subtle bg-surface-overlay uppercase text-fg-muted">
                {region}
              </Badge>
            )}
            {sentryConnected && (
              <Badge
                className="inline-flex items-center gap-1 border border-accent/30 bg-accent-muted text-accent-foreground"
                title={
                  sentryReports > 0
                    ? `${sentryReports} report${sentryReports === 1 ? '' : 's'} with Sentry trace in the last 30 days`
                    : 'Sentry SDK detected on the host app'
                }
              >
                Sentry
              </Badge>
            )}
          </div>
        </ContextDetailRow>
      )}
    </div>
  )
}

function ContextDivider() {
  return <span className="hidden h-4 w-px shrink-0 bg-edge-subtle sm:inline-block" aria-hidden />
}

function ContextDetailRow({
  label,
  icon,
  children,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-edge-subtle px-3 py-2.5 first:border-t-0 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <div className="inline-flex min-w-0 items-center gap-2 text-2xs font-semibold text-fg-muted">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-overlay text-fg-muted">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 text-fg-secondary">{children}</div>
    </div>
  )
}

function ProjectIdCopy({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(projectId)
      setCopied(true)
      toast.success('Project ID copied — paste it as MUSHI_PROJECT_ID.')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Clipboard blocked — select the ID and copy manually.')
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm transition-colors group hover:opacity-95"
      title="Copy project ID — paste as MUSHI_PROJECT_ID in .env.local or .cursor/mcp.json"
      data-testid={`project-id-chip-${projectId}`}
      aria-label={`Copy project ID: ${projectId}`}
    >
      <CodeInline className="min-w-0 max-w-full cursor-pointer break-all group-hover:border-edge">
        <span className="tabular-nums">{projectId}</span>
      </CodeInline>
      <span className="shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" aria-hidden="true">
        {copied
          ? <IconCheck className="h-2.5 w-2.5 text-ok" />
          : <IconCopy className="h-2.5 w-2.5 text-fg-faint" />
        }
      </span>
    </button>
  )
}
