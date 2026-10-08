/**
 * FILE: apps/admin/src/pages/RepoPage.tsx
 * PURPOSE: Repo-wide branch & PR graph for the connected GitHub repository.
 *          Shows the PDCA pipeline at repo level — every branch the fix
 *          worker has opened, its PR status, CI conclusion, and a rolling
 *          activity log across all fixes. Sister page to /fixes. Both count
 *          per fix attempt; "PR open" is every attempt with an open PR,
 *          whatever CI says (lib/repoBranches), on both pages.
 *
 *          Data flows:
 *            GET /v1/admin/repo/overview?project_id=... — branches + counts
 *            GET /v1/admin/repo/activity?project_id=... — cross-fix events
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import {
  ErrorAlert,
  EmptyState,
  Btn,
  Card,
  CodeValue,
  DefinitionChips,
  DisclosurePanel,
  RelativeTime,
  SegmentedControl,
  FreshnessPill,
  type DefinitionChipItem, } from '../components/ui'
import { usePageCopy } from '../lib/copy'
import { useRepoUx } from '../lib/repoModeUx'
import { FixGitGraph, type FixTimelineEvent } from '../components/FixGitGraph'
import { useRealtimeReload } from '../lib/realtime'
import { pluralize, pluralizeWithCount } from '../lib/format'
import { fixDeepLinkPath } from '../lib/fixDeepLink'
import { CHIP_TONE, LINK_ACCENT } from '../lib/chipTone'
import { RepoStatusBanner } from '../components/repo/RepoStatusBanner'
import { RepoSnapshotStrip } from '../components/repo/RepoSnapshotStrip'
import { RepoProvenanceReadout } from '../components/repo/RepoProvenanceReadout'
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
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { ProjectReposCard } from '../components/repo/ProjectReposCard'
import { OpenPullRequests } from '../components/repo/OpenPullRequests'
import { ListPager } from '../components/ListPager'
import {
  REPO_FILTERS,
  countRepoFilters,
  matchesRepoFilter,
  resolveRepoFilter,
  type RepoFilter,
  type RepoServerBucket,
} from '../lib/repoBranches'

interface RepoBranch {
  id: string
  report_id: string
  branch: string | null
  pr_url: string | null
  pr_number: number | null
  commit_sha?: string | null
  pr_state?: 'open' | 'closed' | 'merged' | 'draft' | null
  merged_at?: string | null
  /** Filter bucket from the server's counting rule (repo-branch-counts.ts). */
  bucket?: RepoServerBucket | null
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
    /** Last sweep, complete or partial (older servers omit it). */
    index_swept_at?: string | null
    index_coverage_state?: string | null
    index_files_indexed?: number | null
    index_files_eligible?: number | null
  }
  counts: {
    open: number
    ci_passing: number
    ci_failed: number
    merged: number
    failed_to_open: number
    total: number
    /** Distinct branches (older servers omit it). */
    branches?: number
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

type Bucket = RepoFilter
const BUCKETS = REPO_FILTERS

/** Branch cards per page (each card is ~360 px); the server returns the latest 200 attempts. */
const BRANCHES_PAGE_SIZE = 8

/** Activity rows shown at first, and added per "Show more". */
const ACTIVITY_PAGE_SIZE = 20

const REPO_TABS: Array<{ id: RepoTabId; label: string; description: string }> = [
  {
    id: 'branches',
    label: 'Pull requests',
    description:
      'Counted per fix attempt. PR open is every attempt with an open PR, whatever CI says: the same rule as Fixes.',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Branch, PR, and CI events across all fixes, newest first.',
  },
]

/** `?tab=overview` (old links) and no tab open the pull requests. */
function resolveRepoTab(value: string | null): RepoTabId {
  return value === 'activity' ? 'activity' : 'branches'
}

type ActivityKind = RepoActivityEvent['kind']

const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  dispatched: 'Dispatched',
  branch: 'Branch',
  commit: 'Commit',
  pr_opened: 'PR opened',
  ci_resolved: 'CI result',
  completed: 'Completed',
  failed: 'Failed',
}

