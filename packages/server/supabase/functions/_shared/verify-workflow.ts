/**
 * FILE: packages/server/supabase/functions/_shared/verify-workflow.ts
 * PURPOSE: The host workflow that proves a fix (ADR 0035, Plan 024):
 *          docs/templates/mushi-verify.yml as a string, and the copy filled
 *          in with one project's runner labels and test command for
 *          GET /v1/admin/projects/:id/verify-workflow (copy, or a PR that adds
 *          it). Pure; no Deno globals.
 *
 * docs/templates/mushi-verify.yml is the source (it ships with the composite
 * action, .github/actions/fix-verify, which owns the logic, so a host never
 * has to update the workflow to get a fix to it). Mushi substitutes the
 * `runs-on: [ubuntu-latest]` line, the `test-command: "pnpm vitest run {files}"`
 * line, and the dependency setup block (pnpm in the template) to match the
 * repo (detectRepoToolchain, Plan 022 Phase 7b):
 *
 *   package manager  from the lockfile at the repo root: package-lock.json →
 *                    npm ci with setup-node's npm cache; pnpm-lock.yaml →
 *                    pnpm (the template); yarn.lock → yarn; bun.lock(b) → bun
 *   setup action     a repo-local `.github/actions/setup/action.yml` replaces
 *                    the toolchain steps (the repo knows how to install itself)
 *   runs-on          when the repo's workflows pick their runner from
 *                    `vars.<X>` and the project kept the default label, the
 *                    job reads `runs-on: ${{ vars.<X> || '<fallback>' }}`, so
 *                    it runs where the repo's other jobs run
 *
 * src/__tests__/verify-workflow.test.ts fails when this copy and
 * docs/templates/mushi-verify.yml differ.
 */

import { VERIFY_LIMITS, VERIFY_WORKFLOW_PATH } from './fix-verify.ts'
import { parseRepoWorkflows } from './ci-runs-on.ts'

export { VERIFY_WORKFLOW_PATH }

/** docs/templates/mushi-verify.yml, byte for byte. */
export const VERIFY_WORKFLOW_TEMPLATE = `# Mushi verify. Save as .github/workflows/mushi-verify.yml on your default branch.
# It proves an agent's fix before Mushi merges it on its own: the tests the PR
# adds or changes must pass with the fix, and fail when the PR's other files
# are put back the way they were. The result is a "Mushi verify" check on the
# PR. Mushi reads it with the GitHub access it already has; no secret needed.
# Docs: https://kensaur.us/mushi-mushi/docs/admin/verified-merge
name: Mushi verify

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  checks: write

concurrency:
  group: mushi-verify-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    # Agent branches only (cursor/**, mushi/**, copilot/**), and never a fork:
    # \`on.pull_request.branches\` filters the base branch, so the head is checked here.
    if: >-
      github.event.pull_request.head.repo.full_name == github.repository &&
      (startsWith(github.head_ref, 'cursor/') ||
       startsWith(github.head_ref, 'mushi/') ||
       startsWith(github.head_ref, 'copilot/'))
    # Not "Mushi verify": that name belongs to the check run the action posts.
    name: Mushi verify run
    runs-on: [ubuntu-latest]
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1
        with:
          # The commit the agent pushed, not GitHub's merge commit.
          ref: \${{ github.event.pull_request.head.sha }}
          # Full history, so the PR's merge base is here.
          fetch-depth: 0
          persist-credentials: false
      # Not Node? Swap these two steps for your toolchain's setup action
      # (actions/setup-python, actions/setup-go, …). The verify action itself
      # needs Node 20 or newer on the runner; setup-node gives you that.
      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271  # v4.1.0
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e  # v6.4.0
        with:
          # No version file? Replace with  node-version: 22
          node-version-file: .nvmrc  # or .node-version / package.json
          cache: pnpm  # npm or yarn for those; remove the pnpm step above
      # Install your dependencies the way your CI does, e.g.
      #   npm ci   |   yarn install --immutable   |   pip install -r requirements.txt
      - run: pnpm install --frozen-lockfile
      - uses: kensaurus/mushi-mushi/.github/actions/fix-verify@master
        with:
          # {files} becomes the test files the PR added or changed, quoted.
          # e.g. "npx jest {files}" or "pytest {files}"
          test-command: "pnpm vitest run {files}"
`

