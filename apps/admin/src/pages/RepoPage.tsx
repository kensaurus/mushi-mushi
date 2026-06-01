/**
 * FILE: apps/admin/src/pages/RepoPage.tsx
 * PURPOSE: Repo-wide branch & PR graph for the connected GitHub repository.
 *          Shows the PDCA pipeline at repo level — every branch the fix
 *          worker has opened, its PR status, CI conclusion, and a rolling
 *          activity log across all fixes. Sister page to /fixes; the
 *          difference is /fixes groups by attempt, /repo groups by branch.
 *
 *          Data flows:
 *            GET /v1/admin/repo/overview?project_id=... — branches + counts
 *            GET /v1/admin/repo/activity?project_id=... — cross-fix events
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import {
  PageHeader,
  PageHelp,
  ErrorAlert,
  EmptyState,
  Btn,
  Card,
  CodeValue,
  DefinitionChips,
  LogBlock,
  RelativeTime,
  SegmentedControl,
  FreshnessPill,
  type DefinitionChipItem,
} from '../components/ui'
import { usePageCopy } from '../lib/copy'
import { useRepoUx, resolveQuickRepoTab } from '../lib/repoModeUx'
import { FixGitGraph, type FixTimelineEvent } from '../components/FixGitGraph'
import { useRealtimeReload } from '../lib/realtime'
import { IconGit } from '../components/icons'
import { pluralize, pluralizeWithCount } from '../lib/format'
import { RepoStatusBanner } from '../components/repo/RepoStatusBanner'
import { RepoSnapshotStrip } from '../components/repo/RepoSnapshotStrip'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { EMPTY_REPO_STATS, type RepoStats, type RepoTabId } from '../components/repo/RepoStatsTypes'
import { usePageData } from '../lib/usePageData'
import { ProjectReposCard } from '../components/repo/ProjectReposCard'

interface RepoBranch {
  id: string
  report_id: string
  branch: string | null
  pr_url: string | null
  pr_number: number | null
  commit_sha?: string | null
  pr_state?: 'open' | 'closed' | 'merged' | 'draft' | null
  llm_model?: string | null
  agent?: string | null
  status: string
  check_run_status: string | null
  check_run_conclusion: string | null
  files_changed: string[] | null
  lines_changed: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  report_summary: string | null
  report_category: string | null
  summary: string | null
}

interface RepoOverview {
  repo: {
    repo_url: string | null
    default_branch: string | null
    github_app_installation_id: string | null
    last_indexed_at: string | null
    indexing_enabled: boolean | null
  }
  counts: {
    open: number
    ci_passing: number
    ci_failed: number
    merged: number
    failed_to_open: number
    total: number
  }
  branches: RepoBranch[]
}

interface RepoActivityEvent {
  at: string
  kind: 'dispatched' | 'branch' | 'commit' | 'pr_opened' | 'ci_resolved' | 'completed' | 'failed'
  fix_attempt_id: string
  report_id: string
  branch: string | null
  pr_url: string | null
  pr_number: number | null
  label: string
  detail?: string | null
  status?: 'ok' | 'fail' | 'pending'
}

type Bucket = 'all' | 'open' | 'ci_passing' | 'ci_failed' | 'failed'

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'PR open' },
  { id: 'ci_passing', label: 'CI passing' },
  { id: 'ci_failed', label: 'CI failing' },
  { id: 'failed', label: 'Failed' },
]

const REPO_TABS: Array<{ id: RepoTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Repo connection health, default branch, and GitHub App status.',
  },
  {
    id: 'branches',
    label: 'Branches',
    description: 'Every auto-fix branch grouped by CI status — click through to the source report.',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Chronological log of branch, PR, and CI events across all fixes.',
  },
]

function resolveRepoTab(value: string | null): RepoTabId {
  if (value === 'branches' || value === 'activity') return value
  return 'overview'
}

function bucketize(b: RepoBranch): Bucket {
  const concl = b.check_run_conclusion?.toLowerCase()
  if (concl === 'success') return 'ci_passing'
  if (concl === 'failure' || concl === 'timed_out') return 'ci_failed'
  if (b.status === 'failed' && !b.pr_url) return 'failed'
  if (b.pr_url) return 'open'
  return 'all'
}

function ciBadge(b: RepoBranch): { label: string; className: string } {
  const c = b.check_run_conclusion?.toLowerCase()
  if (c === 'success') return { label: 'CI passing', className: 'bg-ok-subtle text-ok' }
  if (c === 'failure' || c === 'timed_out') return { label: `CI ${c}`, className: 'bg-danger-subtle text-danger' }
  if (c === 'action_required') return { label: 'CI action required', className: 'bg-warn-subtle text-warn' }
  const s = b.check_run_status?.toLowerCase()
  if (s === 'in_progress' || s === 'queued' || s === 'pending') {
    return { label: `CI ${s.replace(/_/g, ' ')}`, className: 'bg-info-subtle text-info' }
  }
  if (b.status === 'failed') return { label: 'Failed', className: 'bg-danger-subtle text-danger' }
  if (b.status === 'completed' && b.pr_url) return { label: 'PR open', className: 'bg-info-subtle text-info' }
  if (b.status === 'running' || b.status === 'queued') return { label: b.status, className: 'bg-info-subtle text-info' }
  return { label: b.status, className: 'bg-surface-overlay text-fg-muted' }
}

function synthesiseEvents(b: RepoBranch): FixTimelineEvent[] {
  // Mini inline graph uses the same event shape as FixGitGraph; we synthesise
  // a compact 3-4 event timeline from the branch row so the card renders
  // without a per-row /timeline round-trip. A full timeline is still one
  // click away via the report link.
  const events: FixTimelineEvent[] = []
  events.push({
    kind: 'dispatched',
    at: b.created_at,
    label: 'Dispatched',
    status: 'pending',
  })
  if (b.branch) {
    events.push({
      kind: 'branch',
      at: b.started_at ?? b.created_at,
      label: 'Branch',
      detail: b.branch,
      status: 'ok',
    })
  }
  if (b.pr_url) {
    events.push({
      kind: 'pr_opened',
      at: b.completed_at ?? b.started_at ?? b.created_at,
      label: `PR #${b.pr_number ?? '—'}`,
      detail: b.pr_url,
      status: 'ok',
    })
  }
  const concl = b.check_run_conclusion?.toLowerCase()
  if (concl) {
    events.push({
      kind: 'ci_resolved',
      at: b.completed_at ?? b.created_at,
      label: `CI ${concl}`,
      status: concl === 'success' ? 'ok' : 'fail',
    })
  }
  if (b.status === 'completed') {
    events.push({
      kind: 'completed',
      at: b.completed_at ?? b.created_at,
      label: 'Completed',
      status: 'ok',
    })
  } else if (b.status === 'failed') {
    events.push({
      kind: 'failed',
      at: b.completed_at ?? b.created_at,
      label: 'Failed',
      status: 'fail',
    })
  }
  return events
}

function formatActivityLog(events: RepoActivityEvent[]): string {
  if (events.length === 0) return 'No repo activity yet.'
  return events
    .map((e) => {
      const ts = new Date(e.at).toLocaleString(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      const tag =
        e.status === 'ok'
          ? '✓'
          : e.status === 'fail'
          ? '✕'
          : e.status === 'pending'
          ? '⧗'
          : '·'
      const ref = e.branch ? `[${e.branch}]` : e.pr_number ? `[PR #${e.pr_number}]` : ''
      const detail = e.detail ? ` — ${e.detail}` : ''
      return `${ts}  ${tag} ${e.label}${ref ? ' ' + ref : ''}${detail}`
    })
    .join('\n')
}

export function RepoPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/repo')
  const ux = useRepoUx()

  const tabParam = searchParams.get('tab')
  const activeTab = resolveRepoTab(tabParam)
  const activeTabMeta = REPO_TABS.find((t) => t.id === activeTab) ?? REPO_TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<RepoStats>(
    activeProjectId ? '/v1/admin/repo/stats' : null,
  )
  const repoStats = statsData ?? EMPTY_REPO_STATS

  const setActiveTab = useCallback(
    (id: RepoTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId || statsLoading) return
    const quickTab = resolveQuickRepoTab(repoStats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, activeProjectId, statsLoading, repoStats, activeTab, setActiveTab])

  const [overview, setOverview] = useState<RepoOverview | null>(null)
  const [activity, setActivity] = useState<RepoActivityEvent[] | null>(null)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bucket, setBucket] = useState<Bucket>('all')

  // Single fetcher shared by the initial mount and `reload()` so the retry
  // path always refetches BOTH resources — if the activity request fails
  // on first load, a reload used to fetch only `/overview`, leaving the
  // right panel stuck on "Loading activity…" forever.
  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!activeProjectId) return
      setLoading(true)
      setError(null)
      setActivityError(null)
      try {
        const [overviewRes, activityRes] = await Promise.all([
          apiFetch<RepoOverview>(`/v1/admin/repo/overview?project_id=${activeProjectId}`),
          apiFetch<{ events: RepoActivityEvent[] }>(
            `/v1/admin/repo/activity?project_id=${activeProjectId}&limit=100`,
          ),
        ])
        if (signal?.cancelled) return
        if (overviewRes.ok && overviewRes.data) setOverview(overviewRes.data)
        else setError(overviewRes.error?.message ?? 'Failed to load repo overview')
        // Activity is a secondary panel: we don't want a 503 on /activity to
        // block rendering the whole page. Surface the failure inline, but
        // unwedge the UI by forcing `activity` to an empty list so the panel
        // exits its "Loading activity…" state and shows the retry affordance.
        if (activityRes.ok && activityRes.data) {
          setActivity(activityRes.data.events)
          setActivityError(null)
        } else {
          setActivity([])
          setActivityError(activityRes.error?.message ?? 'Failed to load repo activity')
        }
      } catch {
        if (!signal?.cancelled) setError('Network error while loading the repo view.')
      } finally {
        if (!signal?.cancelled) setLoading(false)
      }
    },
    [activeProjectId],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  const reload = useCallback(() => {
    reloadStats()
    void load()
  }, [load, reloadStats])

  // Realtime: repo view changes whenever a fix_attempt lands, a fix_event
  // fires (PR opened / CI result), or a new project_repo is linked. One
  // debounced reload across all three keeps branch rows fresh without the
  // cost of constant polling.
  useRealtimeReload(['fix_attempts', 'fix_events', 'project_repos'], reload)

  const filteredBranches = useMemo(() => {
    if (!overview) return []
    if (bucket === 'all') return overview.branches
    return overview.branches.filter((b) => bucketize(b) === bucket)
  }, [overview, bucket])

  // Tab badges MUST be derived from the same `bucketize` the filter uses —
  // otherwise the badge count and the rendered list diverge. The server's
  // `counts.*` are orthogonal attribute totals (a PR can be "open" AND
  // "ci_passing" at the same time), which is correct for the header chips
  // above but wrong as mutually-exclusive tab counts.
  const bucketCounts = useMemo(() => {
    const counts: Record<Bucket, number> = { all: 0, open: 0, ci_passing: 0, ci_failed: 0, failed: 0 }
    if (!overview) return counts
    counts.all = overview.branches.length
    for (const b of overview.branches) {
      const bucket = bucketize(b)
      if (bucket !== 'all') counts[bucket] += 1
    }
    return counts
  }, [overview])

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'branches' as const,
        label: copy?.tabLabels?.branches ?? 'Branches',
        count: repoStats.totalBranches > 0 ? repoStats.totalBranches : undefined,
      },
      {
        id: 'activity' as const,
        label: copy?.tabLabels?.activity ?? 'Activity',
        count: activity && activity.length > 0 ? activity.length : undefined,
      },
    ],
    [copy?.tabLabels, repoStats.totalBranches, activity],
  )

  if (loading) return <TableSkeleton rows={6} columns={4} showFilters label="Loading repo view" />
  if (error) return <ErrorAlert message={error} onRetry={reload} />
  if (!overview) return <TableSkeleton rows={6} columns={4} label="Loading repo view" />

  const { repo, counts, branches } = overview
  const hasRepo = Boolean(repo.repo_url)

  const headerChips: DefinitionChipItem[] = [
    { label: 'Branches', value: pluralizeWithCount(counts.total, 'attempt') },
    { label: 'PR open', value: counts.open },
    { label: 'CI passing', value: <span className="text-ok font-semibold">{counts.ci_passing}</span> },
    { label: 'CI failing', value: <span className="text-danger font-semibold">{counts.ci_failed}</span> },
    { label: 'Merged', value: counts.merged },
  ]
  if (counts.failed_to_open > 0) {
    headerChips.push({
      label: 'Stuck',
      value: <span className="text-warn font-semibold">{counts.failed_to_open}</span>,
      hint: 'Dispatched but never opened a PR — likely agent or auth failure.',
    })
  }

  const activityPanel = (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Repo activity</h3>
        {activity && (
          <span className="text-3xs text-fg-faint font-mono">
            {pluralizeWithCount(activity.length, 'event')}
          </span>
        )}
      </div>
      {activity ? (
        activity.length === 0 && activityError ? (
          <div className="space-y-2">
            <p className="text-2xs text-danger">{activityError}</p>
            <button
              type="button"
              onClick={reload}
              className="text-2xs text-brand hover:text-brand-hover underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <LogBlock
            value={formatActivityLog(activity)}
            tone="neutral"
            maxHeightClass="max-h-[40rem]"
            copyable={false}
          />
        )
      ) : (
        <p className="text-2xs text-fg-faint">Loading activity…</p>
      )}
    </Card>
  )

  const branchList = (
    <div className="space-y-2 min-w-0">
      <SegmentedControl<Bucket>
        ariaLabel="Filter branches by CI status"
        value={bucket}
        options={BUCKETS.map((b) => ({ id: b.id, label: b.label, count: bucketCounts[b.id] }))}
        onChange={setBucket}
      />
      {filteredBranches.length === 0 ? (
        <div className="space-y-3 px-2 py-1">
          <EmptySectionMessage
            text="No branches in this state right now."
            hint="Switch the filter above or dispatch a fix to open a new branch."
          />
          <ActionPillRow>
            <ActionPill tone="neutral" onClick={() => setBucket('all')}>
              Show all branches
            </ActionPill>
          </ActionPillRow>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredBranches.map((b) => (
            <BranchRow key={b.id} branch={b} />
          ))}
        </div>
      )}
    </div>
  )

  const repoHeaderCard = (
    <Card className="p-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-3xs uppercase tracking-wider text-fg-muted font-semibold shrink-0">
            <IconGit />
            Repository
          </span>
          {hasRepo ? (
            <div className="min-w-0 flex-1">
              <CodeValue value={repo.repo_url!} tone="url" />
            </div>
          ) : (
            <p className="text-sm text-fg-faint italic">No GitHub repo is connected yet.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {repo.default_branch && (
              <SignalChip tone="neutral">
                default: {repo.default_branch}
              </SignalChip>
            )}
            {repo.github_app_installation_id ? (
              <SignalChip tone="ok">GitHub App installed</SignalChip>
            ) : hasRepo ? (
              <>
                <SignalChip tone="warn">No GitHub App installation</SignalChip>
              </>
            ) : null}
            {repo.last_indexed_at && (
              <SignalChip tone="brand">
                Indexed <RelativeTime value={repo.last_indexed_at} />
              </SignalChip>
            )}
          </div>
          <ActionPillRow className="shrink-0">
            {hasRepo && !repo.github_app_installation_id && (
              <ActionPill
                href={`https://github.com/apps/mushi-mushi/installations/new?state=${activeProjectId ?? ''}`}
                tone="brand"
              >
                Install Mushi on GitHub ↗
              </ActionPill>
            )}
            {hasRepo && (
              <ActionPill href={repo.repo_url!} tone="neutral">
                Open on GitHub ↗
              </ActionPill>
            )}
            <ActionPill to="/integrations/config" tone="neutral">
              Manage
            </ActionPill>
          </ActionPillRow>
        </div>
        <div className="pt-2 border-t border-edge-subtle/60">
          <DefinitionChips items={headerChips} columns="auto" dense />
        </div>
      </div>
    </Card>
  )

  const emptyBranches = (
    <EmptyState
      title={hasRepo ? 'No fix branches yet' : 'Connect your repo'}
      description={
        hasRepo
          ? "Dispatch a fix on a classified report and its branch will land here the moment the agent pushes."
          : "Install the Mushi GitHub App on the repo you want auto-fix PRs opened against."
      }
      action={
        <Link to={hasRepo ? '/reports' : '/integrations/config'}>
          <Btn variant="primary" size="sm">
            {hasRepo ? 'Open Reports' : 'Connect GitHub'}
          </Btn>
        </Link>
      }
    />
  )

  return (
    <div className="space-y-3" data-testid="mushi-page-repo">
      <PageHelp
        title={copy?.help?.title ?? 'About the Repo graph'}
        whatIsIt={copy?.help?.whatIsIt ?? "A repo-level view of Mushi's fix pipeline: every draft PR, its branch, and its CI conclusion in one place. Multi-repo projects (e.g. frontend + backend) can have multiple repos linked — each gets its own fix worker run."}
        useCases={copy?.help?.useCases ?? [
          'Spot stuck PRs (dispatched but never opened) so auth or agent issues surface fast',
          'Verify that CI is green across the board before scaling dispatch volume',
          'See rollups of activity across every branch without clicking into each fix',
          'Multi-repo: link a backend repo so fix PRs can span both codebases in a single dispatch',
        ]}
        howToUse={copy?.help?.howToUse ?? [
          'Connect your primary repo: go to Integrations → GitHub, paste the repo URL, then install the Mushi GitHub App (the "Install Mushi on GitHub" button appears here once the URL is set).',
          'Add a second repo: click Manage → add the backend/frontend repo, set role=backend, and set path_globs (e.g. src/**) so the fix worker knows which files to target.',
          'Enable Autofix: Settings → Autofix must be ON and Sandbox must be set to e2b/modal (not local-noop) for PRs to open in production.',
          'Review: Branches tab lists every fix PR with CI status. Activity tab shows a chronological log of dispatches, commits, and CI conclusions.',
        ].join('\n')}
      />

      <PageHeader title={copy?.title ?? 'Repo graph'} projectScope={projectName}>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <span className="text-2xs text-fg-faint font-mono">
          {pluralizeWithCount(counts.total, 'branch', 'branches')}
        </span>
        <Btn size="sm" variant="ghost" onClick={reload} loading={statsValidating}>
          Refresh
        </Btn>
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Every auto-fix branch the worker has opened on this repo — grouped by CI status, with a live activity log.'}
        </p>
      </ContainedBlock>

      <RepoStatusBanner
        stats={repoStats}
        onTab={setActiveTab}
        onRefresh={reload}
        refreshing={statsValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<RepoTabId>
        ariaLabel="Repo sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
        size="sm"
      />
      )}

      {!ux.hideRepoSnapshot && (
      <RepoSnapshotStrip
        stats={repoStats}
        statsFetchedAt={statsFetchedAt}
        statsValidating={statsValidating}
        description={activeTabMeta.description}
        sectionTitle={copy?.sections?.snapshot ?? 'REPO SNAPSHOT'}
        statLabels={copy?.statLabels}
        compact={ux.isQuickstart}
      />
      )}

      {activeTab === 'overview' && (
        <>
          {repoHeaderCard}
          {/* Multi-repo management: users can add/edit/remove project_repos rows
              directly from the overview tab without navigating to Integrations. */}
          {activeProjectId && (
            <ProjectReposCard projectId={activeProjectId} />
          )}
          {branches.length === 0 ? emptyBranches : null}
        </>
      )}

      {activeTab === 'branches' && (
        branches.length === 0 ? emptyBranches : branchList
      )}

      {activeTab === 'activity' && activityPanel}
    </div>
  )
}

