/**
 * FILE: ci-runs-on.test.ts
 * PURPOSE: `_shared/ci-runs-on.ts` sorts each workflow job by where it asks
 *          to run, on the real forms seen in the kensaurus repos on
 *          2026-10-22: the LINUX_RUNNER expression with its main / Dependabot
 *          guards, literal GitHub-hosted pins with a reason comment, custom
 *          self-hosted labels, matrix expressions, and broken YAML.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyRunsOn,
  isHostedLabel,
  parseWorkflowRunsOn,
  runsOnJobMatches,
  workflowDisplayName,
} from '../../supabase/functions/_shared/ci-runs-on.ts'

const GLOT_CI = `name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  lint:
    name: Lint & Build
    if: github.event_name == 'pull_request'
    runs-on: \${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-latest' }}
    steps:
      - run: echo hi
  visual:
    needs: lint
    runs-on: ubuntu-latest  # pixel baselines are captured on GitHub-hosted ubuntu; keep hosted
    steps:
      - run: echo hi
  checks:
    name: "Checks (security, #conventions)"
    # gitleaks-action's tool cache is saved on hosted paths; keep hosted
    runs-on: ubuntu-24.04
    steps: []
  mac:
    runs-on: macos-15
    steps: []
  local:
    runs-on: [self-hosted, kensaurus-local] # Alienware only
    steps: []
  matrix:
    name: build \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps: []
  grouped:
    runs-on:
      group: big-boxes
      labels: [linux-x64-16]
    steps: []
  reusable:
    uses: ./.github/workflows/deploy.yml
`

describe('parseWorkflowRunsOn', () => {
  const wf = parseWorkflowRunsOn('.github/workflows/ci.yml', GLOT_CI)
  const job = (id: string) => wf.jobs.find((j) => j.jobId === id)!

  it('reads the workflow name, triggers, and every job that has runs-on (a reusable call has none)', () => {
    expect(wf.error).toBeNull()
    expect(wf.name).toBe('CI')
    expect(wf.triggers).toEqual(['pull_request', 'push'])
    expect(wf.jobs.map((j) => j.jobId)).toEqual(['lint', 'visual', 'checks', 'mac', 'local', 'matrix', 'grouped'])
  })

  it('reads the LINUX_RUNNER expression: the variable, the hosted fallback, and both guards', () => {
    expect(job('lint')).toMatchObject({
      kind: 'follows_variable',
      variables: ['LINUX_RUNNER'],
      fallbackLabel: 'ubuntu-latest',
      hostedOnMain: true,
      hostedForDependabot: true,
      pullRequestOnly: true,
      jobName: 'Lint & Build',
      pinnedReason: null,
    })
  })

  it('keeps the reason of a GitHub-hosted pin from the same line or the comment line above', () => {
    expect(job('visual')).toMatchObject({ kind: 'pinned_hosted', labels: ['ubuntu-latest'], pinnedReason: 'pixel baselines are captured on GitHub-hosted ubuntu; keep hosted' })
    expect(job('checks')).toMatchObject({ kind: 'pinned_hosted', pinnedReason: "gitleaks-action's tool cache is saved on hosted paths; keep hosted" })
    // A # inside a quoted job name is not a comment.
    expect(job('checks').jobName).toBe('Checks (security, #conventions)')
    expect(job('mac')).toMatchObject({ kind: 'pinned_hosted', pinnedReason: null })
  })

  it('sorts custom labels, matrix expressions and runner groups', () => {
    expect(job('local')).toMatchObject({ kind: 'pinned_self_hosted', labels: ['self-hosted', 'kensaurus-local'], pinnedReason: 'Alienware only' })
    expect(job('matrix')).toMatchObject({ kind: 'expression', variables: [], fallbackLabel: null })
    expect(job('grouped')).toMatchObject({ kind: 'pinned_self_hosted', labels: ['linux-x64-16'] })
  })

  it('returns an error and no jobs for broken YAML, never throws', () => {
    const bad = parseWorkflowRunsOn('x.yml', 'jobs:\n  a: [unclosed\n')
    expect(bad.error).not.toBeNull()
    expect(bad.jobs).toEqual([])
    expect(parseWorkflowRunsOn('y.yml', '- just\n- a list\n')).toMatchObject({ error: 'not a mapping', jobs: [] })
  })

  it('shows the path when a workflow has no name', () => {
    const w = parseWorkflowRunsOn('.github/workflows/x.yml', 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n')
    expect(w.triggers).toEqual(['push'])
    expect(workflowDisplayName(w)).toBe('.github/workflows/x.yml')
  })
})

describe('classifyRunsOn', () => {
  it('reads a bare variable with a fallback and no guards', () => {
    expect(classifyRunsOn("${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}")).toMatchObject({
      kind: 'follows_variable',
      variables: ['LINUX_RUNNER'],
      fallbackLabel: 'ubuntu-24.04',
      hostedOnMain: false,
      hostedForDependabot: false,
    })
  })

  it('reads a variable with no fallback, and several variables once each', () => {
    expect(classifyRunsOn('${{ vars.RUNNER_E2E }}')).toMatchObject({ kind: 'follows_variable', fallbackLabel: null })
    expect(classifyRunsOn("${{ vars.A || vars.B || vars.A || 'ubuntu-latest' }}").variables).toEqual(['A', 'B'])
  })

  it('knows GitHub-hosted labels', () => {
    expect(isHostedLabel('ubuntu-latest')).toBe(true)
    expect(isHostedLabel('macos-26')).toBe(true)
    expect(isHostedLabel('kensaurus-local')).toBe(false)
    expect(classifyRunsOn(['ubuntu-latest', 'kensaurus-local']).kind).toBe('pinned_self_hosted')
    expect(classifyRunsOn([]).kind).toBe('pinned_self_hosted')
  })
})

describe('runsOnJobMatches', () => {
  const wf = parseWorkflowRunsOn('.github/workflows/ci.yml', GLOT_CI)
  const job = (id: string) => wf.jobs.find((j) => j.jobId === id)!

  it('matches the stored job name, matrix suffixes, and expression names by prefix', () => {
    expect(runsOnJobMatches(job('lint'), 'CI', 'Lint & Build')).toBe(true)
    expect(runsOnJobMatches(job('visual'), 'CI', 'visual')).toBe(true)
    expect(runsOnJobMatches(job('visual'), 'CI', 'visual (1, 2)')).toBe(true)
    expect(runsOnJobMatches(job('matrix'), 'CI', 'build ubuntu-latest')).toBe(true)
  })

  it('refuses another workflow or another job', () => {
    expect(runsOnJobMatches(job('lint'), 'Deploy', 'Lint & Build')).toBe(false)
    expect(runsOnJobMatches(job('lint'), 'CI', 'Lint')).toBe(false)
    // The workflow path also identifies a workflow GitHub shows by path.
    expect(runsOnJobMatches(job('visual'), '.github/workflows/ci.yml', 'visual')).toBe(true)
  })
})
