/**
 * FILE: apps/admin/src/lib/verifyView.ts
 * PURPOSE: Pure helpers for verified fixes (Plan 024, ADR 0035): how a merge
 *          gate, the automatic-merge state and a regression read (glyph +
 *          word + tone, so nothing reads by colour alone), the settings form
 *          (draft, validation mirroring the server's bounds, the changed
 *          fields only), runner-label suggestions from the /ci overview, and
 *          spotting a "Mushi verify" CI job.
 */

import type { StatusSeverity } from './chipTone'
import type { CiJob, CiOverview } from './ciTypes'
import type {
  AutoMergeState,
  AutoRevertChoice,
  FixRegression,
  FixVerification,
  RegressionSignal,
  RevertState,
  SecondJudgeChoice,
  VerifyGate,
  VerifyGateStatus,
  VerifySettingsPatch,
  VerifySettingsValues,
} from './verifyTypes'

/* ── Gates ──────────────────────────────────────────────────────────────── */

export interface StatusMeta {
  glyph: string
  word: string
  tone: StatusSeverity
}

/** Glyph + word per gate status: the tone only repeats what the word says.
 * @internal Exported for tests only.
 */
export const GATE_STATUS_META: Record<VerifyGateStatus, StatusMeta> = {
  pass: { glyph: '✓', word: 'Passed', tone: 'ok' },
  fail: { glyph: '✕', word: 'Failed', tone: 'danger' },
  pending: { glyph: '◷', word: 'Waiting', tone: 'info' },
  unavailable: { glyph: '⊘', word: 'Unavailable', tone: 'warn' },
  not_set_up: { glyph: '○', word: 'Not set up', tone: 'neutral' },
}

export function gateStatusMeta(status: string): StatusMeta {
  return GATE_STATUS_META[status as VerifyGateStatus] ?? { glyph: '?', word: 'Unknown', tone: 'neutral' }
}

/** One line over the checklist: "All 6 checks passed" / "4 of 6 checks passed". */
export function gatesSummary(gates: ReadonlyArray<Pick<VerifyGate, 'status'>>): string {
  const total = gates.length
  if (total === 0) return 'No checks yet'
  const passed = gates.filter((g) => g.status === 'pass').length
  if (passed === total) return `All ${total} checks passed`
  return `${passed} of ${total} checks passed`
}

/* ── Automatic merge and regressions ────────────────────────────────────── */

const AUTO_MERGE_META: Record<AutoMergeState, StatusMeta & { sentence: string }> = {
  none: {
    glyph: '–',
    word: 'Not merged by Mushi',
    tone: 'neutral',
    sentence: 'Mushi merges on its own only when every check passes and automatic merge is on.',
  },
  eligible: {
    glyph: '◷',
    word: 'Ready to merge',
    tone: 'info',
    sentence: 'Every check passed. Mushi merges it on its next run.',
  },
  merged: { glyph: '✓', word: 'Merged by Mushi', tone: 'ok', sentence: 'Every check passed and Mushi merged it.' },
  skipped: { glyph: '⊘', word: 'Not merged', tone: 'warn', sentence: 'Every check passed, but Mushi did not merge it.' },
  failed: { glyph: '✕', word: 'Merge failed', tone: 'danger', sentence: 'Mushi tried to merge it and GitHub refused.' },
}

export function autoMergeView(state: string, detail: string | null | undefined): StatusMeta & { sentence: string } {
  const meta = AUTO_MERGE_META[state as AutoMergeState] ?? AUTO_MERGE_META.none
  const extra = detail?.trim()
  return { ...meta, sentence: extra ? `${meta.sentence} ${extra}` : meta.sentence }
}

const REGRESSION_SIGNAL_LABEL: Record<RegressionSignal, string> = {
  ci_failed_on_merge: 'CI failed on the merged commit',
  report_reopened: 'The bug report was reopened',
  new_report_in_changed_file: 'A new bug report points at a file this fix changed',
}