/** The two lines Mushi fills; each appears exactly once in the template. */
export const RUNS_ON_LINE = '    runs-on: [ubuntu-latest]'
export const TEST_COMMAND_LINE = '          test-command: "pnpm vitest run {files}"'

/** Plain YAML words that would not read back as the string they look like. */
const YAML_RESERVED = /^(?:y|n|yes|no|on|off|true|false|null|~)$/i

/** A runner label as a YAML flow item: bare when safe, else single-quoted. Labels are ^[A-Za-z0-9._-]{1,64}$. */
export function yamlLabel(label: string): string {
  if (!VERIFY_LIMITS.runsOn.label.test(label)) throw new Error(`not a runner label: ${label.slice(0, 64)}`)
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(label) && !YAML_RESERVED.test(label) ? label : `'${label}'`
}

/** A YAML double-quoted scalar, as the template writes the test command (backslash and quote escaped). */
export function yamlDoubleQuoted(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function replaceOnce(text: string, line: string, next: string): string {
  const at = text.indexOf(`${line}\n`)
  if (at < 0 || text.indexOf(`${line}\n`, at + 1) >= 0) throw new Error(`template line not found exactly once: ${line.trim()}`)
  return text.slice(0, at) + next + text.slice(at + line.length)
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface RepoToolchain {
  /** From the root lockfile; null when none was found (the template's pnpm stays). */
  packageManager: PackageManager | null
  /** Yarn 2+ (a `.yarnrc.yml` at the root): `--immutable` instead of `--frozen-lockfile`. */
  yarnBerry: boolean
  /** The repo has `.github/actions/setup/action.yml`. */
  localSetupAction: boolean
  /** The repo's workflows read their runner from this variable, with this fallback label. */
  runnerVariable: { name: string; fallback: string | null } | null
}

export const DEFAULT_TOOLCHAIN: RepoToolchain = { packageManager: null, yarnBerry: false, localSetupAction: false, runnerVariable: null }

export const LOCAL_SETUP_ACTION_PATH = '.github/actions/setup/action.yml'

/** Lockfile → package manager, most specific first (a repo with two lockfiles uses the first match). */
const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

/**
 * What the repo uses, from its root file names and its workflow files. Pure:
 * the caller lists the root and reads the workflows.
 */
export function detectRepoToolchain(input: {
  rootFiles: readonly string[]
  hasLocalSetupAction: boolean
  workflows: ReadonlyArray<{ path: string; text: string }>
}): RepoToolchain {
  const names = new Set(input.rootFiles)
  const packageManager = LOCKFILES.find(([file]) => names.has(file))?.[1] ?? null
  const counts = new Map<string, { n: number; fallbacks: Map<string, number> }>()
  for (const wf of parseRepoWorkflows(input.workflows)) {
    for (const job of wf.jobs) {
      if (job.kind !== 'follows_variable') continue
      for (const v of job.variables) {
        const e = counts.get(v) ?? { n: 0, fallbacks: new Map() }
        e.n++
        if (job.fallbackLabel) e.fallbacks.set(job.fallbackLabel, (e.fallbacks.get(job.fallbackLabel) ?? 0) + 1)
        counts.set(v, e)
      }
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0]
  const runnerVariable = top
    ? { name: top[0], fallback: [...top[1].fallbacks.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null }
    : null
  return { packageManager, yarnBerry: names.has('.yarnrc.yml'), localSetupAction: input.hasLocalSetupAction, runnerVariable }
}

/** The template's dependency setup block, from the "Not Node?" comment through the install step. */
export const SETUP_BLOCK_START = '      # Not Node? Swap these two steps for your toolchain\'s setup action\n'
export const SETUP_BLOCK_END = '      - run: pnpm install --frozen-lockfile\n'

const SETUP_NODE = `      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e  # v6.4.0
        with:
          # No version file? Replace with  node-version: 22
          node-version-file: .nvmrc  # or .node-version / package.json`

/** The dependency setup steps for one toolchain; null keeps the template's (pnpm). */
export function setupBlockFor(t: RepoToolchain): string | null {
  if (t.localSetupAction) {
    return `      # Your repository's own setup action installs the toolchain and dependencies.
      # The verify action needs Node 20 or newer on the runner.
      - uses: ./.github/actions/setup
`
  }
  switch (t.packageManager) {
    case 'npm':
      return `      # npm, from package-lock.json. The verify action needs Node 20 or newer.
${SETUP_NODE}
          cache: npm
      - run: npm ci
`
    case 'yarn':
      return `      # Yarn, from yarn.lock. The verify action needs Node 20 or newer.
${SETUP_NODE}
          cache: yarn
      - run: yarn install ${t.yarnBerry ? '--immutable' : '--frozen-lockfile'}
`
    case 'bun':
      return `      # Bun, from its lockfile. The verify action itself runs on Node 20 or newer.
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6  # v2.2.0
${SETUP_NODE}
      - run: bun install --frozen-lockfile
`
    default:
      return null
  }
}

/** The template's example test command, per package manager. */
export function defaultTestCommandFor(pm: PackageManager | null): string | null {
  switch (pm) {
    case 'npm':
      return 'npx vitest run {files}'
    case 'yarn':
      return 'yarn vitest run {files}'
    case 'bun':
      return 'bunx vitest run {files}'
    default:
      return null
  }
}

/** A GitHub variable name as the runs-on expression may read it. */
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

/** `runs-on: ${{ vars.X || 'fallback' }}` (the fallback is a checked label). */
export function runsOnVariableLine(variable: string, fallback: string): string {
  if (!VAR_NAME_RE.test(variable)) throw new Error(`not a variable name: ${variable.slice(0, 100)}`)
  if (!VERIFY_LIMITS.runsOn.label.test(fallback)) throw new Error(`not a runner label: ${fallback.slice(0, 64)}`)
  return `    runs-on: \${{ vars.${variable} || '${fallback}' }}`
}

/** True when the project kept the template's runner (nobody picked a label). */
function defaultRunsOn(labels: readonly string[]): boolean {
  return labels.length === 0 || (labels.length === 1 && labels[0] === 'ubuntu-latest')
}

function replaceBlock(text: string, start: string, end: string, next: string): string {
  const a = text.indexOf(start)
  const b = text.indexOf(end, a)
  if (a < 0 || b < 0 || text.indexOf(start, a + 1) >= 0) throw new Error('template setup block not found exactly once')
  return text.slice(0, a) + next + text.slice(b + end.length)
}

/**
 * The workflow for one project: its runs-on labels and its test command
 * (null keeps the template's example), fitted to the repo's toolchain when
 * Mushi could read it. The settings were validated on write (one line,
 * contains {files}, no GitHub expression); the labels are checked again here
 * because they land in YAML unquoted. Labels the project picked always win
 * over the repo's runner variable.
 */
export function fillVerifyWorkflow(
  settings: { verifyRunsOn: readonly string[]; verifyTestCommand: string | null },
  toolchain: RepoToolchain = DEFAULT_TOOLCHAIN,
): string {
  const labels = settings.verifyRunsOn.length > 0 ? settings.verifyRunsOn : ['ubuntu-latest']
  const runsOn =
    toolchain.runnerVariable && defaultRunsOn(settings.verifyRunsOn)
      ? runsOnVariableLine(toolchain.runnerVariable.name, toolchain.runnerVariable.fallback ?? labels[0])
      : `    runs-on: [${labels.map(yamlLabel).join(', ')}]`
  let out = replaceOnce(VERIFY_WORKFLOW_TEMPLATE, RUNS_ON_LINE, runsOn)
  const block = setupBlockFor(toolchain)
  if (block) out = replaceBlock(out, SETUP_BLOCK_START, SETUP_BLOCK_END, block)
  const cmd = settings.verifyTestCommand ?? defaultTestCommandFor(toolchain.localSetupAction ? null : toolchain.packageManager)
  if (cmd) {
    if (/[\r\n]/.test(cmd) || cmd.includes('${{')) throw new Error('test command must be one line without a GitHub expression')
    out = replaceOnce(out, TEST_COMMAND_LINE, `          test-command: ${yamlDoubleQuoted(cmd)}`)
  }
  return out
}
