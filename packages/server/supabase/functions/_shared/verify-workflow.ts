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
 * has to update the workflow to get a fix to it). Mushi substitutes exactly
 * two lines: `runs-on: [ubuntu-latest]` and `test-command: "pnpm vitest run {files}"`. src/__tests__/verify-workflow.test.ts fails
 * when this copy and docs/templates/mushi-verify.yml differ.
 */

import { VERIFY_LIMITS, VERIFY_WORKFLOW_PATH } from './fix-verify.ts'

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

/**
 * The workflow for one project: its runs-on labels and its test command
 * (null keeps the template's example). The settings were validated on write
 * (one line, contains {files}, no GitHub expression); the labels are checked
 * again here because they land in YAML unquoted.
 */
export function fillVerifyWorkflow(settings: { verifyRunsOn: readonly string[]; verifyTestCommand: string | null }): string {
  const labels = settings.verifyRunsOn.length > 0 ? settings.verifyRunsOn : ['ubuntu-latest']
  let out = replaceOnce(VERIFY_WORKFLOW_TEMPLATE, RUNS_ON_LINE, `    runs-on: [${labels.map(yamlLabel).join(', ')}]`)
  if (settings.verifyTestCommand) {
    const cmd = settings.verifyTestCommand
    if (/[\r\n]/.test(cmd) || cmd.includes('${{')) throw new Error('test command must be one line without a GitHub expression')
    out = replaceOnce(out, TEST_COMMAND_LINE, `          test-command: ${yamlDoubleQuoted(cmd)}`)
  }
  return out
}
