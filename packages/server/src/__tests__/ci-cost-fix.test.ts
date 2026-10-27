/**
 * FILE: ci-cost-fix.test.ts
 * PURPOSE: The workflow edits behind the CI cost "Open fix PR"
 *          (_shared/ci-cost-fix.ts): each of the four kinds on real-shaped
 *          workflows, comments and untouched lines kept, a second run
 *          changes nothing, and the refusals (no trigger, mixed `if:`,
 *          required-looking aggregator, unreadable YAML).
 */

import { describe, expect, it } from 'vitest'
import { parse, parseDocument } from 'yaml'
import {
  applyCiCostFix,
  bareCondition,
  CI_COST_FIX_KINDS,
  deployEvidence,
  DOCS_PATHS_IGNORE,
  DRAFT_CONDITION,
  DRAFT_GUARD_STEP_NAME,
  firesPer28Days,
  isCiCostFixKind,
  parseCron,
  weeklyCronFor,
  type CiCostFixKind,
  type CostFixOptions,
} from '../../supabase/functions/_shared/ci-cost-fix.ts'

const CI = `# CI for the app. Keep the job names: branch rules read them.
name: CI

on:
  pull_request:
    branches: [main] # PRs into main only
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    name: Unit tests
    runs-on: ubuntu-latest # hosted on purpose
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
  lint:
    runs-on: ubuntu-latest
    if: \${{ github.actor != 'dependabot[bot]' }}
    steps:
      - run: pnpm lint
`

/** The default branch requires no checks. */
const NONE: CostFixOptions = { requiredChecks: [] }

function twice(kind: CiCostFixKind, yaml: string, opts: CostFixOptions = NONE) {
  const first = applyCiCostFix(kind, yaml, opts)
  const second = applyCiCostFix(kind, first.yaml, opts)
  return { first, second }
}

describe('applyCiCostFix: every kind is idempotent and keeps comments', () => {
  it('knows exactly the four kinds the advice offers', () => {
    expect([...CI_COST_FIX_KINDS]).toEqual(['add_concurrency', 'skip_drafts', 'weekly_cron', 'ignore_docs_paths'])
    expect(isCiCostFixKind('skip_drafts')).toBe(true)
    expect(isCiCostFixKind('rm_rf')).toBe(false)
    expect(isCiCostFixKind(null)).toBe(false)
  })

  for (const kind of ['add_concurrency', 'skip_drafts', 'ignore_docs_paths'] as const) {
    it(`${kind}: changes once, then nothing; comments and other lines survive`, () => {
      const { first, second } = twice(kind, CI)
      expect(first.changed).toBe(true)
      expect(first.refused).toBeUndefined()
      expect(second.changed).toBe(false)
      expect(second.yaml).toBe(first.yaml)
      for (const line of [
        '# CI for the app. Keep the job names: branch rules read them.',
        '    branches: [main] # PRs into main only',
        '    runs-on: ubuntu-latest # hosted on purpose',
        '      - uses: actions/checkout@v4',
        'permissions:',
      ]) {
        expect(first.yaml).toContain(line)
      }
      // Still a valid workflow with the same jobs.
      expect(Object.keys(parse(first.yaml).jobs)).toEqual(['test', 'lint'])
    })
  }

  it('returns the input untouched when nothing changes', () => {
    const yaml = 'name: X\non: push\nconcurrency: x\njobs:\n  a:\n    runs-on: x\n'
    expect(applyCiCostFix('add_concurrency', yaml)).toEqual({ changed: false, yaml, summary: 'The workflow already has a concurrency group.' })
  })
})

describe('add_concurrency', () => {
  it('adds a group per workflow and ref that cancels only pull request runs, before jobs', () => {
    const out = applyCiCostFix('add_concurrency', CI)
    const wf = parse(out.yaml)
    expect(wf.concurrency).toEqual({
      group: "${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}",
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    })
    expect(out.yaml.indexOf('concurrency:')).toBeLessThan(out.yaml.indexOf('jobs:'))
    expect(out.yaml.indexOf('concurrency:')).toBeGreaterThan(out.yaml.indexOf('permissions:'))
    expect(out.summary).toMatch(/cancels the run it replaces/)
  })
})

