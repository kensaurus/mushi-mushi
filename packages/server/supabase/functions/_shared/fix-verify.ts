/**
 * FILE: packages/server/supabase/functions/_shared/fix-verify.ts
 * PURPOSE: Verified fixes (ADR 0035, Plan 024). Pure: the gate shape, the
 *          diff analysis that stops tests being weakened, the reader for the
 *          host's **Mushi verify** check run, the CI gate, the gate order, the
 *          verify settings and their bounds, the automatic-merge cap, revert
 *          safety and the regression signals. No Deno globals; the only
 *          imports are zod (aliased under vitest) and the pure fix-review.ts,
 *          ci-infra.ts and sentry-frames.ts.
 *
 * WHY (2026-10-21): spend-down and follow-ups produce more agent PRs than one
 * person can read, and 18 glot.it agent PRs merged on green CI alone through
 * GitHub auto-merge. Of 21 sampled merged agent PRs, 12 only edited existing
 * tests and one deleted 11 test lines. A green suite does not prove a fix,
 * agents weaken tests when they can, and a model judge filters but does not
 * approve. So Mushi merges on its own only on proof: a test that fails
 * without the fix and passes with it, no weakened tests, a small diff, green
 * CI, and two model families that both say merge (either can veto).
 *
 * TRUST: PR file names and patches are written by the agent under review.
 * Nothing here runs or renders them; they are matched against fixed patterns
 * and counted. The verify check run's JSON comes from the host's own CI and
 * is validated field by field; anything unexpected reads "could not read
 * result", never a pass.
 */

import { z } from 'npm:zod@3'
import { classifyCiJob, describeCiInfra, readFixCiInfra, summarizeCiJobs, type CiJobVerdict } from './ci-infra.ts'
import { isLockFile, type ReviewFinding, type ReviewVerdict } from './fix-review.ts'
import { matchFramePathsToTree } from './sentry-frames.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Gate shape
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyGateId = 'review' | 'second_review' | 'ci' | 'fail_to_pass' | 'protected' | 'budget'
export type VerifyGateStatus = 'pass' | 'fail' | 'pending' | 'unavailable' | 'not_set_up'

export interface VerifyGate {
  id: VerifyGateId
  status: VerifyGateStatus
  /** Plain words: "Opus review: merge", "Test proves the fix", "Small change (2 files, 48 lines)". */
  label: string
  /** One sentence; when the gate is not `pass`, it says what to do. */
  detail: string
  evidence?: Record<string, unknown>
}

/** The order gates are evaluated, stored and shown. The second review runs last, to save money. */
export const VERIFY_GATE_ORDER: readonly VerifyGateId[] = ['review', 'ci', 'fail_to_pass', 'protected', 'budget', 'second_review']

export const VERIFY_GATE_STATUSES: readonly VerifyGateStatus[] = ['pass', 'fail', 'pending', 'unavailable', 'not_set_up']

/** The name of the check run the host's `mushi-verify` workflow posts (the composite action writes it). */
export const VERIFY_CHECK_NAME = 'Mushi verify'

/** Where the host keeps the workflow; its presence turns "not set up" into "pending". */
export const VERIFY_WORKFLOW_PATH = '.github/workflows/mushi-verify.yml'

// ─────────────────────────────────────────────────────────────────────────────
// Settings (project_settings columns, Settings → Fixes → Verified merge)
// ─────────────────────────────────────────────────────────────────────────────

export const SECOND_JUDGE_CHOICES = ['auto', 'openai', 'openrouter', 'off'] as const
export type SecondJudgeChoice = (typeof SECOND_JUDGE_CHOICES)[number]
export const AUTO_REVERT_CHOICES = ['off', 'pr'] as const
export type AutoRevertChoice = (typeof AUTO_REVERT_CHOICES)[number]

export const VERIFY_LIMITS = {
  dailyLimit: { min: 1, max: 50 },
  runsOn: { maxItems: 8, label: /^[A-Za-z0-9._-]{1,64}$/ },
  testCommand: { max: 300 },
  maxFiles: { min: 1, max: 20 },
  maxLines: { min: 10, max: 1000 },
  protectedGlobs: { maxItems: 30, maxLength: 200 },
  secondJudgeModel: { max: 200 },
} as const

export interface VerifySettings {
  verifiedAutoMerge: boolean
  verifiedAutoMergeDailyLimit: number
  verifyRunsOn: string[]
  verifyTestCommand: string | null
  verifyMaxFiles: number
  verifyMaxLines: number
  verifyProtectedGlobs: string[]
  verifySecondJudge: SecondJudgeChoice
  verifySecondJudgeModel: string | null
  autoRevert: AutoRevertChoice
}

export const VERIFY_SETTINGS_DEFAULTS: VerifySettings = {
  verifiedAutoMerge: false,
  verifiedAutoMergeDailyLimit: 5,
  verifyRunsOn: ['ubuntu-latest'],
  verifyTestCommand: null,
  verifyMaxFiles: 3,
  verifyMaxLines: 150,
  verifyProtectedGlobs: [],
  verifySecondJudge: 'auto',
  verifySecondJudgeModel: null,
  autoRevert: 'pr',
}

/** API field → project_settings column. */
export const VERIFY_SETTINGS_FIELDS: Record<keyof VerifySettings, string> = {
  verifiedAutoMerge: 'verified_auto_merge',
  verifiedAutoMergeDailyLimit: 'verified_auto_merge_daily_limit',
  verifyRunsOn: 'verify_runs_on',
  verifyTestCommand: 'verify_test_command',
  verifyMaxFiles: 'verify_max_files',
  verifyMaxLines: 'verify_max_lines',
  verifyProtectedGlobs: 'verify_protected_globs',
  verifySecondJudge: 'verify_second_judge',
  verifySecondJudgeModel: 'verify_second_judge_model',
  autoRevert: 'auto_revert',
}

export const VERIFY_SETTINGS_COLUMNS = Object.values(VERIFY_SETTINGS_FIELDS).join(', ')

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
}

/** A project_settings row (or none) → settings, every field defaulted when missing or out of bounds. */
export function verifySettingsFromRow(row: Record<string, unknown> | null | undefined): VerifySettings {
  const r = row ?? {}
  const d = VERIFY_SETTINGS_DEFAULTS
  const runsOn = stringList(r.verify_runs_on)?.filter((l) => VERIFY_LIMITS.runsOn.label.test(l)) ?? []
  const globs = stringList(r.verify_protected_globs) ?? d.verifyProtectedGlobs
  const cmd = typeof r.verify_test_command === 'string' && r.verify_test_command.includes('{files}') ? r.verify_test_command : null
  const model = typeof r.verify_second_judge_model === 'string' && r.verify_second_judge_model.trim() ? r.verify_second_judge_model.trim() : null
  return {
    verifiedAutoMerge: r.verified_auto_merge === true,
    verifiedAutoMergeDailyLimit: intIn(r.verified_auto_merge_daily_limit, VERIFY_LIMITS.dailyLimit.min, VERIFY_LIMITS.dailyLimit.max, d.verifiedAutoMergeDailyLimit),
    verifyRunsOn: runsOn.length > 0 ? runsOn.slice(0, VERIFY_LIMITS.runsOn.maxItems) : [...d.verifyRunsOn],
    verifyTestCommand: cmd,
    verifyMaxFiles: intIn(r.verify_max_files, VERIFY_LIMITS.maxFiles.min, VERIFY_LIMITS.maxFiles.max, d.verifyMaxFiles),
    verifyMaxLines: intIn(r.verify_max_lines, VERIFY_LIMITS.maxLines.min, VERIFY_LIMITS.maxLines.max, d.verifyMaxLines),
    verifyProtectedGlobs: globs.slice(0, VERIFY_LIMITS.protectedGlobs.maxItems),
    verifySecondJudge: (SECOND_JUDGE_CHOICES as readonly string[]).includes(String(r.verify_second_judge))
      ? (r.verify_second_judge as SecondJudgeChoice)
      : d.verifySecondJudge,
    verifySecondJudgeModel: model,
    autoRevert: r.auto_revert === 'off' ? 'off' : 'pr',
  }
}