function ciBadge(b: RepoBranch): { label: string; className: string } {
  const c = b.check_run_conclusion?.toLowerCase()
  if (c === 'success') return { label: 'CI passing', className: CHIP_TONE.okSubtle }
  if (c === 'failure' || c === 'timed_out') return { label: `CI ${c}`, className: CHIP_TONE.dangerSubtle }
  if (c === 'action_required') return { label: 'CI action required', className: CHIP_TONE.warnSubtle }
  const s = b.check_run_status?.toLowerCase()
  if (s === 'in_progress' || s === 'queued' || s === 'pending') {
    return { label: `CI ${s.replace(/_/g, ' ')}`, className: CHIP_TONE.infoSubtle }
  }
  if (b.status === 'failed') return { label: 'Failed', className: CHIP_TONE.dangerSubtle }
  if (b.status === 'completed' && b.pr_url) return { label: 'PR open', className: CHIP_TONE.infoSubtle }
  if (b.status === 'running' || b.status === 'queued') return { label: b.status, className: CHIP_TONE.infoSubtle }
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

export function RepoPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/repo')
  const ux = useRepoUx()

  const activeTab = resolveRepoTab(searchParams.get('tab'))
  const activeTabMeta = REPO_TABS.find((t) => t.id === activeTab) ?? REPO_TABS[0]

  const {
    data: statsData,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<RepoStats>(
    activeProjectId ? '/v1/admin/repo/stats' : null,
  )
  usePublishPageHeroStats('/repo', statsData)
  const repoStats = statsData ?? EMPTY_REPO_STATS

  const setActiveTab = useCallback(
    (id: RepoTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'branches') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const [overview, setOverview] = useState<RepoOverview | null>(null)
  const [activity, setActivity] = useState<RepoActivityEvent[] | null>(null)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The filter lives in the URL so a tile or banner ("Open failing CI") can
  // land on it (console QA 99).
  const bucket: Bucket = resolveRepoFilter(searchParams.get('status'))
  const [branchPage, setBranchPage] = useState(1)
  const [activityKind, setActivityKind] = useState<ActivityKind | 'all'>('all')
  const [activityShown, setActivityShown] = useState(ACTIVITY_PAGE_SIZE)
  const setBucket = useCallback(
    (next: Bucket) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'all') params.delete('status')
        else params.set('status', next)
        return params
      }, { replace: true, preventScrollReset: true })
      setBranchPage(1)
    },
    [setSearchParams],
  )

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
    return overview.branches.filter((b) => matchesRepoFilter(b, bucket))
  }, [overview, bucket])
  const pagedBranches = useMemo(
    () => filteredBranches.slice((branchPage - 1) * BRANCHES_PAGE_SIZE, branchPage * BRANCHES_PAGE_SIZE),
    [filteredBranches, branchPage],
  )

  // Filter counts use the same predicate as the list and the server's rule,
  // so each count equals its header chip and the rows it shows.
  const bucketCounts = useMemo(() => countRepoFilters(overview?.branches ?? []), [overview])

  const activityCounts = useMemo(() => {
    const counts = new Map<ActivityKind, number>()
    for (const e of activity ?? []) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
    return counts
  }, [activity])
  const filteredActivity = useMemo(
    () => (activity ?? []).filter((e) => activityKind === 'all' || e.kind === activityKind),
    [activity, activityKind],
  )

  const tabOptions = useMemo(
    () => [
      {
        id: 'branches' as const,
        label: 'Pull requests',
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
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={reload}
              className={`!px-0 !py-0 !border-0 !bg-transparent hover:!bg-transparent ${LINK_ACCENT}`}
            >
              Retry
            </Btn>
          </div>
        ) : activity.length === 0 ? (
          <p className="text-2xs text-fg-faint">No repo activity yet.</p>
        ) : (
          <div className="space-y-2">
            <SegmentedControl<ActivityKind | 'all'>
              size="sm"
              scrollable
              ariaLabel="Filter activity by event type"
              value={activityKind}
              options={[
                { id: 'all' as const, label: 'All', count: activity.length },
                ...(Object.keys(ACTIVITY_KIND_LABEL) as ActivityKind[])
                  .filter((k) => activityCounts.has(k))
                  .map((k) => ({ id: k, label: ACTIVITY_KIND_LABEL[k], count: activityCounts.get(k) })),
              ]}
              onChange={(k) => {
                setActivityKind(k)
                setActivityShown(ACTIVITY_PAGE_SIZE)
              }}
            />
            <ul className="divide-y divide-edge-subtle">
              {filteredActivity.slice(0, activityShown).map((e, i) => (
                <ActivityRow key={`${e.fix_attempt_id}-${e.kind}-${e.at}-${i}`} event={e} />
              ))}
            </ul>
            {filteredActivity.length > activityShown && (
              <Btn size="sm" variant="ghost" onClick={() => setActivityShown((n) => n + ACTIVITY_PAGE_SIZE)}>
                Show {Math.min(ACTIVITY_PAGE_SIZE, filteredActivity.length - activityShown)} more
              </Btn>
            )}
          </div>
        )
      ) : (
        <p className="text-2xs text-fg-faint">Loading activity…</p>
      )}
    </Card>
  )

  const branchList = (
    <div className="space-y-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <SegmentedControl<Bucket>
          ariaLabel="Filter fix attempts by PR and CI status"
          value={bucket}
          options={BUCKETS.map((b) => ({ id: b.id, label: b.label, count: bucketCounts[b.id] }))}
          onChange={setBucket}
        />
        <Link
          to="/fixes"
          className="text-2xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          title="Counts here are fix attempts. PR open counts every attempt with an open PR, as Fixes does."
        >
          See fix attempts →
        </Link>
      </div>
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
          {pagedBranches.map((b) => (
            <BranchRow key={b.id} branch={b} />
          ))}
          <ListPager
            page={branchPage}
            pageSize={BRANCHES_PAGE_SIZE}
            total={filteredBranches.length}
            noun="pull requests"
            onPage={setBranchPage}
          />
        </div>
      )}
    </div>
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
        <Btn to={hasRepo ? '/reports' : '/integrations/config'} variant="primary" size="sm">
            {hasRepo ? 'Open Reports' : 'Connect GitHub'}
          </Btn>
      }
    />
  )

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-repo">
      <PageHeaderBar
        title={copy?.title ?? 'Pull requests'}
        projectScope={projectName}

        helpTitle={copy?.help?.title ?? 'About pull requests'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? "A repo-level view of Mushi's fix pipeline: every draft PR, its branch, and its CI conclusion in one place. Multi-repo projects (e.g. frontend + backend) can have multiple repos linked — each gets its own fix worker run."}
        helpUseCases={copy?.help?.useCases ?? [
          'Spot stuck PRs (dispatched but never opened) so auth or agent issues surface fast',
          'Verify that CI is green across the board before scaling dispatch volume',
          'See rollups of activity across every branch without clicking into each fix',
          'Multi-repo: link a backend repo so fix PRs can span both codebases in a single dispatch',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? [
          'Connect your primary repo: go to Integrations → GitHub, paste the repo URL, then install the Mushi GitHub App ("Install Mushi on GitHub" under Repository settings once the URL is set).',
          'Add a second repo: open Repository settings → + Add repo, set role=backend, and set path_globs (e.g. src/**) so the fix worker knows which files to target (the same globs limit which files are indexed).',
          'Enable Autofix: Settings → Autofix must be ON and Sandbox must be set to e2b/modal (not local-noop) for PRs to open in production.',
          'Review: Pull requests lists every fix PR with CI status. Activity lists dispatches, commits, and CI results; filter it by event type.',
        ].join('\n')}
      >
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <span className="text-2xs text-fg-faint font-mono">
          {pluralizeWithCount(counts.branches ?? counts.total, 'branch', 'branches')}
        </span>
        <Btn size="sm" variant="ghost" onClick={reload} loading={statsValidating}>
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <RepoStatusBanner
                stats={repoStats}
                onTab={setActiveTab}
                onRefresh={reload}
                refreshing={statsValidating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideRepoSnapshot,
            children: (
              <RepoSnapshotStrip
                stats={repoStats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                description={activeTabMeta.description}
                sectionTitle={copy?.sections?.snapshot ?? 'REPO SNAPSHOT'}
                statLabels={copy?.statLabels}
                compact={ux.isQuickstart}
              />
            ),
          },
        ]}
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

      {/* Every open PR in the connected repos, fix or not, with Merge once its checks pass. */}
      {activeTab === 'branches' && activeProjectId && <OpenPullRequests projectId={activeProjectId} />}

      {/* Open PRs lead; the per-attempt history is a closed panel under them. */}
      {activeTab === 'branches' && (
        branches.length === 0 ? emptyBranches : (
          <DisclosurePanel
            title="Fix attempt branches"
            trailing={<span className="text-2xs font-normal text-fg-faint">{branches.length} attempts</span>}
          >
            {branchList}
          </DisclosurePanel>
        )
      )}

      {activeTab === 'activity' && activityPanel}

      {/* Linked repos, default branch, App and index status: setup, not the daily job. */}
      {activeProjectId && (
        <DisclosurePanel title="Repository settings">
          <ProjectReposCard projectId={activeProjectId} />
        </DisclosurePanel>
      )}

      <RepoProvenanceReadout
        stats={repoStats}
        repoUrl={repo.repo_url}
        fetchedAt={statsFetchedAt}
        validating={statsValidating}
      />
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
          1024 px. A 1fr / 16rem grid keeps both children reading as
          attached siblings instead of corner-anchored islands. */}
      {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
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
                className="text-xs text-accent-foreground hover:text-accent underline-offset-2 hover:underline font-mono"
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
            <Link to={fixDeepLinkPath(branch.id)} className="hover:text-fg-secondary underline-offset-2 hover:underline">
              Fix attempt
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

const ACTIVITY_TONE: Record<NonNullable<RepoActivityEvent['status']>, 'ok' | 'danger' | 'info'> = {
  ok: 'ok',
  fail: 'danger',
  pending: 'info',
}

function ActivityRow({ event: e }: { event: RepoActivityEvent }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-2xs">
      <span className="w-20 shrink-0 tabular-nums text-fg-faint">
        <RelativeTime value={e.at} />
      </span>
      <SignalChip tone={e.status ? ACTIVITY_TONE[e.status] : 'neutral'}>{e.label}</SignalChip>
      {e.pr_url ? (
        <a
          href={e.pr_url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-accent-foreground underline-offset-2 hover:text-accent hover:underline"
        >
          PR #{e.pr_number ?? '—'} ↗
        </a>
      ) : e.branch ? (
        <span className="font-mono text-fg-muted">{e.branch}</span>
      ) : null}
      {e.detail ? <span className="min-w-0 wrap-break-word text-fg-muted">{e.detail}</span> : null}
    </li>
  )
}