export function regressionLabel(signal: string): string {
  return REGRESSION_SIGNAL_LABEL[signal as RegressionSignal] ?? 'Something broke after the merge'
}

/** What happened about a revert, in words; null when there is nothing to say. */
export function revertLine(state: RevertState | string): string | null {
  switch (state) {
    case 'pr_opened':
      return 'Mushi opened a revert PR. Merge it yourself if the fix caused this.'
    case 'not_safe':
      return 'No revert PR: later commits changed the same files, so revert by hand.'
    case 'off':
      return 'Revert PRs are off for this app.'
    case 'failed':
      return 'Mushi could not open a revert PR.'
    default:
      return null
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

/** A regression row in either the API's camelCase or the table's snake_case.
 * @internal Exported for tests only.
 */
export function normalizeRegression(raw: unknown, index = 0): FixRegression | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const signal = str(r.signal)
  if (!signal) return null
  return {
    id: str(r.id) ?? `${signal}-${index}`,
    signal: signal as RegressionSignal,
    detail: str(r.detail),
    revertState: (str(r.revertState) ?? str(r.revert_state) ?? 'none') as RevertState,
    revertPrUrl: str(r.revertPrUrl) ?? str(r.revert_pr_url),
    createdAt: str(r.createdAt) ?? str(r.created_at),
  }
}

/** The verification for a fix, or null when there is none (or the body is not one). */
export function normalizeVerification(raw: unknown): FixVerification | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (!Array.isArray(v.gates)) return null
  const gates = v.gates.filter(
    (g): g is VerifyGate => !!g && typeof g === 'object' && typeof (g as VerifyGate).id === 'string',
  )
  const am = (v.autoMerge && typeof v.autoMerge === 'object' ? v.autoMerge : {}) as Record<string, unknown>
  return {
    headSha: str(v.headSha) ?? '',
    gates,
    passed: v.passed === true,
    secondJudge: (v.secondJudge as FixVerification['secondJudge']) ?? null,
    autoMerge: { state: (str(am.state) ?? 'none') as AutoMergeState, detail: str(am.detail) },
    regressions: (Array.isArray(v.regressions) ? v.regressions : [])
      .map((r, i) => normalizeRegression(r, i))
      .filter((r): r is FixRegression => r !== null),
  }
}

/* ── Settings ───────────────────────────────────────────────────────────── */

/** The server's bounds (migration CHECKs + the PUT route's zod schema). */
export const VERIFY_BOUNDS = {
  dailyLimit: { min: 1, max: 50 },
  maxFiles: { min: 1, max: 20 },
  maxLines: { min: 10, max: 1000 },
  runsOnMax: 8,
  testCommandMax: 300,
  globsMax: 30,
  globMax: 200,
} as const

const RUNNER_LABEL_RE = /^[A-Za-z0-9._-]{1,64}$/

export const SECOND_JUDGE_CHOICES: ReadonlyArray<{ value: SecondJudgeChoice; label: string }> = [
  { value: 'auto', label: 'Automatic: OpenAI, then OpenRouter' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'off', label: 'Off (Mushi never merges on its own)' },
]

export const AUTO_REVERT_CHOICES: ReadonlyArray<{ value: AutoRevertChoice; label: string }> = [
  { value: 'pr', label: 'Open a revert PR' },
  { value: 'off', label: 'Off' },
]

/** The model the second review uses when none is set. */
export function defaultSecondJudgeModel(choice: SecondJudgeChoice): string {
  return choice === 'openrouter' ? 'openai/gpt-5.4' : 'gpt-5.4'
}

/** The form: numbers stay text while typed; globs are one per line. */
export interface VerifyDraft {
  verified_auto_merge: boolean
  verified_auto_merge_daily_limit: string
  verify_runs_on: string[]
  verify_test_command: string
  verify_max_files: string
  verify_max_lines: string
  verify_protected_globs: string
  verify_second_judge: SecondJudgeChoice
  verify_second_judge_model: string
  auto_revert: AutoRevertChoice
}

