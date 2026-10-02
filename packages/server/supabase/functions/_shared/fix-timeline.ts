/**
 * FILE: packages/server/supabase/functions/_shared/fix-timeline.ts
 * PURPOSE: Build the per-attempt event list behind GET /v1/admin/fixes/:id/timeline
 *          (the console's FixGitGraph).
 *
 * REGRESSION HISTORY (2026-10-02, report 469f6962): the synthesised stream
 * pushed both "Worker started" (dispatch job) and "Agent started" (attempt),
 * which the graph labels identically, so "Agent started" showed twice; and
 * the dispatch row stayed `pending` forever, so a finished fix still read
 * "Dispatched · status: pending".
 *
 * Pure (no imports, no env) so vitest and the permission-less Deno CI run can
 * import it directly.
 */

export type FixTimelineKind =
  | 'dispatched'
  | 'started'
  | 'branch'
  | 'commit'
  | 'pr_opened'
  | 'ci_started'
  | 'ci_resolved'
  | 'pr_state_changed'
  | 'completed'
  | 'failed'

export type FixTimelineStatus = 'ok' | 'fail' | 'pending'

export interface FixTimelineEvent {
  kind: FixTimelineKind
  at: string
  label: string
  detail?: string | null
  status?: FixTimelineStatus | null
}

export interface TimelineDispatchRow {
  status: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  error?: string | null
}

export interface TimelineFixRow {
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  branch: string | null
  commit_sha: string | null
  pr_url: string | null
  pr_number: number | null
  pr_state?: string | null
  merged_at?: string | null
  files_changed: string[] | null
  lines_changed: number | null
  llm_model: string | null
  check_run_status: string | null
  check_run_conclusion: string | null
  check_run_updated_at: string | null
  error: string | null
}

const TERMINAL_FIX = new Set(['completed', 'failed', 'merged'])

/** A dispatch is only "pending" until a worker picks it up. */
export function dispatchEventStatus(
  dispatch: TimelineDispatchRow,
  fix: Pick<TimelineFixRow, 'status'> | null,
): FixTimelineStatus {
  if (dispatch.status === 'failed' && !fix) return 'fail'
  if (dispatch.started_at || dispatch.finished_at || fix) return 'ok'
  return 'pending'
}

/**
 * The "how we got here" head of every timeline: one dispatch event and at
 * most ONE start event. The attempt's own start (with the model) wins over
 * the job's worker start because it is the more specific of the two.
 */
export function leadingFixEvents(
  dispatch: TimelineDispatchRow | null,
  fix: TimelineFixRow,
): FixTimelineEvent[] {
  const out: FixTimelineEvent[] = []
  if (dispatch) {
    out.push({
      kind: 'dispatched',
      at: dispatch.created_at,
      label: 'Dispatch requested',
      status: dispatchEventStatus(dispatch, fix),
    })
  } else if (fix.created_at) {
    out.push({ kind: 'dispatched', at: fix.created_at, label: 'Fix attempt created', status: 'ok' })
  }

  const startedAt = fix.started_at ?? dispatch?.started_at ?? null
  if (startedAt) {
    out.push({
      kind: 'started',
      at: startedAt,
      label: 'Agent started',
      detail: fix.llm_model,
      status: TERMINAL_FIX.has(fix.status) ? 'ok' : 'pending',
    })
  }
  return out
}

/** Fallback stream for attempts with no webhook-written `fix_events` rows. */
export function synthesizeFixTimeline(
  dispatch: TimelineDispatchRow | null,
  fix: TimelineFixRow,
  now: () => string = () => new Date().toISOString(),
): FixTimelineEvent[] {
  const events = leadingFixEvents(dispatch, fix)

  if (fix.branch) {
    events.push({
      kind: 'branch',
      at: fix.started_at ?? fix.created_at,
      label: 'Branch created',
      detail: fix.branch,
      status: 'ok',
    })
  }
  if (fix.commit_sha) {
    events.push({
      kind: 'commit',
      at: fix.completed_at ?? fix.started_at ?? fix.created_at,
      label: `Commit ${fix.commit_sha.slice(0, 7)}`,
      detail: `${fix.files_changed?.length ?? 0} files · ${fix.lines_changed ?? 0} lines`,
      status: 'ok',
    })
  }
  if (fix.pr_url) {
    events.push({
      kind: 'pr_opened',
      at: fix.completed_at ?? fix.started_at ?? fix.created_at,
      label: `PR opened${fix.pr_number ? ` #${fix.pr_number}` : ''}`,
      detail: fix.pr_url,
      status: 'ok',
    })
  }
  if (fix.check_run_status || fix.check_run_conclusion) {
    const conclusion = (fix.check_run_conclusion ?? '').toLowerCase()
    const ciStatus: FixTimelineStatus =
      conclusion === 'success'
        ? 'ok'
        : conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out'
          ? 'fail'
          : 'pending'
    events.push({
      kind: ciStatus === 'pending' ? 'ci_started' : 'ci_resolved',
      at: fix.check_run_updated_at ?? fix.completed_at ?? fix.started_at ?? fix.created_at,
      label:
        ciStatus === 'pending'
          ? `CI ${fix.check_run_status?.replace(/_/g, ' ') ?? 'running'}`
          : `CI ${conclusion.replace(/_/g, ' ')}`,
      status: ciStatus,
    })
  }
  if (fix.status === 'completed') {
    events.push({
      kind: 'completed',
      at: fix.completed_at ?? now(),
      label: 'Fix completed',
      status: 'ok',
    })
  } else if (fix.status === 'failed') {
    events.push({
      kind: 'failed',
      at: fix.completed_at ?? now(),
      label: 'Fix failed',
      detail: fix.error,
      status: 'fail',
    })
  }
  if (fix.merged_at || fix.pr_state === 'merged') {
    events.push({
      kind: 'pr_state_changed',
      at: fix.merged_at ?? fix.check_run_updated_at ?? fix.completed_at ?? now(),
      label: 'PR merged',
      status: 'ok',
    })
  } else if (fix.pr_state === 'closed') {
    events.push({
      kind: 'pr_state_changed',
      at: fix.check_run_updated_at ?? fix.completed_at ?? now(),
      label: 'PR closed without merge',
      status: 'fail',
    })
  }

  return sortTimeline(events)
}

/**
 * Webhook-backed stream: the stored rows verbatim, with any stage they lack
 * filled from the attempt's columns. A stored row of a kind always wins, so
 * nothing appears twice; and an attempt whose only stored row is a late
 * "PR closed" (written by ci-sync) still shows its branch, commit and PR.
 */
export function mergeStoredFixTimeline(
  dispatch: TimelineDispatchRow | null,
  fix: TimelineFixRow,
  stored: FixTimelineEvent[],
  now: () => string = () => new Date().toISOString(),
): FixTimelineEvent[] {
  const storedKinds = new Set(stored.map((e) => e.kind))
  const fill = synthesizeFixTimeline(dispatch, fix, now).filter((e) => !storedKinds.has(e.kind))
  return sortTimeline([...fill, ...stored])
}

function sortTimeline(events: FixTimelineEvent[]): FixTimelineEvent[] {
  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}
