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
import { Link } from 'react-router-dom'
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
  Badge,
  Card,
  CodeValue,
  DefinitionChips,
  LogBlock,
  RelativeTime,
  SegmentedControl,
  type DefinitionChipItem,
} from '../components/ui'
import { FixGitGraph, type FixTimelineEvent } from '../components/FixGitGraph'
import { useRealtimeReload } from '../lib/realtime'
import { IconGit, IconIntegrations } from '../components/icons'
import { pluralize, pluralizeWithCount } from '../lib/format'

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
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
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
    void load()
  }, [load])

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

  return (
    <div className="space-y-3">
      <PageHeader
        title="Repo graph"
        projectScope={projectName}
        description="Every auto-fix branch the worker has opened on this repo — grouped by CI status, with a live activity log so you can see the PDCA loop at a glance."
      >
        <span className="text-2xs text-fg-faint font-mono">
          {pluralizeWithCount(counts.total, 'branch', 'branches')}
        </span>
      </PageHeader>

      <PageHelp
        title="About the Repo graph"
        whatIsIt="A repo-level view of Mushi's fix pipeline: every draft PR, its branch, and its CI conclusion in one place."
        useCases={[
          'Spot stuck PRs (dispatched but never opened) so auth or agent issues surface fast',
          'Verify that CI is green across the board before scaling dispatch volume',
          'See rollups of activity across every branch without clicking into each fix',
        ]}
        howToUse="Filter by CI bucket to focus on what matters. Each card is one fix attempt — click through to the report to see the full PDCA story. The right column is a chronological log of branch, PR and CI events across all fixes."
      />

      {/* Repo header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-fg-muted">
              <IconGit />
              <span className="font-semibold tracking-wide uppercase text-3xs">Repository</span>
            </div>
            {hasRepo ? (
              <CodeValue value={repo.repo_url!} tone="url" />
            ) : (
              <p className="text-sm text-fg-faint italic">No GitHub repo is connected yet.</p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-2xs text-fg-muted">
              {repo.default_branch && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-fg-faint">default:</span>
                  <CodeValue value={repo.default_branch} tone="hash" inline copyable={false} />
                </span>
              )}
              {repo.github_app_installation_id ? (
                <Badge className="bg-ok-subtle text-ok">GitHub App installed</Badge>
              ) : hasRepo ? (
                <Badge className="bg-warn-subtle text-warn">No GitHub App installation</Badge>
              ) : null}
              {repo.last_indexed_at && (
                <span>
                  Indexed <RelativeTime value={repo.last_indexed_at} />
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 flex flex-wrap items-center gap-2">
            {hasRepo && (
              <a
                href={repo.repo_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2.5 py-1 rounded-md border border-edge-subtle bg-surface-overlay hover:bg-surface-raised text-fg-secondary motion-safe:transition-colors"
              >
                Open on GitHub ↗
              </a>
            )}
            <Link
              to="/integrations"
              className="text-xs px-2.5 py-1 rounded-md border border-edge-subtle bg-surface-overlay hover:bg-surface-raised text-fg-secondary motion-safe:transition-colors inline-flex items-center gap-1"
            >
              <IconIntegrations />
              Manage
            </Link>
          </div>
        </div>
        <div className="mt-3">
          <DefinitionChips items={headerChips} columns="auto" dense />
        </div>
      </Card>

      {branches.length === 0 ? (
        <EmptyState
          title={hasRepo ? 'No fix branches yet' : 'Connect your repo'}
          description={
            hasRepo
              ? "Dispatch a fix on a classified report and its branch will land here the moment the agent pushes."
              : "Install the Mushi GitHub App on the repo you want auto-fix PRs opened against."
          }
          action={
            <Link to={hasRepo ? '/reports' : '/integrations'}>
              <Btn variant="primary" size="sm">
                {hasRepo ? 'Open Reports' : 'Connect GitHub'}
              </Btn>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-3">
          {/* Branch list */}
          <div className="space-y-2 min-w-0">
            <SegmentedControl<Bucket>
              ariaLabel="Filter branches by CI status"
              value={bucket}
              options={BUCKETS.map((b) => ({ id: b.id, label: b.label, count: bucketCounts[b.id] }))}
              onChange={setBucket}
            />
            {filteredBranches.length === 0 ? (
              <p className="text-2xs text-fg-muted px-2 py-3">
                No branches in this state right now.{' '}
                <button type="button" onClick={() => setBucket('all')} className="text-brand hover:underline">
                  Show all
                </button>
              </p>
            ) : (
              <div className="space-y-2">
                {filteredBranches.map((b) => (
                  <BranchRow key={b.id} branch={b} />
                ))}
              </div>
            )}
          </div>

          {/* Activity log */}
          <div className="min-w-0">
            <Card>
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
          </div>
        </div>
      )}
    </div>
  )
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
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={ci.className}>{ci.label}</Badge>
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
            <p className="text-xs text-fg-secondary wrap-break-word max-w-prose leading-relaxed">
              {branch.report_summary ?? branch.summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-3xs text-fg-faint font-mono">
            <Link to={`/reports/${branch.report_id}`} className="hover:text-fg-secondary underline-offset-2 hover:underline">
              Report {branch.report_id.slice(0, 8)}
            </Link>
            <span>·</span>
            <RelativeTime value={branch.created_at} />
          </div>
        </div>
        <div className="w-full sm:w-64 shrink-0">
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
        <div className="mt-2">
          <DefinitionChips items={meta} columns="auto" dense />
        </div>
      )}
    </Card>
  )
}