type VerifyField = keyof VerifyDraft

export type VerifyErrors = Partial<Record<VerifyField, string>>

export function draftFromSettings(s: VerifySettingsValues): VerifyDraft {
  return {
    verified_auto_merge: s.verified_auto_merge === true,
    verified_auto_merge_daily_limit: String(s.verified_auto_merge_daily_limit ?? 5),
    verify_runs_on: [...(s.verify_runs_on ?? ['ubuntu-latest'])],
    verify_test_command: s.verify_test_command ?? '',
    verify_max_files: String(s.verify_max_files ?? 3),
    verify_max_lines: String(s.verify_max_lines ?? 150),
    verify_protected_globs: (s.verify_protected_globs ?? []).join('\n'),
    verify_second_judge: s.verify_second_judge ?? 'auto',
    verify_second_judge_model: s.verify_second_judge_model ?? '',
    auto_revert: s.auto_revert ?? 'pr',
  }
}

function globsFrom(text: string): string[] {
  return text
    .split('\n')
    .map((g) => g.trim())
    .filter(Boolean)
}

/** The draft as the values the server stores (call after validation passes). */
export function valuesFromDraft(d: VerifyDraft): VerifySettingsValues {
  const command = d.verify_test_command.trim()
  const model = d.verify_second_judge_model.trim()
  return {
    verified_auto_merge: d.verified_auto_merge,
    verified_auto_merge_daily_limit: Number(d.verified_auto_merge_daily_limit),
    verify_runs_on: [...d.verify_runs_on],
    verify_test_command: command || null,
    verify_max_files: Number(d.verify_max_files),
    verify_max_lines: Number(d.verify_max_lines),
    verify_protected_globs: globsFrom(d.verify_protected_globs),
    verify_second_judge: d.verify_second_judge,
    verify_second_judge_model: model || null,
    auto_revert: d.auto_revert,
  }
}

function wholeNumberError(value: string, min: number, max: number): string | null {
  const t = value.trim()
  if (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max) return `Pick a whole number from ${min} to ${max}.`
  return null
}

/** Why a label cannot be added, or null when it can. */
export function runnerLabelError(label: string, current: readonly string[]): string | null {
  const t = label.trim()
  if (!t) return 'Type a runner label first.'
  if (!RUNNER_LABEL_RE.test(t)) {
    return `"${t}" is not a runner label: use letters, numbers, dots, dashes or underscores, up to 64.`
  }
  if (current.some((l) => l.toLowerCase() === t.toLowerCase())) return `"${t}" is already in the list.`
  if (current.length >= VERIFY_BOUNDS.runsOnMax) return `Use at most ${VERIFY_BOUNDS.runsOnMax} runner labels.`
  return null
}

/** Every field's problem, in words; an empty object means the draft can be saved. */
export function validateVerifyDraft(d: VerifyDraft): VerifyErrors {
  const errors: VerifyErrors = {}
  const b = VERIFY_BOUNDS
  const daily = wholeNumberError(d.verified_auto_merge_daily_limit, b.dailyLimit.min, b.dailyLimit.max)
  if (daily) errors.verified_auto_merge_daily_limit = daily

  if (d.verify_runs_on.length === 0) errors.verify_runs_on = 'Add at least one runner label, for example ubuntu-latest.'
  else if (d.verify_runs_on.length > b.runsOnMax) errors.verify_runs_on = `Use at most ${b.runsOnMax} runner labels.`
  else {
    const bad = d.verify_runs_on.find((l) => !RUNNER_LABEL_RE.test(l))
    if (bad !== undefined) {
      errors.verify_runs_on = `"${bad}" is not a runner label: use letters, numbers, dots, dashes or underscores, up to 64.`
    }
  }

  const command = d.verify_test_command.trim()
  if (command.length > b.testCommandMax) {
    errors.verify_test_command = `Keep the command to ${b.testCommandMax} characters or fewer (${command.length} now).`
  } else if (command && !command.includes('{files}')) {
    errors.verify_test_command = 'Put {files} where the test files go, for example "pnpm vitest run {files}".'
  }

  const files = wholeNumberError(d.verify_max_files, b.maxFiles.min, b.maxFiles.max)
  if (files) errors.verify_max_files = files
  const lines = wholeNumberError(d.verify_max_lines, b.maxLines.min, b.maxLines.max)
  if (lines) errors.verify_max_lines = lines

  const globs = globsFrom(d.verify_protected_globs)
  if (globs.length > b.globsMax) {
    errors.verify_protected_globs = `Use at most ${b.globsMax} patterns (${globs.length} now).`
  } else if (globs.some((g) => g.length > b.globMax)) {
    errors.verify_protected_globs = `Keep each pattern to ${b.globMax} characters or fewer.`
  }
  return errors
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => v === b[i])
  }
  return (a ?? null) === (b ?? null)
}

