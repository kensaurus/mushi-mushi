/**
 * FILE: apps/admin/src/lib/verifyTypes.ts
 * PURPOSE: The verified-fixes contract the console reads (Plan 024, ADR 0035).
 *
 * Copied from the server, which is the source of truth: the gate shape in
 * `_shared/fix-verify.ts`, the `project_settings` columns in
 * `<version>_verified_fixes.sql`, and the routes in `api-ext`
 * (`/v1/admin/projects/:id/verify-settings`, `/verify-workflow`,
 * `/v1/admin/fixes/:id/verification`, `/verify`). Change the server first,
 * then copy; the console never reshapes them.
 */

export type VerifyGateId = 'review' | 'second_review' | 'ci' | 'fail_to_pass' | 'protected' | 'budget'

export type VerifyGateStatus = 'pass' | 'fail' | 'pending' | 'unavailable' | 'not_set_up'

/**
 * One merge gate for a PR head. `label` is plain words ("Test proves the
 * fix"); `detail` is one sentence saying what to do when it is not `pass`.
 */
export interface VerifyGate {
  id: VerifyGateId
  status: VerifyGateStatus
  label: string
  detail: string
  evidence?: Record<string, unknown>
}

export type SecondJudgeChoice = 'auto' | 'openai' | 'openrouter' | 'off'

export type AutoRevertChoice = 'off' | 'pr'

/** The `project_settings` columns the verified-merge card edits (snake_case, as stored). */
export interface VerifySettingsValues {
  verified_auto_merge: boolean
  verified_auto_merge_daily_limit: number
  verify_runs_on: string[]
  verify_test_command: string | null
  verify_max_files: number
  verify_max_lines: number
  verify_protected_globs: string[]
  verify_second_judge: SecondJudgeChoice
  verify_second_judge_model: string | null
  auto_revert: AutoRevertChoice
}

/** `GET /v1/admin/projects/:id/verify-settings` (`data`). */
export interface VerifySettingsResponse extends VerifySettingsValues {
  /** Whether `.github/workflows/mushi-verify.yml` is in the primary repo; null when it could not be read. */
  workflowInstalled: boolean | null
  /** The key the second review would use, or null when the project has none. */
  secondJudgeKey: { provider: string; label: string } | null
}

/** `PUT /v1/admin/projects/:id/verify-settings` body: only the changed fields. */
export type VerifySettingsPatch = Partial<VerifySettingsValues>

/** `GET /v1/admin/projects/:id/verify-workflow` (`data`). */
export interface VerifyWorkflowResponse {
  yaml: string
  /** Where the file goes in the repo (`.github/workflows/mushi-verify.yml`). */
  path?: string
}

/** `POST /v1/admin/projects/:id/verify-workflow/pr` (`data`). */
export interface VerifyWorkflowPrResponse {
  prUrl: string
  prNumber?: number | null
}

/** `fix_verifications.second_judge`. */
export interface SecondJudgeResult {
  provider: string
  model: string
  verdict: 'merge' | 'fix_first' | 'hold' | null
  findings: unknown[]
  summary: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
  at?: string | null
}

export type AutoMergeState = 'none' | 'eligible' | 'merged' | 'skipped' | 'failed'

export type RegressionSignal = 'ci_failed_on_merge' | 'report_reopened' | 'new_report_in_changed_file'

export type RevertState = 'none' | 'pr_opened' | 'not_safe' | 'off' | 'failed'

/** One `fix_regressions` row, as the console reads it. */
export interface FixRegression {
  id: string
  signal: RegressionSignal
  detail: string | null
  revertState: RevertState
  revertPrUrl: string | null
  createdAt: string | null
}

/**
 * `GET /v1/admin/fixes/:id/verification` (`data`), also on
 * `GET /v1/admin/fixes/:id/timeline` as `data.verification`.
 */
export interface FixVerification {
  headSha: string
  gates: VerifyGate[]
  passed: boolean
  secondJudge: SecondJudgeResult | null
  autoMerge: { state: AutoMergeState; detail: string | null }
  regressions: FixRegression[]
}
