/**
 * `_shared/recipe-drift.ts` — the App Recipe's Phase 2 drift rules (Plan 019
 * §1.1, §1.4–1.8). Every rule has a positive and a negative case; an
 * unreadable workflow is a finding, never silence; an unobserved deploy
 * target is returned for an `unknown` render, never judged.
 */
import { describe, expect, it } from 'vitest'
import {
  budgetDrift,
  cadenceStale,
  ciWorkflowDrift,
  cronFiresPerDay,
  defaultBranchRed,
  deployDrift,
  envDrift,
  integrationDrift,
  isoDurationMs,
  migrationVersion,
  schemaMigrationDrift,
} from '../../supabase/functions/_shared/recipe-drift.ts'

// A glot.it-like set: ci.yml is well behaved, deploy.yml and the mobile build are not.
const CI_YML = `
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage
          retention-days: 7
`

const DEPLOY_YML = `
name: Deploy web
on:
  push:
    branches: [main]
  schedule:
    - cron: '*/30 * * * *'
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm build && aws s3 sync out s3://bucket
      - uses: actions/upload-artifact@v4
        with:
          name: out
          path: out
`

const MOBILE_YML = `
name: Build mobile (Capacitor)
on: [push, workflow_dispatch]
concurrency: mobile-\${{ github.ref }}
jobs:
  android:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - run: ./gradlew bundleRelease
  ios:
    runs-on: macos-15
    timeout-minutes: 60
    steps:
      - run: xcodebuild archive
  ios-gated:
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: \${{ matrix.os }}
    timeout-minutes: 60
    strategy:
      matrix:
        os: [macos-26]
    steps:
      - run: xcodebuild archive
  reusable:
    uses: ./.github/workflows/notify.yml
`

const rules = (files: Record<string, string>) => ciWorkflowDrift(files).map((f) => `${f.filePath}:${f.ruleId}`)

describe('ciWorkflowDrift', () => {
  it('a well-behaved workflow has no findings', () => {
    expect(ciWorkflowDrift({ '.github/workflows/ci.yml': CI_YML })).toEqual([])
  })

  it('flags no concurrency, no timeout, long artifact retention and a schedule that runs more than daily', () => {
    expect(rules({ '.github/workflows/deploy.yml': DEPLOY_YML }).sort()).toEqual([
      '.github/workflows/deploy.yml:artifact_retention_gt_14',
      '.github/workflows/deploy.yml:cron_more_than_daily',
      '.github/workflows/deploy.yml:workflow_no_concurrency',
      '.github/workflows/deploy.yml:workflow_no_timeout',
    ])
    const timeout = ciWorkflowDrift({ 'd.yml': DEPLOY_YML }).find((f) => f.ruleId === 'workflow_no_timeout')!
    expect(timeout.message).toContain('deploy')
    expect(timeout.suggestedFix.kind).toBe('patch')
  })

  it('flags an unconditional macOS job but not a gated one or a reusable-workflow job', () => {
    const found = ciWorkflowDrift({ '.github/workflows/build-mobile-capacitor.yml': MOBILE_YML })
    expect(found.map((f) => f.ruleId)).toEqual(['macos_unconditional'])
    expect(found[0].message).toContain('ios')
    expect(found[0].message).not.toContain('ios-gated')
  })

  it('catches a macOS matrix with no if', () => {
    const yml = `on: push\nconcurrency: x\njobs:\n  b:\n    runs-on: \${{ matrix.os }}\n    timeout-minutes: 5\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-15]\n    steps: [{ run: echo }]\n`
    expect(rules({ 'm.yml': yml })).toEqual(['m.yml:macos_unconditional'])
  })

  it('accepts job-level concurrency on every job and ignores retention set by an expression', () => {
    const yml = `on: pull_request\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    concurrency: a\n    steps:\n      - uses: actions/upload-artifact@v4\n        with: { retention-days: '\${{ inputs.days }}' }\n`
    expect(ciWorkflowDrift({ 'a.yml': yml })).toEqual([])
  })

  it('reports an unreadable file instead of skipping it', () => {
    const found = ciWorkflowDrift({ 'bad.yml': 'on: [push\njobs: {', 'nojobs.yml': 'name: x\n' })
    expect(found.map((f) => [f.filePath, f.ruleId, f.severity])).toEqual([
      ['bad.yml', 'workflow_unreadable', 'info'],
      ['nojobs.yml', 'workflow_unreadable', 'info'],
    ])
  })

  it('counts cron firings per day from the minute and hour fields', () => {
    expect(cronFiresPerDay('17 3 * * *')).toBe(1)
    expect(cronFiresPerDay('0 3 * * 1')).toBe(1)
    expect(cronFiresPerDay('*/15 * * * *')).toBe(96)
    expect(cronFiresPerDay('0 0,12 * * *')).toBe(2)
    expect(cronFiresPerDay('5 8-10 * * *')).toBe(3)
    expect(cronFiresPerDay('0 */6 * * *')).toBe(4)
    expect(cronFiresPerDay('nonsense')).toBeNull()
    expect(cronFiresPerDay('61 0 * * *')).toBeNull()
  })
})