describe('skip_drafts', () => {
  it('writes out the default types plus ready_for_review, and adds the draft check to every job', () => {
    const out = applyCiCostFix('skip_drafts', CI, NONE)
    const wf = parse(out.yaml)
    expect(wf.on.pull_request).toEqual({ types: ['opened', 'synchronize', 'reopened', 'ready_for_review'], branches: ['main'] })
    // Push is untouched: the draft check is true on a push (no pull_request payload).
    expect(wf.on.push).toEqual({ branches: ['main'] })
    expect(wf.jobs.test.if).toBe(DRAFT_CONDITION)
    // An existing `${{ }}` condition is unwrapped and joined with &&.
    expect(wf.jobs.lint.if).toBe(`(github.actor != 'dependabot[bot]') && ${DRAFT_CONDITION}`)
    // The new `if:` sits after the job's name.
    expect(out.yaml).toMatch(/name: Unit tests\n {4}if: github\.event\.pull_request\.draft != true\n {4}runs-on/)
    expect(out.summary).toContain('runs when a draft is marked ready for review')
    expect(out.summary).toContain('`test` and `lint`')
  })

  it('keeps the existing types and appends ready_for_review once', () => {
    const yaml = 'on:\n  pull_request:\n    types: [opened, labeled]\njobs:\n  a:\n    runs-on: x\n'
    const { first, second } = twice('skip_drafts', yaml)
    expect(parse(first.yaml).on.pull_request.types).toEqual(['opened', 'labeled', 'ready_for_review'])
    expect(second.changed).toBe(false)
  })

  it('handles on: pull_request and on: [push, pull_request], and a block-scalar if', () => {
    const scalar = applyCiCostFix('skip_drafts', 'on: pull_request\njobs:\n  a:\n    runs-on: x\n', NONE)
    expect(parse(scalar.yaml).on).toEqual({ pull_request: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review'] } })
    const seq = applyCiCostFix('skip_drafts', 'on: [push, pull_request]\njobs:\n  a:\n    runs-on: x\n', NONE)
    expect(parse(seq.yaml).on.push).toBeNull()
    expect(seq.yaml).toContain('  push:\n')
    const block = applyCiCostFix('skip_drafts', "on: pull_request\njobs:\n  a:\n    if: >-\n      github.ref == 'refs/heads/main' ||\n      always()\n    runs-on: x\n", NONE)
    expect(parse(block.yaml).jobs.a.if).toBe(`(github.ref == 'refs/heads/main' || always()) && ${DRAFT_CONDITION}`)
  })

  it('leaves a job that already checks the draft flag, and a mixed text-and-expression if, alone', () => {
    const yaml = "on: pull_request\njobs:\n  a:\n    if: github.event.pull_request.draft == false\n    runs-on: x\n  b:\n    if: ${{ github.ref }} == 'x' && ${{ true }}\n    runs-on: x\n  c:\n    runs-on: x\n"
    const out = applyCiCostFix('skip_drafts', yaml, NONE)
    const wf = parse(out.yaml)
    expect(wf.jobs.a.if).toBe('github.event.pull_request.draft == false')
    expect(wf.jobs.b.if).toBe("${{ github.ref }} == 'x' && ${{ true }}")
    expect(wf.jobs.c.if).toBe(DRAFT_CONDITION)
    expect(out.summary).toContain('Left job `b` alone')
  })

  it('refuses a workflow without pull_request, and one where every job has a mixed if', () => {
    expect(applyCiCostFix('skip_drafts', 'on: push\njobs:\n  a:\n    runs-on: x\n').refused).toMatch(/does not run on pull requests/)
    const mixed = applyCiCostFix('skip_drafts', "on:\n  pull_request:\n    types: [opened, ready_for_review]\njobs:\n  b:\n    if: ${{ a }} && ${{ b }}\n    runs-on: x\n", NONE)
    expect(mixed.changed).toBe(false)
    expect(mixed.refused).toMatch(/could not safely add the draft check to job `b`/)
  })

  it('bareCondition unwraps one ${{ }} and refuses mixed text', () => {
    expect(bareCondition('${{ a && b }}')).toBe('a && b')
    expect(bareCondition('  a == 1 ')).toBe('a == 1')
    expect(bareCondition('${{ a }} && ${{ b }}')).toBeNull()
    expect(bareCondition('')).toBeNull()
  })
})

describe('weekly_cron', () => {
  const NIGHTLY = `name: Nightly
on:
  schedule:
    # every 15 minutes, for the status page
    - cron: '*/15 3 * * *'
    - cron: '30 4 * * 1-5'
  workflow_dispatch:
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - run: ./probe.sh
`

  it('rewrites a schedule that fires more than weekly to once a week, keeping hour and comment', () => {
    const { first, second } = twice('weekly_cron', NIGHTLY)
    expect(first.changed).toBe(true)
    const wf = parse(first.yaml)
    expect(wf.on.schedule).toEqual([{ cron: '0 3 * * 1' }])
    expect(wf.on).toHaveProperty('workflow_dispatch')
    expect(first.yaml).toContain('    # every 15 minutes, for the status page\n')
    expect(first.yaml).toContain("- cron: '0 3 * * 1'")
    expect(first.summary).toContain('`0 3 * * 1`')
    expect(first.summary).toContain('`*/15 3 * * *`, `30 4 * * 1-5`')
    expect(second.changed).toBe(false)
  })

  it('keeps the first weekday and the minute of a daily-on-weekdays schedule', () => {
    const out = applyCiCostFix('weekly_cron', "on:\n  schedule:\n    - cron: '17 6 * * MON-FRI'\njobs:\n  a:\n    runs-on: x\n")
    expect(parse(out.yaml).on.schedule[0].cron).toBe('17 6 * * 1')
  })

  it('leaves weekly, monthly and twice-monthly schedules alone', () => {
    for (const cron of ['0 3 * * 1', '0 0 1 * *', '0 0 1,15 * *', '0 9 * * SUN']) {
      const out = applyCiCostFix('weekly_cron', `on:\n  schedule:\n    - cron: '${cron}'\njobs:\n  a:\n    runs-on: x\n`)
      expect(out.changed, cron).toBe(false)
      expect(out.refused).toBeUndefined()
    }
  })

  it('refuses no schedule and an unreadable cron', () => {
    expect(applyCiCostFix('weekly_cron', CI).refused).toMatch(/no schedule/)
    expect(applyCiCostFix('weekly_cron', "on:\n  schedule:\n    - cron: '@daily'\njobs:\n  a:\n    runs-on: x\n").refused).toMatch(/could not read the schedule/)
  })

  it('counts fires the POSIX way (day of month OR day of week)', () => {
    const c = (e: string) => parseCron(e)!
    expect(firesPer28Days([c('0 0 * * *')])).toBe(28)
    expect(firesPer28Days([c('0 0 * * 1')])).toBe(4)
    expect(firesPer28Days([c('*/30 * * * *')])).toBe(28 * 48)
    // 1st and 15th, OR Mondays: 2 + 4 in March 2026 days 1-28.
    expect(firesPer28Days([c('0 0 1,15 * 1')])).toBe(6)
    expect(weeklyCronFor(c('*/5 */2 * * *'))).toBe('0 0 * * 1')
    expect(weeklyCronFor(c('45 22 * * 0,3'))).toBe('45 22 * * 0')
    expect(parseCron('0 0 * *')).toBeNull()
    expect(parseCron('61 0 * * *')).toBeNull()
  })
})

describe('ignore_docs_paths', () => {
  it('adds paths-ignore to pull_request and push, quoted, and keeps branch filters', () => {
    const out = applyCiCostFix('ignore_docs_paths', CI, NONE)
    const wf = parse(out.yaml)
    expect(wf.on.pull_request).toEqual({ branches: ['main'], 'paths-ignore': ['**/*.md', 'docs/**'] })
    expect(wf.on.push).toEqual({ branches: ['main'], 'paths-ignore': ['**/*.md', 'docs/**'] })
    expect(out.yaml).toContain("paths-ignore: ['**/*.md', 'docs/**']")
    expect(out.summary).toContain('pull_request or push')
  })

  it('leaves a trigger that already has paths-ignore, and a tags-only push', () => {
    const yaml = "on:\n  pull_request:\n    paths-ignore: ['src/**']\n  push:\n    tags: ['v*']\njobs:\n  a:\n    runs-on: x\n"
    const out = applyCiCostFix('ignore_docs_paths', yaml, NONE)
    expect(out.changed).toBe(false)
    expect(out.refused).toBeUndefined()
  })

  it('refuses when an event already lists paths (GitHub rejects paths with paths-ignore)', () => {
    const yaml = "on:\n  pull_request:\n  push:\n    branches: [main]\n    paths: ['src/**']\njobs:\n  a:\n    runs-on: x\n"
    const out = applyCiCostFix('ignore_docs_paths', yaml, NONE)
    expect(out.changed).toBe(false)
    expect(out.yaml).toBe(yaml)
    expect(out.refused).toMatch(/`push` trigger already lists `paths`/)
  })

  it('refuses when the required checks could not be read', () => {
    for (const opts of [{}, { requiredChecks: null }]) {
      const out = applyCiCostFix('ignore_docs_paths', CI, opts)
      expect(out.changed).toBe(false)
      expect(out.refused).toMatch(/could not read which status checks/)
    }
  })

  it('exports the docs path list once, for the advisor rule to import', () => {
    expect([...DOCS_PATHS_IGNORE]).toEqual(['**/*.md', 'docs/**'])
  })

  it('refuses when a job is a required check, so a docs-only PR never gets stuck', () => {
    const out = applyCiCostFix('ignore_docs_paths', CI, { requiredChecks: ['Unit tests'] })
    expect(out.changed).toBe(false)
    expect(out.yaml).toBe(CI)
    expect(out.refused).toMatch(/`Unit tests` is a required check/)
    // A matrix job reports "name (value)".
    expect(applyCiCostFix('ignore_docs_paths', CI, { requiredChecks: ['lint (20)'] }).refused).toMatch(/required check/)
  })

  it('refuses a workflow with an aggregator job, by name or by shape', () => {
    const named = CI + '  gate:\n    runs-on: ubuntu-latest\n    needs: [test]\n    steps:\n      - run: echo ok\n'
    expect(applyCiCostFix('ignore_docs_paths', named, NONE).refused).toMatch(/Job `gate` looks like the check/)
    const shaped = CI + '  summary:\n    name: Everything\n    if: always()\n    needs: [test, lint]\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'
    expect(applyCiCostFix('ignore_docs_paths', shaped, NONE).refused).toMatch(/Job `Everything` looks like/)
  })

  it('refuses a workflow that does not run on pushes or pull requests', () => {
    expect(applyCiCostFix('ignore_docs_paths', 'on: workflow_dispatch\njobs:\n  a:\n    runs-on: x\n').refused).toMatch(/does not run on pushes or pull requests/)
  })
})

describe('safety: required checks (skip_drafts)', () => {
  const GATED = `on:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
  gate:
    name: CI Gate
    if: always()
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - run: test "\${{ needs.test.result }}" = success
`

  it('refuses when the required checks could not be read', () => {
    for (const opts of [{}, { requiredChecks: null }]) {
      const out = applyCiCostFix('skip_drafts', CI, opts)
      expect(out.changed).toBe(false)
      expect(out.yaml).toBe(CI)
      expect(out.refused).toMatch(/could not read which status checks your default branch requires/)
    }
  })

  it('never skips a job that produces a required check: it fails at "Draft PRs run no CI" instead', () => {
    const { first, second } = twice('skip_drafts', GATED, { requiredChecks: ['CI Gate'] })
    expect(first.changed).toBe(true)
    const wf = parse(first.yaml)
    // The other job skips drafts; the required one has no skip `if`.
    expect(wf.jobs.test.if).toBe(DRAFT_CONDITION)
    expect(wf.jobs.gate.if).toBe('always()')
    expect(wf.jobs.gate.steps[0]).toEqual({
      name: 'Draft PRs run no CI',
      if: 'github.event.pull_request.draft == true',
      run: 'echo "Draft pull requests run no CI. Mark the pull request ready for review to run it." && exit 1',
    })
    expect(DRAFT_GUARD_STEP_NAME).toBe('Draft PRs run no CI')
    expect(wf.jobs.gate.steps).toHaveLength(2)
    expect(first.summary).toContain('stops job `gate` at a first step named "Draft PRs run no CI"')
    expect(second.changed).toBe(false)
  })

  it('matches a required check by job name, id, or a matrix entry; keeps an existing guard step', () => {
    const matrix = 'on: pull_request\njobs:\n  lint:\n    runs-on: x\n    strategy:\n      matrix:\n        node: [20]\n    steps:\n      - run: pnpm lint\n'
    const out = applyCiCostFix('skip_drafts', matrix, { requiredChecks: ['lint (20)'] })
    expect(parse(out.yaml).jobs.lint.if).toBeUndefined()
    expect(parse(out.yaml).jobs.lint.steps[0].name).toBe('Draft PRs run no CI')
    const guarded = 'on:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\njobs:\n  gate:\n    runs-on: x\n    steps:\n      - name: Draft PRs run no CI\n        if: github.event.pull_request.draft\n        run: exit 1\n'
    const kept = applyCiCostFix('skip_drafts', guarded, { requiredChecks: ['gate'] })
    expect(kept.changed).toBe(false)
    expect(kept.refused).toBeUndefined()
  })

  it('refuses a required job that waits on other jobs without always(), and one that calls another workflow', () => {
    const waits = GATED.replace('    if: always()\n', '')
    expect(applyCiCostFix('skip_drafts', waits, { requiredChecks: ['CI Gate'] }).refused).toMatch(/`CI Gate` produces the required check `CI Gate` and waits on other jobs/)
    const reusable = 'on: pull_request\njobs:\n  ci:\n    uses: ./.github/workflows/reusable.yml\n'
    expect(applyCiCostFix('skip_drafts', reusable, { requiredChecks: ['ci'] }).refused).toMatch(/calls another workflow/)
  })
})

describe('safety: deploys and releases (add_concurrency, weekly_cron)', () => {
  const DEPLOY = 'name: Deploy site\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: x\n    steps:\n      - run: pnpm build\n'

  it('add_concurrency refuses a workflow that deploys or releases, by name, file, job, step or command', () => {
    expect(applyCiCostFix('add_concurrency', DEPLOY).refused).toMatch(/looks like it deploys or releases \(workflow `Deploy site`\)/)
    const quiet = 'on:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: x\n    steps:\n      - run: pnpm build\n'
    expect(applyCiCostFix('add_concurrency', quiet, { workflowPath: '.github/workflows/release.yml' }).refused).toMatch(/file `release.yml`/)
    expect(applyCiCostFix('add_concurrency', quiet.replace('  build:', '  publish-npm:')).refused).toMatch(/job `publish-npm`/)
    expect(applyCiCostFix('add_concurrency', quiet.replace('- run: pnpm build', '- name: Ship OTA update\n        run: x')).refused).toMatch(/step `Ship OTA update`/)
    expect(applyCiCostFix('add_concurrency', quiet.replace('pnpm build', 'npx eas update --branch production')).refused).toMatch(/`eas update` in job `build`/)
    // A plain CI that also runs on pushes to main gets the group: pushes never share it.
    expect(applyCiCostFix('add_concurrency', quiet).changed).toBe(true)
  })

  it('deployEvidence does not fire on ordinary CI words', () => {
    const ci = parseDocument('name: CI\non: pull_request\njobs:\n  test:\n    name: Unit tests\n    runs-on: x\n    steps:\n      - name: Install\n        run: pnpm install\n')
    expect(deployEvidence(ci, '.github/workflows/ci.yml')).toBeNull()
  })

  it('weekly_cron refuses a scheduled deploy or release, and says what the schedule was otherwise', () => {
    const rollout = "name: Staged OTA rollout\non:\n  schedule:\n    - cron: '0 9 * * *'\njobs:\n  roll:\n    runs-on: x\n    steps:\n      - run: ./roll.sh\n"
    const out = applyCiCostFix('weekly_cron', rollout)
    expect(out.changed).toBe(false)
    expect(out.refused).toMatch(/staged rollouts on purpose/)
    const nightly = "name: Nightly lint\non:\n  schedule:\n    - cron: '0 9 * * *'\njobs:\n  lint:\n    runs-on: x\n    steps:\n      - run: pnpm lint\n"
    expect(applyCiCostFix('weekly_cron', nightly).summary).toContain('It was `0 9 * * *`; put that back')
  })
})

describe('unreadable input', () => {
  it('refuses broken YAML, a non-map document and a workflow without jobs, for every kind', () => {
    for (const kind of CI_COST_FIX_KINDS) {
      expect(applyCiCostFix(kind, 'on: [push\njobs:').refused).toMatch(/could not read this workflow/)
      expect(applyCiCostFix(kind, '- a\n- b\n').refused).toMatch(/could not read this workflow/)
      expect(applyCiCostFix(kind, 'on: push\n').refused).toMatch(/no jobs/)
    }
  })

  it('keeps a non-indented sequence style', () => {
    const yaml = 'on: pull_request\njobs:\n  a:\n    runs-on: x\n    steps:\n    - run: echo hi\n'
    const out = applyCiCostFix('add_concurrency', yaml)
    expect(out.yaml).toContain('    steps:\n    - run: echo hi\n')
  })
})