// Control characters (newlines included) would break the YAML line the
// command is written into; `${{` would be read as a GitHub expression.
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const testCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(VERIFY_LIMITS.testCommand.max, `verify_test_command is at most ${VERIFY_LIMITS.testCommand.max} characters`)
  .refine((s) => s.includes('{files}'), 'verify_test_command must contain {files}, where the changed test files go')
  .refine((s) => !CONTROL_RE.test(s), 'verify_test_command must be one line')
  .refine((s) => !s.includes('${{'), 'verify_test_command must not contain a GitHub expression (${{ … }})')

/**
 * PUT /v1/admin/projects/:id/verify-settings body: any subset of the
 * settings, keyed by their project_settings column (as the console sends
 * and GET returns them), each within its bounds.
 */
export const verifySettingsPatchSchema = z
  .object({
    verified_auto_merge: z.boolean(),
    verified_auto_merge_daily_limit: z.number().int().min(VERIFY_LIMITS.dailyLimit.min).max(VERIFY_LIMITS.dailyLimit.max),
    verify_runs_on: z
      .array(z.string().regex(VERIFY_LIMITS.runsOn.label, 'each runner label is 1-64 letters, digits, ".", "_" or "-"'))
      .min(1, 'verify_runs_on needs at least one label')
      .max(VERIFY_LIMITS.runsOn.maxItems, `verify_runs_on has at most ${VERIFY_LIMITS.runsOn.maxItems} labels`),
    verify_test_command: testCommandSchema.nullable(),
    verify_max_files: z.number().int().min(VERIFY_LIMITS.maxFiles.min).max(VERIFY_LIMITS.maxFiles.max),
    verify_max_lines: z.number().int().min(VERIFY_LIMITS.maxLines.min).max(VERIFY_LIMITS.maxLines.max),
    verify_protected_globs: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(VERIFY_LIMITS.protectedGlobs.maxLength)
          .refine((s) => !CONTROL_RE.test(s), 'a glob must be one line'),
      )
      .max(VERIFY_LIMITS.protectedGlobs.maxItems, `verify_protected_globs has at most ${VERIFY_LIMITS.protectedGlobs.maxItems} globs`),
    verify_second_judge: z.enum(SECOND_JUDGE_CHOICES),
    verify_second_judge_model: z
      .string()
      .trim()
      .min(1)
      .max(VERIFY_LIMITS.secondJudgeModel.max)
      .regex(/^[A-Za-z0-9._:/@+-]+$/, 'verify_second_judge_model is a model id such as gpt-5.4 or openai/gpt-5.4')
      .nullable(),
    auto_revert: z.enum(AUTO_REVERT_CHOICES),
  })
  .partial()
  .strict()

export type VerifySettingsPatch = z.infer<typeof verifySettingsPatchSchema>

/** A validated patch → the project_settings columns it changes (the keys already are columns). */
export function verifySettingsPatchToRow(patch: VerifySettingsPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(patch)) {
    if (value !== undefined) out[column] = value
  }
  return out
}

/** Settings → the project_settings columns, as GET verify-settings returns them. */
export function verifySettingsToRow(settings: VerifySettings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, column] of Object.entries(VERIFY_SETTINGS_FIELDS)) out[column] = settings[field as keyof VerifySettings]
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\/+/, '')
}

function baseName(path: string): string {
  return norm(path).split('/').pop() ?? path
}

/**
 * A test file: `__tests__/`, `test/`, `tests/`, `e2e/` anywhere in the path,
 * `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, `*_test.py`,
 * `*Test.java`, `*Tests.swift`.
 */
export function isTestPath(path: string): boolean {
  const p = norm(path)
  const base = baseName(p)
  return (
    /(^|\/)(__tests__|test|tests|e2e)\//.test(p) ||
    /\.(test|spec)\.[^/]+$/.test(base) ||
    /_test\.go$/.test(base) ||
    /^test_[^/]+\.py$/.test(base) ||
    /_test\.py$/.test(base) ||
    /Test\.java$/.test(base) ||
    /Tests\.swift$/.test(base)
  )
}

/** Jest/Vitest/pytest snapshot output. Counted by lines, never as a test file or source. */
export function isSnapshotPath(path: string): boolean {
  const p = norm(path)
  return /(^|\/)__snapshots__\//.test(p) || /\.snap$/.test(p)
}

/**
 * CI configuration. ADR 0035 names `.github/**`; the other common CI files
 * are held to the same rule, since a PR that edits CI can make it green.
 */
export function isCiConfigPath(path: string): boolean {
  const p = norm(path)
  return (
    /^\.github\//.test(p) ||
    /^\.circleci\//.test(p) ||
    /^\.buildkite\//.test(p) ||
    /^(\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|Jenkinsfile|\.travis\.ya?ml)$/.test(p)
  )
}

/** Images, fonts, media, archives and prose: not counted in the diff budget. `.mdx` is code. */
const NON_CODE_RE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|woff2?|ttf|otf|eot|mp3|mp4|mov|webm|wav|zip|gz|tgz|md|markdown|rst|txt)$/i

/**
 * A glob as a RegExp over a repo-relative path: `**` crosses folders, `*`
 * and `?` do not. A glob without `/` matches a file or folder name anywhere
 * (`*.sql`, `migrations`); one with `/` is anchored at the repo root.
 */