describe('defaultBranchRed', () => {
  const run = (conclusion: string, at: string, branch = 'main') => ({ head_branch: branch, conclusion, completed_at: at })
  it('is red when the last three main runs failed, ignoring other branches', () => {
    const found = defaultBranchRed([
      run('failure', '2026-10-02T03:00:00Z'),
      run('success', '2026-10-02T02:30:00Z', 'feature'),
      run('timed_out', '2026-10-02T02:00:00Z'),
      run('failure', '2026-10-02T01:00:00Z'),
      run('success', '2026-10-01T01:00:00Z'),
    ], 'main')
    expect(found.map((f) => [f.ruleId, f.severity])).toEqual([['default_branch_red', 'error']])
  })

  it('is not red after a recent success, with too few runs, or for cancelled runs', () => {
    expect(defaultBranchRed([run('failure', '2026-10-02T03:00:00Z'), run('success', '2026-10-02T02:00:00Z'), run('failure', '2026-10-02T01:00:00Z')], 'main')).toEqual([])
    expect(defaultBranchRed([run('failure', '2026-10-02T03:00:00Z')], 'main')).toEqual([])
    expect(defaultBranchRed([run('cancelled', 'a'), run('failure', 'b'), run('failure', 'c')].map((r, i) => ({ ...r, completed_at: `2026-10-02T0${i}:00:00Z` })), 'main')).toEqual([])
  })
})

