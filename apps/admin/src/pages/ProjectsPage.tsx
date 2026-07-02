/**
 * FILE: apps/admin/src/pages/ProjectsPage.tsx
 * PURPOSE: List, create, and operate on every project the user owns. Includes
 *          per-project stats, member chips, deep links into project-scoped
 *          surfaces (settings, reports, integrations), and a "send test
 *          report" action so admins can verify the pipeline end-to-end without
 *          copy-pasting an API key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { usePublishPageContext } from '../lib/pageContext'
import { usePageCopy } from '../lib/copy'
import { useRealtimeReload } from '../lib/realtime'
import { pluralizeWithCount } from '../lib/format'
import {
  Btn,
  ErrorAlert,
  Badge,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { canCreateProject, viewerRoleHint } from '../lib/orgPermissions'
import { useCreateProject } from '../lib/useCreateProject'
import { useUpdateProject } from '../lib/useUpdateProject'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useActiveOrgId, type OrganizationSummary } from '../components/OrgSwitcher'
import { useAdminMode } from '../lib/mode'
import { ProjectsPageHero } from '../components/projects/ProjectsPageHero'
import { type CreatedProjectInfo } from '../components/ProjectCreatedSuccessPanel'
import { CliSetupGuide } from '../components/CliSetupGuide'
import { ProjectsStatusBanner } from '../components/projects/ProjectsStatusBanner'
import { ProjectsHubGuide } from '../components/projects/ProjectsHubGuide'
import { ProjectsSetupReadout } from '../components/projects/ProjectsSetupReadout'
import { ProjectsSnapshotStrip } from '../components/projects/ProjectsSnapshotStrip'
import { ProjectsCreatePanel } from '../components/projects/ProjectsCreatePanel'
import { ProjectsListPanel } from '../components/projects/ProjectsListPanel'
import {
  EMPTY_PROJECTS_STATS,
  type ProjectsStats,
  type ProjectsTabId,
} from '../components/projects/types'
import {
  type Project,
  type ScopePresetId,
  type OrgRole,
  SCOPE_PRESETS,
} from '../components/projects/project-models'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  ACTIVE_PROJECT_STORAGE_KEY,
  setActiveProjectIdSnapshot,
} from '../lib/activeProject'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { shouldHideGuideWhenBannerActive } from '../lib/pagePostureHelpers'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DangerConfirm } from '../components/DangerConfirm'
import { BulkSdkUpgradePanel } from '../components/projects/BulkSdkUpgradePanel'
import { CHIP_TONE } from '../lib/chipTone'
import { IconProjects } from '../components/icons'

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

export function ProjectsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const copy = usePageCopy('/projects')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()
  const { isAdvanced } = useAdminMode()

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
  usePublishPageHeroStats('/projects', statsData)
  const activeOrgId = useActiveOrgId()
  const { data: orgData, loading: orgLoading } = usePageData<{ organizations: OrganizationSummary[] }>('/v1/org', {
    scope: 'none',
  })
  const activeOrg = orgData?.organizations?.find((o) => o.id === activeOrgId) ?? null
  const activeTeamName = activeOrg?.name ?? null
  const activeOrgRole = activeOrg?.role ?? null
  // True only after the org request has completed — used to distinguish
  // "data not yet arrived" (null role = maybe owner) from "data arrived,
  // no writable role" (definitely blocked).
  const orgDataLoaded = !orgLoading && orgData !== undefined
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
      // Always show the tab — hiding it when org data hasn't loaded yet
      // causes a silent "click does nothing" race during the first render.
      // Role-based access is enforced at the button level with a clear hint.
      { id: 'create' as const, label: 'New project' },
    ],
    [stats.projectCount],
  )

  const [createdProject, setCreatedProject] = useState<CreatedProjectInfo | null>(null)

  const { create: createProjectRaw, creating, error: createError, clearError: clearCreateError } =
    useCreateProject({
    onCreated: (project) => {
      setNewName('')
      setCreatedProject(project)
      reloadAll()
      setTab('create')
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
      <PageHeaderBar
        title={copy?.title ?? 'Projects'}
        icon={<IconProjects />}
        description={
          copy?.description ??
          'Banner + PROJECTS SNAPSHOT — Overview for posture, Your projects to mint keys and verify ingest.'
        }
        helpTitle={copy?.help?.title ?? 'About projects'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'A project is a container for one app or environment. Everything in Mushi — bugs, fixes, reports, integrations — belongs to a project.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Create a project for your main app (takes 30 seconds)',
            "Add a separate project for staging so test bugs don't mix with real ones",
            'Generate an API key, send a test report, and confirm SDK heartbeat before production',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Use Your projects to switch context, mint keys, and read per-project health. The banner and KPI strip tell you which projects ingest and which keys have connected.'
        }
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? CHIP_TONE.okSubtle
              : bannerSeverity === 'warn'
                ? CHIP_TONE.warnSubtle
                : bannerSeverity === 'brand'
                  ? 'bg-chrome text-fg-secondary'
                  : bannerSeverity === 'info'
                    ? CHIP_TONE.infoSubtle
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {headerBadge}
        </Badge>
        <FreshnessPill at={fetchedAt} isValidating={validating} />
        <Btn variant="ghost" size="sm" onClick={reloadAll} loading={validating}>
          Refresh
        </Btn>
      </PageHeaderBar>

      {isAdvanced && <ProjectsPageHero stats={stats} />}

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <ProjectsStatusBanner
                stats={stats}
                activeTeamName={activeTeamName}
                roleHint={roleHint}
                onTab={setTab}
                onRefresh={reloadAll}
                refreshing={validating}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <ProjectsSnapshotStrip
                stats={stats}
                fetchedAt={fetchedAt}
                isValidating={validating}
                sectionTitle="PROJECTS SNAPSHOT"
                hint={activeMeta.description}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show:
              activeTab === 'overview' &&
              !shouldHideGuideWhenBannerActive(true, ['healthy'], stats.topPriority),
            children: <ProjectsHubGuide topPriority={stats.topPriority} stats={stats} />,
          },
        ]}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setTab}
        options={tabOptions}
        ariaLabel="Projects sections"
        size="sm"
      />

      {activeTab === 'overview' && stats.activeProjectId ? (
        <ProjectsSetupReadout
          activeProjectId={stats.activeProjectId}
          activeProjectName={stats.activeProjectName}
          activeKeyCount={stats.activeKeyCount}
          staleKeyCount={stats.staleKeyCount}
          activeProjectSdkConnected={stats.activeProjectSdkConnected}
          keyPrefixes={
            selectedProject?.api_keys
              ?.filter((k) => k.is_active)
              .map((k) => k.key_prefix) ?? []
          }
          fetchedAt={fetchedAt}
          validating={validating}
        />
      ) : null}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {stats.projectCount === 0 ? (
            <CliSetupGuide projectId={activeProjectId} />
          ) : null}
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="All projects ingesting"
              description={`${stats.projectCount} project${stats.projectCount === 1 ? '' : 's'} with recent reports.`}
              cta={{ label: 'Open Reports', to: '/reports' }}
            />
          )}
          <BulkSdkUpgradePanel
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              sdk_package: p.sdk_package,
              sdk_version: p.sdk_version,
              sdk_latest_version: p.sdk_latest_version,
              sdk_status: p.sdk_status,
              sdk_observation_source: (p as { sdk_observation_source?: string | null }).sdk_observation_source ?? null,
              hasRepo: Boolean(p.primary_repo?.repo_url),
            }))}
          />
        </div>
      )}

      {activeTab === 'create' ? (
        <ProjectsCreatePanel
          createdProject={createdProject}
          onDismissCreated={() => {
            setCreatedProject(null)
            setTab('list')
          }}
          orgDataLoaded={orgDataLoaded}
          canManageProjects={canManageProjects}
          activeOrgRole={activeOrgRole as OrgRole}
          onNavigateTeam={() => navigate('/organization/members')}
          newName={newName}
          onNewNameChange={setNewName}
          creating={creating}
          createError={createError}
          onCreate={() => void createProject()}
          onRetryCreate={() => void createProjectRaw(newName)}
          onClearCreateError={clearCreateError}
        />
      ) : activeTab === 'list' ? (
        <ProjectsListPanel
          projects={projects}
          activeProjectId={activeProjectId}
          selectedProject={selectedProject}
          adminHost={adminHost}
          busyProject={busyProject}
          revealedKeys={revealedKeys}
          sdkOpenOverride={sdkOpenOverride}
          keyScopePreset={keyScopePreset}
          renamingId={renamingId}
          renameDraft={renameDraft}
          renamingProject={renamingProject}
          pendingRevokeIds={pendingRevokeIds}
          onGoToCreateTab={() => setTab('create')}
          onSelectProject={setActive}
          onStartRename={startRename}
          onCancelRename={cancelRename}
          onRenameDraftChange={setRenameDraft}
          onSubmitRename={submitRename}
          onSendTestReport={sendTestReport}
          onGenerateKey={generateKey}
          onKeyScopePresetChange={(projectId, preset) =>
            setKeyScopePreset((prev) => ({ ...prev, [projectId]: preset }))
          }
          onDismissRevealedKey={(projectId) =>
            setRevealedKeys((prev) => {
              const { [projectId]: _, ...rest } = prev
              return rest
            })
          }
          onSdkOpenOverrideChange={(projectId, open) =>
            setSdkOpenOverride((prev) => {
              if (open === true && !(projectId in prev)) return prev
              return { ...prev, [projectId]: open }
            })
          }
          onRequestDelete={setPendingDelete}
          onRequestRevokeKey={requestRevokeKey}
          onReload={reloadAll}
        />
      ) : null}

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
