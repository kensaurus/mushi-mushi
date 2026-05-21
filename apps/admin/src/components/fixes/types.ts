/**
 * FILE: apps/admin/src/components/fixes/types.ts
 * PURPOSE: Shared types + tiny look-up tables for the FixesPage and its
 *          subcomponents. Extracted so the page itself can stay focused on
 *          orchestration.
 */

/**
 * Soft warning emitted by `validateAgainstSpec()` when the diff parses
 * cleanly but doesn't visibly touch the inventory contract's
 * `expected_outcome.database.table` or its action's page route. Persisted
 * into `fix_attempts.spec_validation_warnings JSONB` by the orchestrator.
 *
 * Shape mirrors `packages/agents/src/review.ts:179` so the FE renders
 * exactly what the gate produced — no shape transformation in the API.
 */
export interface SpecValidationWarning {
  code: string;
  message: string;
  hint?: string;
}

export interface FixAttempt {
  id: string;
  report_id: string;
  agent: string;
  status: string;
  branch?: string;
  pr_url?: string;
  pr_number?: number;
  commit_sha?: string | null;
  files_changed?: string[];
  lines_changed?: number;
  summary?: string;
  rationale?: string;
  review_passed?: boolean;
  error?: string;
  started_at: string;
  completed_at?: string;
  langfuse_trace_id?: string | null;
  llm_model?: string | null;
  llm_input_tokens?: number | null;
  llm_output_tokens?: number | null;
  check_run_status?: string | null;
  check_run_conclusion?: string | null;
  pr_state?: 'open' | 'closed' | 'merged' | 'draft' | null;
  spec_validation_warnings?: SpecValidationWarning[] | null;
  inventory_action_node_id?: string | null;
  /**
   * Categorised failure reason — one of `fix_attempts.failure_category`'s
   * enum values, or NULL when the attempt didn't fail (or pre-dates the
   * `categorizeFailure()` rollout). Surfaced as a chip on the FixCard
   * header and aggregated into the `failureBreakdown` summary tile so
   * operators can spot the dominant failure mode at a glance.
   */
  failure_category?: string | null;
  /** Cursor Cloud Agent run identifier (bc-…). Present when agent='cursor_cloud'. */
  cursor_agent_id?: string | null;
  /** Cursor run ID for the specific dispatch. */
  cursor_run_id?: string | null;
  /** Artifacts produced by the Cursor agent: screenshots, videos, logs. */
  cursor_artifacts?: Array<{ kind: 'screenshot' | 'video' | 'log' | 'file'; path: string; mime: string }> | null;
  /** GitHub Actions run ID for the mushi-claude-fix workflow. Present when agent='claude_code_agent'. */
  claude_workflow_run_id?: number | null;
  /** GitHub Actions run HTML URL. Shown while PR is pending. */
  claude_workflow_run_url?: string | null;
  /** Dispatch event UUID — echoed in the PR body for webhook correlation. */
  claude_dispatch_event_id?: string | null;
  /** Artifacts from the claude-code-action run. */
  claude_artifacts?: Array<{ kind: string; path: string; mime: string }> | null;
}

export interface DispatchJob {
  id: string;
  project_id: string;
  report_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  pr_url?: string;
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface FixSummary {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  prsOpen: number;
  /**
   * Count of fix attempts whose GitHub check-run reported `success`. Despite
   * the historic name `prsMerged`, this is **CI-passing**, not "merged" —
   * GitHub's `check_run.conclusion` enum has no `merged` value. New code
   * should read `prsCiPassing`; `prsMerged` is kept as a temporary alias so
   * the FE survives a deploy that lands before the renamed API.
   */
  prsCiPassing: number;
  /** @deprecated Read `prsCiPassing` instead. Kept for one release cycle. */
  prsMerged?: number;
  /**
   * Number of fix_attempts in the trailing 30d whose
   * `validateAgainstSpec()` gate raised at least one soft warning. The
   * dispatch still proceeded but reviewers should eyeball the diff before
   * merging. Trend signal — a weekly spike usually means an inventory
   * contract or page route just drifted.
   */
  specWarnings?: number;
  /**
   * Loop-closure: 30d failure-mode histogram, sorted desc by count.
   * Powers the "Why fixes failed" tile so operators see "12 sandbox_timeout
   * / 4 scope_blocked / 2 spec_violation" instead of one opaque "16 failed"
   * number. Categories come from `categorizeFailure()` in fix-worker.
   */
  failureBreakdown?: { category: string; count: number }[];
  days: { day: string; total: number; completed: number; failed: number }[];
}

export const DISPATCH_STATUS: Record<DispatchJob['status'], string> = {
  queued: 'bg-surface-overlay text-fg-muted',
  running: 'bg-info-subtle text-info',
  completed: 'bg-ok-subtle text-ok',
  failed: 'bg-danger-subtle text-danger',
  cancelled: 'bg-surface-overlay text-fg-faint',
};

export const DISPATCH_STATUS_LABEL: Record<DispatchJob['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const CHECK_RUN_TONE: Record<string, string> = {
  success: 'bg-ok-subtle text-ok',
  failure: 'bg-danger-subtle text-danger',
  cancelled: 'bg-surface-overlay text-fg-muted',
  timed_out: 'bg-warning-subtle text-warning',
  action_required: 'bg-warning-subtle text-warning',
  neutral: 'bg-surface-overlay text-fg-muted',
  in_progress: 'bg-info-subtle text-info',
  queued: 'bg-info-subtle text-info',
  pending: 'bg-info-subtle text-info',
};

/**
 * Surfaces what we actually know about a fix's CI run. Returns null when the
 * GitHub webhook hasn't fired yet — better empty than a faked "passed".
 */
export function ciBadge(fix: FixAttempt): { label: string; className: string } | null {
  const conclusion = fix.check_run_conclusion?.toLowerCase();
  const status = fix.check_run_status?.toLowerCase();
  if (conclusion) {
    return {
      label: `CI: ${conclusion}`,
      className: CHECK_RUN_TONE[conclusion] ?? 'bg-surface-overlay text-fg-muted',
    };
  }
  if (status) {
    return {
      label: `CI: ${status.replace(/_/g, ' ')}`,
      className: CHECK_RUN_TONE[status] ?? 'bg-surface-overlay text-fg-muted',
    };
  }
  return null;
}