describe('deployDrift', () => {
  const NOW = new Date('2026-10-02T12:00:00Z')
  const obs = (target_id: string, over: Partial<{ observed_commit: string | null; observed_version: string | null; ok: boolean; error: string | null; observed_at: string }> = {}) => ({
    target_id, observed_commit: 'aaaaaaa1111', observed_version: '1.102.0', ok: true, error: null, observed_at: '2026-10-02T11:00:00Z', source: 'version_json', ...over,
  })
  const targets = [
    { id: 'web-prod', kind: 'cloudfront-s3' },
    { id: 'android-play', kind: 'capacitor-android' },
    { id: 'ios-app-store', kind: 'capacitor-ios' },
  ]

  it('flags a head that has not shipped after the lag window, and lists unobserved targets', () => {
    const r = deployDrift({
      targets, now: NOW, headSha: 'bbbbbbb2222', headCommittedAt: '2026-10-01T08:00:00Z',
      observations: [obs('web-prod'), obs('android-play', { observed_commit: null })],
    })
    expect(r.findings.map((f) => f.ruleId)).toEqual(['not_deployed'])
    expect(r.unobserved).toEqual(['ios-app-store'])
  })

  it('is quiet when the deployed commit matches (short or long SHA) or the head is still inside the window', () => {
    expect(deployDrift({ targets: [targets[0]], now: NOW, headSha: 'aaaaaaa', headCommittedAt: '2026-10-01T08:00:00Z', observations: [obs('web-prod')] }).findings).toEqual([])
    expect(deployDrift({ targets: [{ id: 'web-prod', kind: 'web', maxLagHours: 48 }], now: NOW, headSha: 'bbbbbbb2222', headCommittedAt: '2026-10-01T08:00:00Z', observations: [obs('web-prod')] }).findings).toEqual([])
  })

  it('reports a failed probe from the newest observation only', () => {
    const r = deployDrift({
      targets: [targets[0]], now: NOW, headSha: null, headCommittedAt: null,
      observations: [obs('web-prod', { ok: false, error: 'HTTP 404', observed_at: '2026-10-02T11:30:00Z' }), obs('web-prod')],
    })
    expect(r.findings.map((f) => f.ruleId)).toEqual(['probe_failed'])
    expect(r.findings[0].message).toContain('HTTP 404')
    const healed = deployDrift({ targets: [targets[0]], now: NOW, headSha: null, headCommittedAt: null, observations: [obs('web-prod', { ok: false, observed_at: '2026-10-01T00:00:00Z' }), obs('web-prod')] })
    expect(healed.findings).toEqual([])
  })

  it('flags web and mobile more than one minor apart, not one minor apart', () => {
    const skewed = deployDrift({ targets, now: NOW, headSha: null, headCommittedAt: null, observations: [obs('web-prod', { observed_version: '1.102.0' }), obs('android-play', { observed_version: '1.99.3' })] })
    expect(skewed.findings.map((f) => f.ruleId)).toEqual(['platform_skew'])
    const close = deployDrift({ targets, now: NOW, headSha: null, headCommittedAt: null, observations: [obs('web-prod', { observed_version: '1.102.0' }), obs('android-play', { observed_version: '1.101.9' })] })
    expect(close.findings).toEqual([])
  })
})