function ciSignalTone(b: RepoBranch): 'ok' | 'danger' | 'warn' | 'info' | 'neutral' {
  const c = b.check_run_conclusion?.toLowerCase()
  if (c === 'success') return 'ok'
  if (c === 'failure' || c === 'timed_out') return 'danger'
  if (c === 'action_required') return 'warn'
  const s = b.check_run_status?.toLowerCase()
  if (s === 'in_progress' || s === 'queued' || s === 'pending') return 'info'
  if (b.status === 'failed') return 'danger'
  if (b.status === 'completed' && b.pr_url) return 'info'
  if (b.status === 'running' || b.status === 'queued') return 'info'
  return 'neutral'
}

function BranchRow({ branch }: { branch: RepoBranch }) {
  const ci = ciBadge(branch)
  const events = synthesiseEvents(branch)
  const meta: DefinitionChipItem[] = []
  if (branch.files_changed && branch.files_changed.length > 0) {
    meta.push({
      label: 'Files',
      value: `${branch.files_changed.length} ${pluralize(branch.files_changed.length, 'file', 'files')}`,
    })
  }
  if (branch.lines_changed != null) {
    meta.push({ label: 'Lines', value: branch.lines_changed })
  }
  if (branch.report_category) {
    meta.push({ label: 'Category', value: branch.report_category })
  }
  return (
    <Card className="p-3">
      {/* Two-column inner grid: identity column (badge + summary + report
          link) on the left, fix mini-graph on the right at sm+. Earlier
          revision used `flex flex-wrap justify-between` which left a
          ~200 px void between the report summary and the FixGitGraph at
          1024 px — the same "corner-stuck" pattern as the repo header
          card above. A 1fr / 16rem grid keeps both children reading as
          attached siblings instead of corner-anchored islands. */}
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SignalChip tone={ciSignalTone(branch)}>{ci.label}</SignalChip>
            {branch.branch && <CodeValue value={branch.branch} tone="hash" copyable={false} />}
            {branch.pr_url && (
              <a
                href={branch.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono"
              >
                PR #{branch.pr_number ?? '—'} ↗
              </a>
            )}
          </div>
          {(branch.report_summary || branch.summary) && (
            <ContainedBlock tone="muted">
              <p className="max-w-prose text-xs leading-relaxed text-fg-secondary wrap-break-word">
                {branch.report_summary ?? branch.summary}
              </p>
            </ContainedBlock>
          )}
          <InlineProof className="font-mono">
            <Link to={`/reports/${branch.report_id}`} className="hover:text-fg-secondary underline-offset-2 hover:underline">
              Report {branch.report_id.slice(0, 8)}
            </Link>
            {' · '}
            <RelativeTime value={branch.created_at} />
          </InlineProof>
        </div>
        <div className="min-w-0">
          <FixGitGraph
            events={events}
            prUrl={branch.pr_url}
            prNumber={branch.pr_number}
            prState={branch.pr_state}
            branchName={branch.branch}
            commitSha={branch.commit_sha}
            agentModel={branch.llm_model ?? branch.agent}
            filesChanged={branch.files_changed}
            linesChanged={branch.lines_changed}
          />
        </div>
      </div>
      {meta.length > 0 && (
        <div className="mt-2 pt-2 border-t border-edge-subtle/60">
          <DefinitionChips items={meta} columns="auto" dense />
        </div>
      )}
    </Card>
  )
}