/** Only the fields that differ from what is saved: a save never echoes untouched values. */
export function verifySettingsPatch(next: VerifySettingsValues, saved: VerifySettingsValues): VerifySettingsPatch {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(next) as Array<keyof VerifySettingsValues>) {
    if (!sameValue(next[key], saved[key])) out[key] = next[key]
  }
  return out as VerifySettingsPatch
}

/** Field errors from a refused PUT (zod issues with a `path`), keyed like the form. */
export function serverFieldErrors(issues: unknown[] | undefined): VerifyErrors {
  const out: VerifyErrors = {}
  for (const issue of issues ?? []) {
    if (!issue || typeof issue !== 'object') continue
    const { path, message } = issue as { path?: unknown; message?: unknown }
    const field = Array.isArray(path) ? path[0] : path
    if (typeof field === 'string' && typeof message === 'string' && !(field in out)) {
      out[field as VerifyField] = message
    }
  }
  return out
}

/* ── Runner labels from /ci ─────────────────────────────────────────────── */

const GENERIC_LABELS = new Set(['self-hosted', 'linux', 'x64'])

/**
 * Labels worth offering as `runs-on`: every self-hosted runner's own labels
 * (minus `self-hosted`, `linux`, `x64`) and its name, deduped, most-used
 * first (jobs in the last 24 h). Already-picked labels and anything that is
 * not a valid label are left out.
 */
export function runnerLabelSuggestions(
  overview: Pick<CiOverview, 'runners'> | null | undefined,
  selected: readonly string[] = [],
): string[] {
  const picked = new Set(selected.map((l) => l.toLowerCase()))
  const tally = new Map<string, { label: string; uses: number; runners: number }>()
  for (const r of overview?.runners ?? []) {
    const labels = r.labels ?? []
    const selfHosted = r.kind === 'self_hosted' || labels.some((l) => l.toLowerCase() === 'self-hosted')
    if (!selfHosted) continue
    const seen = new Set<string>()
    for (const candidate of [...labels.filter((l) => !GENERIC_LABELS.has(l.toLowerCase())), r.name]) {
      const key = candidate.toLowerCase()
      if (seen.has(key) || picked.has(key) || !RUNNER_LABEL_RE.test(candidate)) continue
      seen.add(key)
      const cur = tally.get(key) ?? { label: candidate, uses: 0, runners: 0 }
      cur.uses += r.jobs24h ?? 0
      cur.runners += 1
      tally.set(key, cur)
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.uses - a.uses || b.runners - a.runners || a.label.localeCompare(b.label))
    .map((t) => t.label)
}

/* ── /ci ────────────────────────────────────────────────────────────────── */

/** The job the `mushi-verify` workflow runs (job or workflow named "Mushi verify"). */
export function isMushiVerifyJob(job: Pick<CiJob, 'jobName' | 'workflowName'>): boolean {
  return [job.jobName, job.workflowName].some((n) => n?.trim().toLowerCase() === 'mushi verify')
}

export const MUSHI_VERIFY_JOB_NOTE = 'This job proves a fix: a test fails without it and passes with it.'
