/**
 * FILE: verify-workflow.test.ts
 * PURPOSE: The mushi-verify workflow Mushi hands a project (Plan 024). The
 *          copy embedded in _shared/verify-workflow.ts must equal
 *          docs/templates/mushi-verify.yml, the template that ships with the
 *          composite action; Mushi fills exactly two of its lines.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOLCHAIN,
  defaultTestCommandFor,
  detectRepoToolchain,
  fillVerifyWorkflow,
  runsOnVariableLine,
  SETUP_BLOCK_END,
  SETUP_BLOCK_START,
  setupBlockFor,
  RUNS_ON_LINE,
  TEST_COMMAND_LINE,
  VERIFY_WORKFLOW_PATH,
  VERIFY_WORKFLOW_TEMPLATE,
  yamlDoubleQuoted,
  yamlLabel,
} from '../../supabase/functions/_shared/verify-workflow.ts'

const TEMPLATE_FILE = resolve(__dirname, '../../../../docs/templates/mushi-verify.yml')

describe('VERIFY_WORKFLOW_TEMPLATE', () => {
  it('equals docs/templates/mushi-verify.yml byte for byte', () => {
    expect(VERIFY_WORKFLOW_TEMPLATE).toBe(readFileSync(TEMPLATE_FILE, 'utf8'))
  })

  it('has each substituted line, and the setup block, exactly once', () => {
    for (const line of [RUNS_ON_LINE, TEST_COMMAND_LINE, SETUP_BLOCK_START.trimEnd(), SETUP_BLOCK_END.trimEnd()]) {
      expect(VERIFY_WORKFLOW_TEMPLATE.split('\n').filter((l) => l === line)).toHaveLength(1)
    }
  })

  it('keeps the contract: pull_request (never pull_request_target), agent branches, least permissions, 20 minutes, pinned checkout', () => {
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/^on:\n  pull_request:/m)
    expect(VERIFY_WORKFLOW_TEMPLATE).not.toMatch(/^\s*pull_request_target\s*:/m)
    for (const prefix of ['cursor/', 'mushi/', 'copilot/']) expect(VERIFY_WORKFLOW_TEMPLATE).toContain(`startsWith(github.head_ref, '${prefix}')`)
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/permissions:\n  contents: read\n  checks: write\n/)
    expect(VERIFY_WORKFLOW_TEMPLATE).toContain('timeout-minutes: 20')
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/)
    // The job's own check run is not "Mushi verify": that name is the result Mushi reads.
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/^\s+name: Mushi verify run$/m)
    expect(VERIFY_WORKFLOW_PATH).toBe('.github/workflows/mushi-verify.yml')
  })

  it('spends no minutes on drafts, release trains or reverts, and runs when a draft is marked ready', () => {
    expect(VERIFY_WORKFLOW_TEMPLATE).toContain('    types: [opened, synchronize, reopened, ready_for_review]\n')
    expect(VERIFY_WORKFLOW_TEMPLATE).toContain('      github.event.pull_request.draft == false &&\n')
    expect(VERIFY_WORKFLOW_TEMPLATE).toContain("      !startsWith(github.head_ref, 'mushi/train/') &&\n")
    expect(VERIFY_WORKFLOW_TEMPLATE).toContain("      !startsWith(github.head_ref, 'mushi/revert-')\n")
    // The skips sit in the one job's `if:`, so the filled copy keeps them.
    const filled = fillVerifyWorkflow({ verifyRunsOn: ['self-hosted'], verifyTestCommand: 'npx jest {files}' }, { ...DEFAULT_TOOLCHAIN, packageManager: 'npm' })
    for (const line of ['ready_for_review]', 'pull_request.draft == false', "'mushi/train/'", "'mushi/revert-'"]) expect(filled).toContain(line)
  })
})

describe('fillVerifyWorkflow', () => {
  it('is the template for the defaults', () => {
    expect(fillVerifyWorkflow({ verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: null })).toBe(VERIFY_WORKFLOW_TEMPLATE)
  })

  it('writes the runner labels and the test command, and nothing else changes', () => {
    const out = fillVerifyWorkflow({ verifyRunsOn: ['self-hosted', 'alienware-glot-1'], verifyTestCommand: 'npx jest {files} --ci' })
    expect(out).toContain('    runs-on: [self-hosted, alienware-glot-1]\n')
    expect(out).toContain('          test-command: "npx jest {files} --ci"\n')
    const changed = out.split('\n').filter((l, i) => l !== VERIFY_WORKFLOW_TEMPLATE.split('\n')[i])
    expect(changed).toHaveLength(2)
  })

  it('quotes labels YAML would read as something else', () => {
    expect(yamlLabel('ubuntu-latest')).toBe('ubuntu-latest')
    expect(yamlLabel('1.0')).toBe("'1.0'")
    expect(yamlLabel('on')).toBe("'on'")
    expect(yamlLabel('-x')).toBe("'-x'")
    expect(() => yamlLabel('a b')).toThrow(/not a runner label/)
  })

  it('escapes quotes and backslashes in the command, and refuses a second line or an expression', () => {
    expect(yamlDoubleQuoted('pytest "{files}" -k a\\b')).toBe('"pytest \\"{files}\\" -k a\\\\b"')
    expect(() => fillVerifyWorkflow({ verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: 'x {files}\nrm -rf /' })).toThrow()
    expect(() => fillVerifyWorkflow({ verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: 'x {files} ${{ secrets.T }}' })).toThrow()
  })
})

const LINUX_RUNNER_CI = `name: CI
on: pull_request
jobs:
  a:
    runs-on: \${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-latest' }}
    steps: []
  b:
    runs-on: \${{ vars.LINUX_RUNNER || 'ubuntu-latest' }}
    steps: []
  c:
    runs-on: \${{ vars.RUNNER_E2E || 'ubuntu-24.04' }}
    steps: []
  pinned:
    runs-on: ubuntu-latest # pixel baselines
    steps: []
`

describe('detectRepoToolchain', () => {
  it('reads the package manager from the root lockfile, the most specific first', () => {
    const pm = (files: string[]) => detectRepoToolchain({ rootFiles: files, hasLocalSetupAction: false, workflows: [] }).packageManager
    expect(pm(['package-lock.json', 'package.json'])).toBe('npm')
    expect(pm(['pnpm-lock.yaml', 'package-lock.json'])).toBe('pnpm')
    expect(pm(['yarn.lock'])).toBe('yarn')
    expect(pm(['bun.lockb'])).toBe('bun')
    expect(pm(['bun.lock'])).toBe('bun')
    expect(pm(['README.md'])).toBeNull()
    expect(detectRepoToolchain({ rootFiles: ['yarn.lock', '.yarnrc.yml'], hasLocalSetupAction: true, workflows: [] })).toMatchObject({ yarnBerry: true, localSetupAction: true })
  })

  it('finds the runner variable most jobs read, with its most common fallback', () => {
    const t = detectRepoToolchain({ rootFiles: [], hasLocalSetupAction: false, workflows: [{ path: '.github/workflows/ci.yml', text: LINUX_RUNNER_CI }] })
    expect(t.runnerVariable).toEqual({ name: 'LINUX_RUNNER', fallback: 'ubuntu-latest' })
    expect(detectRepoToolchain({ rootFiles: [], hasLocalSetupAction: false, workflows: [{ path: 'x.yml', text: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n' }] }).runnerVariable).toBeNull()
    expect(detectRepoToolchain({ rootFiles: [], hasLocalSetupAction: false, workflows: [{ path: 'bad.yml', text: 'jobs: [' }] }).runnerVariable).toBeNull()
  })
})

describe('fillVerifyWorkflow with a toolchain', () => {
  const defaults = { verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: null }

  it('is the template for pnpm and for an unknown toolchain', () => {
    expect(fillVerifyWorkflow(defaults, DEFAULT_TOOLCHAIN)).toBe(VERIFY_WORKFLOW_TEMPLATE)
    expect(fillVerifyWorkflow(defaults, { ...DEFAULT_TOOLCHAIN, packageManager: 'pnpm' })).toBe(VERIFY_WORKFLOW_TEMPLATE)
    expect(setupBlockFor({ ...DEFAULT_TOOLCHAIN, packageManager: 'pnpm' })).toBeNull()
  })

  it('npm: npm ci with the npm cache, no pnpm step, an npx test command', () => {
    const out = fillVerifyWorkflow(defaults, { ...DEFAULT_TOOLCHAIN, packageManager: 'npm' })
    expect(out).toContain('      - run: npm ci\n')
    expect(out).toContain('          cache: npm\n')
    expect(out).not.toContain('pnpm/action-setup')
    expect(out).not.toContain('pnpm install')
    expect(out).toContain('test-command: "npx vitest run {files}"')
    expect(out).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/)
  })

  it('yarn (classic and berry) and bun', () => {
    expect(fillVerifyWorkflow(defaults, { ...DEFAULT_TOOLCHAIN, packageManager: 'yarn' })).toContain('- run: yarn install --frozen-lockfile')
    expect(fillVerifyWorkflow(defaults, { ...DEFAULT_TOOLCHAIN, packageManager: 'yarn', yarnBerry: true })).toContain('- run: yarn install --immutable')
    const bun = fillVerifyWorkflow(defaults, { ...DEFAULT_TOOLCHAIN, packageManager: 'bun' })
    expect(bun).toMatch(/uses: oven-sh\/setup-bun@[0-9a-f]{40}/)
    expect(bun).toContain('- run: bun install --frozen-lockfile')
    // The verify action runs on Node, so setup-node stays.
    expect(bun).toContain('actions/setup-node@')
    expect(defaultTestCommandFor('bun')).toBe('bunx vitest run {files}')
  })

  it('a local setup action replaces the toolchain steps and keeps the template command', () => {
    const out = fillVerifyWorkflow(defaults, { ...DEFAULT_TOOLCHAIN, packageManager: 'npm', localSetupAction: true })
    expect(out).toContain('      - uses: ./.github/actions/setup\n')
    expect(out).not.toContain('actions/setup-node@')
    expect(out).not.toContain('npm ci')
    expect(out).toContain('test-command: "pnpm vitest run {files}"')
  })

  it('a project test command always wins over the toolchain default', () => {
    expect(fillVerifyWorkflow({ verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: 'npx jest {files}' }, { ...DEFAULT_TOOLCHAIN, packageManager: 'npm' })).toContain('test-command: "npx jest {files}"')
  })

  it('reads the repo\'s runner variable when the project kept the default label, never over labels it picked', () => {
    const t = { ...DEFAULT_TOOLCHAIN, runnerVariable: { name: 'LINUX_RUNNER', fallback: 'ubuntu-24.04' } }
    expect(fillVerifyWorkflow(defaults, t)).toContain("    runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}\n")
    expect(fillVerifyWorkflow({ verifyRunsOn: [], verifyTestCommand: null }, { ...t, runnerVariable: { name: 'LINUX_RUNNER', fallback: null } })).toContain("vars.LINUX_RUNNER || 'ubuntu-latest'")
    expect(fillVerifyWorkflow({ verifyRunsOn: ['self-hosted', 'alienware'], verifyTestCommand: null }, t)).toContain('    runs-on: [self-hosted, alienware]\n')
  })

  it('refuses a variable or fallback that would not be safe in YAML', () => {
    expect(() => runsOnVariableLine('LINUX RUNNER', 'x')).toThrow(/not a variable name/)
    expect(() => runsOnVariableLine('X', "a' || 'b")).toThrow(/not a runner label/)
    expect(runsOnVariableLine('RUNNER_E2E', 'ubuntu-24.04')).toBe("    runs-on: ${{ vars.RUNNER_E2E || 'ubuntu-24.04' }}")
  })
})