export function globToRegExp(glob: string): RegExp {
  const g = norm(glob.trim()).replace(/\/+$/, '')
  let body = ''
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]
    if (ch === '*') {
      if (g[i + 1] === '*') {
        // `**/` matches zero or more folders; a bare `**` matches anything.
        if (g[i + 2] === '/') {
          body += '(?:.*/)?'
          i += 2
        } else {
          body += '.*'
          i += 1
        }
      } else {
        body += '[^/]*'
      }
    } else if (ch === '?') {
      body += '[^/]'
    } else {
      body += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  const anchored = g.includes('/') ? `^${body}` : `(?:^|/)${body}`
  // A folder glob also covers everything under it.
  return new RegExp(`${anchored}(?:/.*)?$`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff analysis
// ─────────────────────────────────────────────────────────────────────────────

/** One entry of GitHub's GET /pulls/:n/files. A missing patch means binary or too large. */
export interface PrFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string | null
  previous_filename?: string | null
  /** The same field as the repo's PullRequestFile spells it. */
  previousFilename?: string | null
}

export const FORBIDDEN_MARKERS: ReadonlyArray<{ marker: string; re: RegExp; testOnly: boolean }> = [
  // Disabling or focusing tests: only in test files (`.skip(` is also an
  // ordinary method in application code, e.g. a stream or query builder).
  { marker: '.skip(', re: /\.skip\s*\(/, testOnly: true },
  { marker: '.only(', re: /\.only\s*\(/, testOnly: true },
  { marker: 'xit(', re: /(^|[^\w.$])xit\s*\(/, testOnly: true },
  { marker: 'xdescribe(', re: /(^|[^\w.$])xdescribe\s*\(/, testOnly: true },
  { marker: '@pytest.mark.skip', re: /@pytest\.mark\.skip/, testOnly: true },
  // Silencing the type checker, the linter or coverage: anywhere.
  { marker: '@ts-ignore', re: /@ts-ignore/, testOnly: false },
  { marker: '@ts-expect-error', re: /@ts-expect-error/, testOnly: false },
  { marker: 'eslint-disable', re: /eslint-disable/, testOnly: false },
  { marker: 'istanbul ignore', re: /istanbul\s+ignore/, testOnly: false },
  { marker: '# pragma: no cover', re: /#\s*pragma:\s*no\s*cover/i, testOnly: false },
]

/**
 * One assertion per line, across the common runners: expect(…), assert…(…)
 * and Python's `assert x`, Chai's .should, XCTAssert…, assertThat, Node's
 * `t.is/…`, Go's `require.X(`.
 */
const ASSERTION_RE =
  /\bexpect\s*\(|\bassert\w*\s*[.(]|^\s*assert\s|\.should\b|\bXCTAssert\w*\s*\(|\bassertThat\s*\(|\bt\.(?:is|not|true|false|deepEqual|equal|throws|assert|regex)\w*\s*\(|\brequire\.\w+\s*\(/

/** Snapshot updates above this many changed lines fail the protected-paths gate. */
export const SNAPSHOT_LINE_LIMIT = 50

export interface DiffAnalysis {
  totalFiles: number
  /** GitHub listed every changed file (≤ 300). */
  complete: boolean
  /** Non-test code files counted by the diff budget (no lockfiles, snapshots, images or prose). */
  sourceFiles: string[]
  sourceLines: number
  testFiles: string[]
  testLines: number
  testFilesDeleted: string[]
  /** Assertion lines removed and added, per test file that changed any. */
  assertions: Array<{ file: string; removed: number; added: number }>
  /** Test files where more assertion lines were removed than added. */
  assertionsWeakened: string[]
  /** Forbidden markers added (net of removals) per file. */
  markersAdded: Array<{ file: string; marker: string; count: number }>
  ciConfigTouched: string[]
  lockfilesTouched: string[]
  snapshotFiles: string[]
  snapshotLines: number
  /** Files matching one of the project's protected globs. */
  protectedTouched: Array<{ file: string; glob: string }>
  /** Test files GitHub sent no patch for: nobody can count their assertions. */
  unreadableTestFiles: string[]
}

function changedLines(patch: string | null | undefined): { added: string[]; removed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  // GitHub's per-file patch starts at the first hunk: every line that starts
  // with + or - is a change (a removed "-- comment" reads "--- comment").
  for (const line of (patch ?? '').split('\n')) {
    if (line.startsWith('+')) added.push(line.slice(1))
    else if (line.startsWith('-')) removed.push(line.slice(1))
  }
  return { added, removed }
}

function countMatching(lines: string[], re: RegExp): number {
  let n = 0
  for (const l of lines) if (re.test(l)) n++
  return n
}

export function analyzeDiff(files: PrFile[], opts: { complete?: boolean; protectedGlobs?: readonly string[] } = {}): DiffAnalysis {
  const globs = (opts.protectedGlobs ?? []).filter((g) => g.trim()).map((g) => ({ glob: g, re: globToRegExp(g) }))
  const out: DiffAnalysis = {
    totalFiles: files.length,
    complete: opts.complete !== false,
    sourceFiles: [],
    sourceLines: 0,
    testFiles: [],
    testLines: 0,
    testFilesDeleted: [],
    assertions: [],
    assertionsWeakened: [],
    markersAdded: [],
    ciConfigTouched: [],
    lockfilesTouched: [],
    snapshotFiles: [],
    snapshotLines: 0,
    protectedTouched: [],
    unreadableTestFiles: [],
  }

  for (const f of files) {
    const path = norm(f.filename)
    const previous = f.previous_filename ?? f.previousFilename ?? null
    const lines = (f.additions || 0) + (f.deletions || 0)
    const paths = previous ? [path, norm(previous)] : [path]

    for (const { glob, re } of globs) {
      if (paths.some((p) => re.test(p))) out.protectedTouched.push({ file: path, glob })
    }
    if (paths.some(isCiConfigPath)) out.ciConfigTouched.push(path)
    if (paths.some(isLockFile)) {
      out.lockfilesTouched.push(path)
      continue
    }
    if (isSnapshotPath(path) || (previous && isSnapshotPath(previous))) {
      out.snapshotFiles.push(path)
      out.snapshotLines += lines
      continue
    }

    const isTest = isTestPath(path)
    const wasTest = previous ? isTestPath(previous) : isTest
    // Deleted, or renamed out of the test folders: the test is gone either way.
    if (f.status === 'removed' && isTest) out.testFilesDeleted.push(path)
    else if (wasTest && !isTest) out.testFilesDeleted.push(norm(previous!))

    const { added, removed } = changedLines(f.patch)
    if (isTest) {
      out.testFiles.push(path)
      out.testLines += lines
      if (f.patch == null && lines > 0) out.unreadableTestFiles.push(path)
      const a = { file: path, removed: countMatching(removed, ASSERTION_RE), added: countMatching(added, ASSERTION_RE) }
      if (a.removed > 0 || a.added > 0) out.assertions.push(a)
      if (a.removed > a.added) out.assertionsWeakened.push(path)
    } else if (!NON_CODE_RE.test(path)) {
      out.sourceFiles.push(path)
      out.sourceLines += lines
    }

    for (const m of FORBIDDEN_MARKERS) {
      if (m.testOnly && !isTest) continue
      const net = countMatching(added, m.re) - countMatching(removed, m.re)
      if (net > 0) out.markersAdded.push({ file: path, marker: m.marker, count: net })
    }
  }
  return out
}

/**
 * Lockfiles may change when the report is about a dependency (ADR 0035).
 * Report categories have no "dependency" value, so this reads the report's
 * own words; a false "no" only means a person merges the PR.
 */
export function isDependencyReport(report: { summary?: string | null; description?: string | null; component?: string | null } | null): boolean {
  if (!report) return false
  const text = `${report.summary ?? ''}\n${report.component ?? ''}\n${(report.description ?? '').slice(0, 4000)}`
  return /\b(dependenc(?:y|ies)|upgrade|bump(?:ed|s)?|outdated|vulnerab\w*|CVE-\d{4}-\d+|lock ?file|npm audit|package version)\b/i.test(text)
}

// ─────────────────────────────────────────────────────────────────────────────
// Gates 5 and 6: protected paths and the diff budget
// ─────────────────────────────────────────────────────────────────────────────

function listOf(paths: string[], max = 3): string {
  const shown = paths.slice(0, max).join(', ')
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown
}

export function protectedGate(a: DiffAnalysis, opts: { allowLockfiles?: boolean } = {}): VerifyGate {
  const problems: string[] = []
  if (!a.complete) problems.push('GitHub listed only part of the changed files')
  if (a.testFilesDeleted.length > 0) problems.push(`deletes test file ${listOf(a.testFilesDeleted)}`)
  if (a.assertionsWeakened.length > 0) problems.push(`removes assertions from ${listOf(a.assertionsWeakened)}`)
  if (a.unreadableTestFiles.length > 0) problems.push(`changes test file ${listOf(a.unreadableTestFiles)} that GitHub would not show`)
  if (a.markersAdded.length > 0) {
    const markers = [...new Set(a.markersAdded.map((m) => m.marker))]
    problems.push(`adds ${markers.join(', ')}`)
  }
  if (a.ciConfigTouched.length > 0) problems.push(`changes CI config ${listOf(a.ciConfigTouched)}`)
  if (a.lockfilesTouched.length > 0 && !opts.allowLockfiles) problems.push(`changes lockfile ${listOf(a.lockfilesTouched)}`)
  if (a.snapshotLines > SNAPSHOT_LINE_LIMIT) problems.push(`updates ${a.snapshotLines} snapshot lines (limit ${SNAPSHOT_LINE_LIMIT})`)
  if (a.protectedTouched.length > 0) problems.push(`touches protected path ${listOf([...new Set(a.protectedTouched.map((p) => p.file))])}`)

  const evidence = {
    testFilesDeleted: a.testFilesDeleted.slice(0, 20),
    assertionsWeakened: a.assertions.filter((x) => x.removed > x.added).slice(0, 20),
    markersAdded: a.markersAdded.slice(0, 20),
    ciConfigTouched: a.ciConfigTouched.slice(0, 20),
    lockfilesTouched: a.lockfilesTouched.slice(0, 20),
    snapshotLines: a.snapshotLines,
    protectedTouched: a.protectedTouched.slice(0, 20),
    unreadableTestFiles: a.unreadableTestFiles.slice(0, 20),
    complete: a.complete,
  }
  if (problems.length === 0) {
    return { id: 'protected', status: 'pass', label: 'No tests weakened', detail: 'No test was deleted or weakened, and no CI config, lockfile or protected path changed.', evidence }
  }
  return {
    id: 'protected',
    status: 'fail',
    label: 'Tests or protected paths changed',
    detail: `The PR ${problems.join('; ')}. Undo those changes, or read the PR and merge it yourself.`,
    evidence,
  }
}

export function budgetGate(a: DiffAnalysis, limits: { maxFiles: number; maxLines: number }): VerifyGate {
  const files = a.sourceFiles.length
  const lines = a.sourceLines
  const size = `${files} file${files === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'}`
  const evidence = { files, lines, maxFiles: limits.maxFiles, maxLines: limits.maxLines, sourceFiles: a.sourceFiles.slice(0, 30), complete: a.complete }
  if (!a.complete) {
    return { id: 'budget', status: 'fail', label: `Too big to merge on its own (over ${a.totalFiles} files)`, detail: 'GitHub listed only part of this PR; read it and merge it yourself.', evidence }
  }
  if (files <= limits.maxFiles && lines <= limits.maxLines) {
    return { id: 'budget', status: 'pass', label: `Small change (${size})`, detail: `Within the budget of ${limits.maxFiles} files and ${limits.maxLines} lines.`, evidence }
  }
  return {
    id: 'budget',
    status: 'fail',
    label: `Too big to merge on its own (${size})`,
    detail: `Mushi merges on its own only up to ${limits.maxFiles} files and ${limits.maxLines} changed lines outside tests; read it and merge it yourself, or raise the budget under Settings → Fixes.`,
    evidence,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate 4: the Mushi verify check run
// ─────────────────────────────────────────────────────────────────────────────

/** A check run as GitHub's GET /commits/:sha/check-runs returns it (the fields read here). */
export interface VerifyCheckRunLike {
  id?: number | null
  name?: string | null
  status?: string | null
  conclusion?: string | null
  head_sha?: string | null
  started_at?: string | null
  completed_at?: string | null
  html_url?: string | null
  output?: { title?: string | null; summary?: string | null; text?: string | null } | null
}

export const VERIFY_HEAD_RESULTS = ['pass', 'fail', 'error'] as const
export const VERIFY_BASE_RESULTS = ['fail', 'pass', 'error', 'skipped'] as const
export const VERIFY_VERDICTS = ['fail_to_pass', 'no_test', 'passes_without_fix', 'fails_with_fix', 'error'] as const
export type VerifyVerdict = (typeof VERIFY_VERDICTS)[number]

const SHA_RE = /^[0-9a-f]{7,64}$/i

/** The check run's output.text, as the composite action writes it (schema 1). */
export const verifyResultSchema = z.object({
  schema: z.literal(1),
  head_sha: z.string().regex(SHA_RE),
  base_sha: z.string().regex(SHA_RE).nullable().optional(),
  tests: z.array(z.string().max(500)).max(500),
  head: z.enum(VERIFY_HEAD_RESULTS),
  base: z.enum(VERIFY_BASE_RESULTS),
  verdict: z.enum(VERIFY_VERDICTS),
  command: z.string().max(2000).nullable().optional(),
  runner: z.string().max(200).nullable().optional(),
  duration_s: z.number().nonnegative().nullable().optional(),
  log_tail: z.string().nullable().optional(),
})

export type VerifyResult = z.infer<typeof verifyResultSchema>

/** The JSON in output.text, or null for anything that is not a schema-1 result. Tolerates a ```json fence. */
export function parseVerifyResult(text: string | null | undefined): VerifyResult | null {
  if (typeof text !== 'string' || !text.trim()) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const raw = (fenced ? fenced[1] : text).trim()
  if (raw.length > 200_000) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = verifyResultSchema.safeParse(json)
  if (!parsed.success) return null
  const r = parsed.data
  // A verdict that contradicts its own runs is not a result.
  if (r.verdict === 'fail_to_pass' && (r.head !== 'pass' || r.base !== 'fail' || r.tests.length === 0)) return null
  return { ...r, log_tail: typeof r.log_tail === 'string' ? r.log_tail.slice(-4000) : null }
}

/** The newest **Mushi verify** check run among a commit's check runs. */
export function findVerifyCheck<T extends VerifyCheckRunLike>(checks: readonly T[]): T | null {
  const mine = checks.filter((c) => (c.name ?? '').trim().toLowerCase() === VERIFY_CHECK_NAME.toLowerCase())
  if (mine.length === 0) return null
  return [...mine].sort((a, b) => {
    const t = String(b.started_at ?? '').localeCompare(String(a.started_at ?? ''))
    return t !== 0 ? t : (b.id ?? 0) - (a.id ?? 0)
  })[0]
}

const VERDICT_GATE: Record<Exclude<VerifyVerdict, 'fail_to_pass'>, { label: string; detail: string }> = {
  no_test: {
    label: 'No test proves the fix',
    detail: 'The PR adds or changes no test. Ask for a test that fails without the fix and passes with it.',
  },
  passes_without_fix: {
    label: 'Tests pass without the fix',
    detail: 'The changed tests also pass on the base branch, so they do not prove the fix. Ask for a test that fails without it.',
  },
  fails_with_fix: {
    label: 'Tests fail with the fix',
    detail: 'The PR\'s own tests fail on the PR. Fix the code or the test and push.',
  },
  error: {
    label: 'Mushi verify could not run the tests',
    detail: 'Check the test command under Settings → Fixes → Verified merge and the job log, then re-run Mushi verify.',
  },
}

/** Read one **Mushi verify** check run against the PR head. Anything unreadable fails; it never passes. */
export function readVerifyCheck(checkRun: VerifyCheckRunLike, headSha: string): VerifyGate {
  const base = { id: 'fail_to_pass' as const }
  const link = checkRun.html_url ?? null
  if ((checkRun.status ?? '').toLowerCase() !== 'completed') {
    return { ...base, status: 'pending', label: 'Mushi verify is running', detail: 'The proof run has not finished; Mushi checks again in 10 minutes.', evidence: { checkUrl: link } }
  }
  const result = parseVerifyResult(checkRun.output?.text)
  if (!result) {
    return {
      ...base,
      status: 'fail',
      label: 'Mushi verify: could not read result',
      detail: 'The Mushi verify check has no result Mushi can read. Update the mushi-verify workflow from Settings → Fixes and re-run it.',
      evidence: { checkUrl: link, conclusion: checkRun.conclusion ?? null },
    }
  }
  const evidence = {
    checkUrl: link,
    verdict: result.verdict,
    head: result.head,
    base: result.base,
    tests: result.tests.slice(0, 20),
    runner: result.runner ?? null,
    durationS: result.duration_s ?? null,
    command: result.command ?? null,
    resultHeadSha: result.head_sha,
    baseSha: result.base_sha ?? null,
  }
  if (result.head_sha.toLowerCase() !== headSha.toLowerCase() && !headSha.toLowerCase().startsWith(result.head_sha.toLowerCase())) {
    return {
      ...base,
      status: 'fail',
      label: 'Mushi verify: result is for another commit',
      detail: 'The proof was run on a different commit than the PR head. Re-run Mushi verify on the latest commit.',
      evidence,
    }
  }
  if (result.verdict === 'fail_to_pass') {
    const n = result.tests.length
    return {
      ...base,
      status: 'pass',
      label: 'Test proves the fix',
      detail: `${n} test file${n === 1 ? '' : 's'} failed without the fix and passed with it${result.runner ? ` on ${result.runner}` : ''}.`,
      evidence,
    }
  }
  return { ...base, status: 'fail', ...VERDICT_GATE[result.verdict], evidence }
}

/** Gate 4 from all of the head's check runs, and whether the host has the workflow. */
export function failToPassGate(checks: readonly VerifyCheckRunLike[], headSha: string, workflowInstalled: boolean | null): VerifyGate {
  const check = findVerifyCheck(checks)
  if (check) return readVerifyCheck(check, headSha)
  if (workflowInstalled === false) {
    return {
      id: 'fail_to_pass',
      status: 'not_set_up',
      label: 'Mushi verify is not set up',
      detail: `Add ${VERIFY_WORKFLOW_PATH} (Settings → Fixes → Verified merge) so Mushi can prove a fix with a test.`,
    }
  }
  return {
    id: 'fail_to_pass',
    status: 'pending',
    label: 'Waiting for Mushi verify',
    detail: workflowInstalled === true
      ? 'The mushi-verify workflow has not reported on this commit yet; it runs on agent branches (cursor/, mushi/, copilot/).'
      : 'Mushi could not tell whether the mushi-verify workflow is installed; it checks again in 10 minutes.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate 3: CI
// ─────────────────────────────────────────────────────────────────────────────

/** Review bots that post a check run instead of testing (github.ts isAdvisoryCheckRun). */
const ADVISORY_CHECKS = new Set(['copilot-pull-request-reviewer'])

/** Checks the CI gate ignores: review bots, and the verify check and its own job (gate 4 reads those). */
export function isCiGateCheck(check: { name?: string | null }): boolean {
  const name = (check.name ?? '').trim().toLowerCase()
  if (ADVISORY_CHECKS.has(name)) return false
  return !name.startsWith(VERIFY_CHECK_NAME.toLowerCase())
}

type NamedVerdict = CiJobVerdict & { name: string }

/** Stands in for the runner a started check run must have had (check runs do not name it). */
const CHECK_RUN_RUNNER = '\u0000check-run'

/**
 * Gate 3: every completed check on the head is green. Each check run is
 * classified by `classifyCiJob` (ADR 0033); a check whose job the CI
 * collector already called an infra stop (`fix_attempts.ci_infra`, matched by
 * job name) takes that verdict. An infra stop is pending, never a pass and
 * never a code failure.
 */
export function ciGate(
  checks: readonly VerifyCheckRunLike[],
  opts: { now: Date; ciInfra?: unknown; annotations?: Readonly<Record<string, readonly string[]>> },
): VerifyGate {
  const infra = readFixCiInfra(opts.ciInfra)
  const relevant = checks.filter(isCiGateCheck)
  if (relevant.length === 0) {
    return { id: 'ci', status: 'pending', label: 'Waiting for CI', detail: 'No CI check has reported on this commit yet; Mushi merges only after CI passes.', evidence: { checks: 0 } }
  }
  const verdicts: NamedVerdict[] = relevant.map((c) => {
    const name = (c.name ?? '').trim() || 'check'
    const status = (c.status ?? '').toLowerCase()
    // A check run names no runner. One that started or finished ran on one,
    // so it is classified as taken (a failure is the code's, a cancel is a
    // cancel) unless an annotation or the collector's job verdict says the
    // runner died; a queued one still turns into waiting_for_runner.
    const ran = status === 'completed' || status === 'in_progress'
    const v = classifyCiJob(
      {
        status: c.status ?? null,
        conclusion: c.conclusion ?? null,
        created_at: c.started_at ?? null,
        started_at: c.started_at ?? null,
        completed_at: c.completed_at ?? null,
        runner_name: ran ? CHECK_RUN_RUNNER : null,
      },
      { now: opts.now, annotations: opts.annotations?.[name] ?? null },
    )
    if (v.runner === CHECK_RUN_RUNNER) v.runner = null
    if (infra?.infra && infra.job && infra.job === name && (v.kind === 'code_failure' || v.kind === 'cancelled' || v.kind === 'queued')) {
      return { ...v, kind: infra.kind as CiJobVerdict['kind'], infra: true, runner: infra.runner, detail: infra.detail, name }
    }
    return { ...v, name }
  })
  const summary = summarizeCiJobs(verdicts)
  const worst = summary.worst
  const evidence = { checks: summary.jobs, counts: summary.counts, worst: worst ? { name: worst.name, kind: worst.kind, detail: worst.detail } : null }
  switch (summary.kind) {
    case 'passed':
    case 'skipped':
      return { id: 'ci', status: 'pass', label: `CI passed (${summary.jobs} check${summary.jobs === 1 ? '' : 's'})`, detail: 'Every completed check on this commit is green.', evidence }
    case 'code_failure':
    case 'cancelled':
      return {
        id: 'ci',
        status: 'fail',
        label: `CI failed${worst ? ` (${worst.name})` : ''}`,
        detail: 'Fix the failing check and push; Mushi checks the new commit from the start.',
        evidence,
      }
    case 'waiting_for_runner':
    case 'runner_lost':
    case 'queue_expired':
      return {
        id: 'ci',
        status: 'pending',
        label: `CI did not finish (${describeCiInfra({ kind: summary.kind, runner: worst?.runner ?? null })})`,
        detail: 'The test machine stopped, which is not a code failure. Re-run the tests.',
        evidence,
      }
    default:
      return { id: 'ci', status: 'pending', label: 'CI is running', detail: 'Mushi checks again in 10 minutes.', evidence }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gates 1 and 2: the two model reviews (vetoes, never approvals on their own)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewGateInput {
  status: string | null
  verdict: ReviewVerdict | null
  /** The commit the verdict is about. */
  headSha: string | null
  /** Why the latest run was skipped, in a sentence (skipped / failed rows). */
  reason?: string | null
}

const VERDICT_WORDS: Record<ReviewVerdict, string> = { merge: 'merge', fix_first: 'fix first', hold: 'hold' }

export function reviewGate(review: ReviewGateInput | null, headSha: string): VerifyGate {
  const id = 'review' as const
  if (!review || (!review.verdict && (review.status === 'queued' || review.status === 'running' || !review.status))) {
    return { id, status: 'pending', label: 'Waiting for the Opus review', detail: 'The Opus review of this pull request has not finished yet.' }
  }
  if (!review.verdict) {
    return {
      id,
      status: 'unavailable',
      label: review.status === 'skipped' ? 'Opus review skipped' : 'Opus review failed',
      detail: `${review.reason ? `${review.reason.replace(/\.$/, '')}. ` : ''}Without an Opus review Mushi does not merge on its own; re-run the review from the fix.`,
    }
  }
  if (review.headSha && review.headSha !== headSha) {
    return {
      id,
      status: 'pending',
      label: `Opus review: ${VERDICT_WORDS[review.verdict]} (older commit)`,
      detail: 'The review is about an older commit; Mushi waits for the review of the latest one.',
      evidence: { reviewedHeadSha: review.headSha },
    }
  }
  if (review.verdict === 'merge') {
    return { id, status: 'pass', label: 'Opus review: merge', detail: 'The Opus review found nothing that blocks a merge.' }
  }
  return {
    id,
    status: 'fail',
    label: `Opus review: ${VERDICT_WORDS[review.verdict]}`,
    detail: review.verdict === 'hold'
      ? 'The Opus review says hold. Read its findings; only a person can override a hold.'
      : 'Fix the Opus review\'s findings and push; the new commit is reviewed again.',
  }
}

/** What the second-family review stored (fix_merge_gates.second_judge). Model fields are untrusted output. */
export interface SecondJudgeRecord {
  provider: 'openai' | 'openrouter'
  model: string
  verdict: ReviewVerdict | null
  findings: ReviewFinding[]
  summary: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  at: string
  /** The call failed; `tries` counts failed calls on this head. */
  error?: string | null
  tries?: number
}

export type SecondJudgeState =
  | { kind: 'result'; record: SecondJudgeRecord }
  | { kind: 'unavailable'; reason: 'off' | 'no_key' | 'budget'; detail?: string }
  | null

/** Calls on one head that may fail before the gate stops retrying. */
export const SECOND_JUDGE_MAX_TRIES = 3

export const SECOND_JUDGE_DEFAULT_MODEL = { openai: 'gpt-5.4', openrouter: 'openai/gpt-5.4' } as const

/** Read a stored second_judge jsonb defensively. */
export function readSecondJudge(value: unknown): SecondJudgeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const provider = v.provider === 'openai' || v.provider === 'openrouter' ? v.provider : null
  if (!provider || typeof v.model !== 'string' || typeof v.at !== 'string') return null
  const verdict = v.verdict === 'merge' || v.verdict === 'fix_first' || v.verdict === 'hold' ? v.verdict : null
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  return {
    provider,
    model: v.model,
    verdict,
    findings: Array.isArray(v.findings) ? (v.findings as ReviewFinding[]) : [],
    summary: typeof v.summary === 'string' ? v.summary : null,
    input_tokens: num(v.input_tokens),
    output_tokens: num(v.output_tokens),
    cost_usd: num(v.cost_usd),
    at: v.at,
    error: typeof v.error === 'string' ? v.error : null,
    tries: typeof v.tries === 'number' ? v.tries : undefined,
  }
}

/** Should the worker call the second judge now? Not after a verdict; after errors, until the try cap. */
export function secondJudgeDue(record: SecondJudgeRecord | null): boolean {
  if (!record) return true
  if (record.verdict) return false
  return (record.tries ?? 1) < SECOND_JUDGE_MAX_TRIES
}

export function secondReviewGate(state: SecondJudgeState, othersPass: boolean): VerifyGate {
  const id = 'second_review' as const
  if (!othersPass) {
    return {
      id,
      status: 'pending',
      label: 'Second review waits for the other checks',
      detail: 'It runs once the Opus review, CI, the test proof, protected paths and the size check pass.',
    }
  }
  if (!state) return { id, status: 'pending', label: 'Second review running', detail: 'A second model family is reviewing this commit.' }
  if (state.kind === 'unavailable') {
    const words = {
      off: { label: 'Second review is off', detail: 'Turn it on under Settings → Fixes → Verified merge; Mushi merges on its own only with it.' },
      no_key: { label: 'Second review unavailable', detail: 'Add an OpenAI or OpenRouter key under Settings → AI keys; until then Mushi does not merge on its own.' },
      budget: { label: 'Second review unavailable', detail: 'This app\'s monthly AI budget is used up; Mushi does not merge on its own until it resets or is raised.' },
    }[state.reason]
    return { id, status: 'unavailable', label: words.label, detail: state.detail ?? words.detail }
  }
  const r = state.record
  const evidence = { provider: r.provider, model: r.model, verdict: r.verdict, findings: r.findings.length, costUsd: r.cost_usd }
  if (!r.verdict) {
    const exhausted = !secondJudgeDue(r)
    return {
      id,
      status: exhausted ? 'unavailable' : 'pending',
      label: exhausted ? 'Second review failed' : 'Second review will retry',
      detail: exhausted
        ? `The second review failed ${r.tries ?? 1} times on this commit; re-check the fix to try again.`
        : 'The second review did not finish; Mushi tries again in 10 minutes.',
      evidence,
    }
  }
  const label = `Second review (${r.model}): ${VERDICT_WORDS[r.verdict]}`
  if (r.verdict === 'merge') return { id, status: 'pass', label, detail: 'A second model family found nothing that blocks a merge.', evidence }
  return { id, status: 'fail', label, detail: 'A second model family found problems; read its findings and merge it yourself if you disagree.', evidence }
}

// ─────────────────────────────────────────────────────────────────────────────
// All six gates
// ─────────────────────────────────────────────────────────────────────────────

export interface VerificationInput {
  headSha: string
  review: ReviewGateInput | null
  checks: readonly VerifyCheckRunLike[]
  /** fix_attempts.ci_infra (Plan 022). */
  ciInfra?: unknown
  workflowInstalled: boolean | null
  files: PrFile[]
  filesComplete: boolean
  settings: Pick<VerifySettings, 'verifyMaxFiles' | 'verifyMaxLines' | 'verifyProtectedGlobs'>
  /** The report is about a dependency: lockfile changes are allowed. */
  allowLockfiles?: boolean
  secondJudge: SecondJudgeState
  now: Date
}

export interface VerificationResult {
  /** In VERIFY_GATE_ORDER. */
  gates: VerifyGate[]
  /** Every gate passes. */
  passed: boolean
  /** Gates 1 and 3 to 6 pass: the second review may run. */
  othersPass: boolean
  analysis: DiffAnalysis
}

export function evaluateVerification(input: VerificationInput): VerificationResult {
  const analysis = analyzeDiff(input.files, { complete: input.filesComplete, protectedGlobs: input.settings.verifyProtectedGlobs })
  const first = [
    reviewGate(input.review, input.headSha),
    ciGate(input.checks, { now: input.now, ciInfra: input.ciInfra }),
    failToPassGate(input.checks, input.headSha, input.workflowInstalled),
    protectedGate(analysis, { allowLockfiles: input.allowLockfiles }),
    budgetGate(analysis, { maxFiles: input.settings.verifyMaxFiles, maxLines: input.settings.verifyMaxLines }),
  ]
  const othersPass = first.every((g) => g.status === 'pass')
  const gates = [...first, secondReviewGate(input.secondJudge, othersPass)]
  return { gates, passed: gates.every((g) => g.status === 'pass'), othersPass, analysis }
}

/** Read a stored gates jsonb defensively (display, MCP); unknown entries are dropped. */
export function readGates(value: unknown): VerifyGate[] {
  if (!Array.isArray(value)) return []
  const out: VerifyGate[] = []
  for (const g of value) {
    if (!g || typeof g !== 'object') continue
    const v = g as Record<string, unknown>
    if (!(VERIFY_GATE_ORDER as readonly string[]).includes(String(v.id))) continue
    if (!(VERIFY_GATE_STATUSES as readonly string[]).includes(String(v.status))) continue
    out.push({
      id: v.id as VerifyGateId,
      status: v.status as VerifyGateStatus,
      label: typeof v.label === 'string' ? v.label : String(v.id),
      detail: typeof v.detail === 'string' ? v.detail : '',
      ...(v.evidence && typeof v.evidence === 'object' ? { evidence: v.evidence as Record<string, unknown> } : {}),
    })
  }
  return out
}

/**
 * Is this head's verification settled, so the 10-minute re-check can skip
 * it? A gate that is deterministic for the commit failed (review verdict,
 * protected paths, budget, second review), or the merge already happened or
 * failed. Pending gates, a CI or proof failure (both can be re-run), and a
 * passed head waiting on the switch or the daily cap stay open.
 */
export function isVerificationFinal(row: { gates: unknown; passed: boolean; auto_merge_state: string | null }): boolean {
  if (row.auto_merge_state === 'merged' || row.auto_merge_state === 'failed') return true
  const gates = readGates(row.gates)
  if (gates.length === 0) return false
  return gates.some((g) => g.status === 'fail' && (g.id === 'review' || g.id === 'protected' || g.id === 'budget' || g.id === 'second_review'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Automatic merge
// ─────────────────────────────────────────────────────────────────────────────

export function utcDayStart(now: Date): string {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export type AutoMergeDecision =
  | { merge: true; state: 'eligible'; detail: string }
  | { merge: false; state: 'none' | 'skipped'; detail: string | null }

/**
 * May the worker merge this head now? Only when every gate passed, the app
 * turned verified merge on, the report is not fixed already, the PR is open,
 * and fewer than the daily limit merged automatically today (UTC).
 */
export function autoMergeDecision(input: {
  passed: boolean
  settings: Pick<VerifySettings, 'verifiedAutoMerge' | 'verifiedAutoMergeDailyLimit'>
  mergedToday: number
  reportStatus: string | null
  prOpen: boolean
}): AutoMergeDecision {
  if (!input.passed) return { merge: false, state: 'none', detail: null }
  if (!input.prOpen) return { merge: false, state: 'skipped', detail: 'The pull request is no longer open.' }
  if (!input.settings.verifiedAutoMerge) {
    return { merge: false, state: 'skipped', detail: 'Every check passed. Automatic merge is off for this app, so merge it yourself or turn on Verified merge.' }
  }
  if (input.reportStatus === 'fixed') return { merge: false, state: 'skipped', detail: 'The report is already fixed.' }
  const limit = input.settings.verifiedAutoMergeDailyLimit
  if (input.mergedToday >= limit) {
    return { merge: false, state: 'skipped', detail: `Today's limit of ${limit} automatic merge${limit === 1 ? '' : 's'} for this app is reached; Mushi tries again tomorrow (UTC).` }
  }
  return { merge: true, state: 'eligible', detail: 'Every check passed; Mushi merges it.' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Regression watch and revert
// ─────────────────────────────────────────────────────────────────────────────

/** Mushi watches a merge this long. */
export const REGRESSION_WATCH_MS = 72 * 60 * 60_000

export const REGRESSION_SIGNALS = ['ci_failed_on_merge', 'report_reopened', 'new_report_in_changed_file'] as const
export type RegressionSignal = (typeof REGRESSION_SIGNALS)[number]

/** The two signals that mark a fix regressed and may open a revert; the third only flags it. */
export function signalRegresses(signal: RegressionSignal): boolean {
  return signal === 'ci_failed_on_merge' || signal === 'report_reopened'
}

export const REGRESSION_LABEL: Record<RegressionSignal, string> = {
  ci_failed_on_merge: 'CI failed on the merge commit',
  report_reopened: 'The report was reopened',
  new_report_in_changed_file: 'A new report points at a changed file',
}

/** Did default-branch CI on the merge commit fail on code (not on the test machine)? */
export function ciFailedOnMerge(checks: readonly VerifyCheckRunLike[], opts: { now: Date }): { failed: boolean; detail: string | null; evidence: Record<string, unknown> | null } {
  const gate = ciGate(checks, { now: opts.now })
  if (gate.status !== 'fail') return { failed: false, detail: null, evidence: null }
  return { failed: true, detail: gate.label, evidence: gate.evidence ?? null }
}

/** Was the report reopened after the merge? */
export function reportReopenedSince(report: { status?: string | null; reopened_at?: string | null } | null, mergedAt: string): boolean {
  if (!report) return false
  if (report.reopened_at && report.reopened_at > mergedAt) return true
  return report.status === 'reopened' && !report.reopened_at
}

/**
 * New reports whose stack frames name a file the merged PR changed. Frame
 * paths are matched the way report seeds match them (a bare file name only
 * when exactly one changed file has it).
 */
export function reportsInChangedFiles(
  reports: ReadonlyArray<{ id: string; framePaths: readonly string[] }>,
  changedFiles: readonly string[],
): Array<{ reportId: string; files: string[] }> {
  const out: Array<{ reportId: string; files: string[] }> = []
  for (const r of reports) {
    const files = matchFramePathsToTree(r.framePaths, changedFiles)
    if (files.length > 0) out.push({ reportId: r.id, files })
  }
  return out
}

/** GitHub's compare of merge_sha...default branch, as much as revert safety reads. */
export interface CompareSummary {
  status: string
  totalCommits: number
  commitsListed: number
  files: ReadonlyArray<{ filename: string; previous_filename?: string | null }>
}

/** GitHub lists at most this many files in a compare. */
export const COMPARE_FILE_LIMIT = 300

/**
 * May Mushi open a revert PR? Only when no commit after the merge touched any
 * file the PR changed: then restoring those files from the merge commit's
 * parent undoes exactly the fix. Anything Mushi cannot see in full is not safe.
 */
export function revertSafety(prFiles: readonly string[], compare: CompareSummary | null): { safe: boolean; reason: string; touched: string[] } {
  if (!compare) return { safe: false, reason: 'Mushi could not compare the merge commit with the default branch.', touched: [] }
  if (compare.status === 'identical') return { safe: true, reason: 'No commit landed after the merge.', touched: [] }
  if (compare.status !== 'ahead') {
    return { safe: false, reason: 'The merge commit is no longer on the default branch.', touched: [] }
  }
  if (compare.commitsListed < compare.totalCommits || compare.files.length >= COMPARE_FILE_LIMIT) {
    return { safe: false, reason: 'Too many commits landed after the merge to check them all.', touched: [] }
  }
  const later = new Set<string>()
  for (const f of compare.files) {
    later.add(norm(f.filename))
    if (f.previous_filename) later.add(norm(f.previous_filename))
  }
  const touched = [...new Set(prFiles.map(norm))].filter((p) => later.has(p))
  if (touched.length > 0) {
    return { safe: false, reason: `Later commits changed ${listOf(touched)}, so a revert could undo their work.`, touched }
  }
  return { safe: true, reason: 'No later commit touched the files this fix changed.', touched: [] }
}

/** Branch for a revert PR: `mushi/revert-<short merge sha>`. */
export function revertBranchName(mergeSha: string): string {
  return `mushi/revert-${mergeSha.slice(0, 7).toLowerCase()}`
}

export function revertPrBody(input: { signal: RegressionSignal; detail: string | null; prUrl: string | null; mergeSha: string }): string {
  return [
    `Mushi opened this revert because ${REGRESSION_LABEL[input.signal].toLowerCase()} after it merged ${input.prUrl ?? 'a verified fix'} (commit ${input.mergeSha.slice(0, 7)}).`,
    '',
    input.detail ? `Signal: ${input.detail}` : '',
    '',
    'It restores the files that fix changed to their state before the merge. No later commit touched them.',
    '',
    'Mushi never merges a revert on its own: read it and merge it if the fix caused the problem.',
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker batch
// ─────────────────────────────────────────────────────────────────────────────

/** Fix attempts checked per run, and per app per run. */
export const VERIFY_BATCH = 10
export const VERIFY_MAX_PER_PROJECT = 3
/** A head whose gates are not final is checked again after this long. */
export const VERIFY_RECHECK_MS = 10 * 60_000
/** A run's claim on a row expires after this long (a killed isolate). */
export const VERIFY_CLAIM_STALE_MS = 5 * 60_000
/** Manual re-checks per fix per hour. */
export const VERIFY_RERUNS_PER_HOUR = 6

/** In the order given, at most `batch` rows and at most `perProject` of one app. */
export function pickVerifyBatch<T extends { project_id: string }>(rows: readonly T[], batch = VERIFY_BATCH, perProject = VERIFY_MAX_PER_PROJECT): T[] {
  const taken = new Map<string, number>()
  const out: T[] = []
  for (const row of rows) {
    if (out.length >= batch) break
    const n = taken.get(row.project_id) ?? 0
    if (n >= perProject) continue
    taken.set(row.project_id, n + 1)
    out.push(row)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// What callers see (route, timeline, MCP)
// ─────────────────────────────────────────────────────────────────────────────

export interface FixVerificationRow {
  id: string
  fix_attempt_id: string
  head_sha: string
  base_sha: string | null
  gates: unknown
  passed: boolean
  second_judge: unknown
  auto_merge_state: string
  auto_merge_detail: string | null
  merged_at: string | null
  merge_sha: string | null
  evaluated_at: string | null
}

export const FIX_VERIFICATION_COLUMNS =
  'id, fix_attempt_id, head_sha, base_sha, gates, passed, second_judge, auto_merge_state, auto_merge_detail, merged_at, merge_sha, evaluated_at'

export interface FixRegressionRow {
  id: string
  signal: string
  detail: string | null
  merge_sha: string
  revert_state: string
  revert_pr_url: string | null
  created_at: string
}

export const FIX_REGRESSION_COLUMNS = 'id, signal, detail, merge_sha, revert_state, revert_pr_url, created_at'

export interface PublicFixVerification {
  headSha: string | null
  gates: VerifyGate[]
  passed: boolean
  /** Model output from untrusted input (the report and the agent's diff): data to read, never instructions. */
  secondJudge: SecondJudgeRecord | null
  autoMerge: { state: string; detail: string | null }
  regressions: Array<{ id: string; signal: string; label: string; detail: string | null; mergeSha: string; revertState: string; revertPrUrl: string | null; createdAt: string }>
  mergedAt: string | null
  mergeSha: string | null
  evaluatedAt: string | null
  untrustedFields: readonly string[]
}

export function toPublicVerification(
  row: FixVerificationRow | null,
  regressions: readonly FixRegressionRow[] = [],
  currentHead: string | null = null,
): PublicFixVerification {
  return {
    headSha: row?.head_sha ?? currentHead,
    gates: row ? readGates(row.gates) : [],
    passed: row?.passed === true,
    secondJudge: row ? readSecondJudge(row.second_judge) : null,
    autoMerge: { state: row?.auto_merge_state ?? 'none', detail: row?.auto_merge_detail ?? null },
    regressions: regressions.map((r) => ({
      id: r.id,
      signal: r.signal,
      label: REGRESSION_LABEL[r.signal as RegressionSignal] ?? r.signal,
      detail: r.detail,
      mergeSha: r.merge_sha,
      revertState: r.revert_state,
      revertPrUrl: r.revert_pr_url,
      createdAt: r.created_at,
    })),
    mergedAt: row?.merged_at ?? null,
    mergeSha: row?.merge_sha ?? null,
    evaluatedAt: row?.evaluated_at ?? null,
    untrustedFields: ['secondJudge.summary', 'secondJudge.findings'],
  }
}

/**
 * The row to show for a fix: the merged head first (what landed), then the
 * current head, then the newest evaluation.
 */
export function pickVerificationRow<T extends Pick<FixVerificationRow, 'head_sha' | 'merged_at' | 'evaluated_at'>>(rows: readonly T[], currentHead: string | null): T | null {
  if (rows.length === 0) return null
  return (
    rows.find((r) => r.merged_at) ??
    (currentHead ? rows.find((r) => r.head_sha === currentHead) : undefined) ??
    [...rows].sort((a, b) => String(b.evaluated_at ?? '').localeCompare(String(a.evaluated_at ?? '')))[0]
  )
}