describe('envDrift', () => {
  const declared = [
    { name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID', in: ['github-actions'], environments: ['production'] },
    { name: 'NEXT_PUBLIC_MUSHI_API_KEY', in: ['github-actions', 'github-environment:production'], environments: ['production'] },
    { name: 'DATABASE_URL', in: ['runtime'], environments: ['production'] },
  ]

  it('flags a declared name missing where declared, with a placeholder command and no value', () => {
    const found = envDrift({
      declared,
      present: { 'github-actions': ['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'GITHUB_TOKEN'], 'github-environment:production': ['NEXT_PUBLIC_MUSHI_API_KEY'] },
      exampleNames: null,
    })
    expect(found.map((f) => [f.ruleId, f.severity])).toEqual([['env_missing', 'error']])
    expect(found[0].suggestedFix.text).toBe('gh secret set NEXT_PUBLIC_MUSHI_API_KEY --body "<value>"')
  })

  it('does not judge locations it could not list (runtime, an environment that was not read)', () => {
    expect(envDrift({ declared, present: { 'github-actions': ['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'NEXT_PUBLIC_MUSHI_API_KEY'] }, exampleNames: null })).toEqual([])
  })

  it('notes undeclared app names (not GitHub platform names) and a .env.example that disagrees', () => {
    const found = envDrift({
      declared,
      present: { 'github-actions': ['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'NEXT_PUBLIC_MUSHI_API_KEY', 'SENTRY_AUTH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_STEP_DEBUG'] },
      exampleNames: ['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'NEXT_PUBLIC_SUPABASE_URL'],
    })
    expect(found.map((f) => f.ruleId)).toEqual(['env_undeclared', 'env_example_mismatch'])
    expect(found[0].message).toContain('SENTRY_AUTH_TOKEN')
    expect(found[0].message).not.toContain('GITHUB_TOKEN')
    expect(found[1].message).toContain('NEXT_PUBLIC_SUPABASE_URL')
  })
})

describe('schemaMigrationDrift', () => {
  it('flags repo migrations never applied, and applied ones missing from the repo', () => {
    const found = schemaMigrationDrift({
      declared: ['supabase/migrations/20261001000000_a.sql', 'supabase/migrations/20261002000000_b.sql', 'supabase/migrations/README.md'],
      applied: ['20261001000000', '20250101000000_hotfix'],
    })
    expect(found.map((f) => [f.ruleId, f.severity])).toEqual([['migration_unapplied', 'error'], ['migration_unknown_remote', 'warn']])
    expect(found[0].filePath).toBe('supabase/migrations/20261002000000_b.sql')
    expect(found[0].suggestedFix).toEqual({ kind: 'command', text: 'supabase db push' })
    expect(found[1].message).toContain('20250101000000')
  })

  it('is quiet when the two lists agree', () => {
    expect(schemaMigrationDrift({ declared: ['20261001000000_a.sql'], applied: ['20261001000000'] })).toEqual([])
    expect(migrationVersion('x/20261001000000_a.sql')).toBe('20261001000000')
    expect(migrationVersion('README.md')).toBeNull()
  })
})

describe('integrationDrift', () => {
  const NOW = new Date('2026-10-02T12:00:00Z')
  it('flags a declared integration that is not connected, a project mismatch, and 24 h of failed health', () => {
    const found = integrationDrift({
      declared: { sentry: { project: 'glot-web' }, slack: {}, linear: {} },
      configured: { sentry: { projectSlug: 'glot-old' }, slack: true },
      health: [
        { kind: 'sentry', status: 'down', checked_at: '2026-10-02T11:00:00Z' },
        { kind: 'sentry', status: 'down', checked_at: '2026-10-01T10:00:00Z' },
        { kind: 'sentry', status: 'ok', checked_at: '2026-09-30T10:00:00Z' },
        { kind: 'slack', status: 'down', checked_at: '2026-10-02T11:00:00Z' },
        { kind: 'slack', status: 'ok', checked_at: '2026-10-02T09:00:00Z' },
      ],
      now: NOW,
    })
    expect(found.map((f) => f.ruleId)).toEqual(['integration_declared_missing', 'integration_down_24h', 'sentry_project_mismatch'])
    expect(found[0].message).toContain('Linear')
    expect(found[1].message).toContain('sentry')
  })

  it('is quiet when everything declared is connected and healthy', () => {
    expect(integrationDrift({
      declared: { sentry: { project: 'glot-web' } },
      configured: { sentry: { projectSlug: 'glot-web' } },
      health: [{ kind: 'sentry', status: 'ok', checked_at: '2026-10-02T11:00:00Z' }],
      now: NOW,
    })).toEqual([])
  })
})

describe('budgets and cadence', () => {
  it('flags a metric over budget and ignores a metric with no value', () => {
    const found = budgetDrift({ 'bundle.web.total_kb': 900, 'code_health.god_file_count': 0, 'code_health.max_file_loc': 2000 }, { 'bundle.web.total_kb': 950, 'code_health.god_file_count': 0 })
    expect(found.map((f) => [f.gate, f.ruleId, f.severity])).toEqual([['code_health', 'budget_exceeded', 'warn']])
    expect(found[0].message).toContain('950')
  })

  it('lists gates that never ran or ran longer ago than their cadence, and unreadable cadences', () => {
    const NOW = new Date('2026-10-02T12:00:00Z')
    expect(cadenceStale(
      { code_health: 'P1D', crawl: 'P1W', design_drift: 'PT6H', status_claim: 'soon' },
      { code_health: '2026-09-30T12:00:00Z', crawl: '2026-09-30T12:00:00Z', design_drift: null },
      NOW,
    )).toEqual([
      { gate: 'code_health', lastRunAt: '2026-09-30T12:00:00Z', cadence: 'P1D' },
      { gate: 'design_drift', lastRunAt: null, cadence: 'PT6H' },
      { gate: 'status_claim', lastRunAt: null, cadence: null },
    ])
    expect(isoDurationMs('P1DT2H')).toBe(26 * 3_600_000)
    expect(isoDurationMs('P')).toBeNull()
  })
})
