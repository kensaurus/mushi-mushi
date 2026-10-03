import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import type { PortfolioData, PortfolioFindingsData } from './portfolio.js'
import { registerPortfolioCommands } from './portfolio.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const ORG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const portfolio: PortfolioData = {
  organizationId: ORG,
  organizationName: 'Indie Apps',
  page: 1,
  pageSize: 25,
  totalProjects: 1,
  repeatedGroups: 2,
  holes: 1,
  cards: [{
    projectId: 'p1',
    name: 'Habit app',
    kind: 'app',
    worst: 'warn',
    error: null,
    openReports: 3,
    sdk: [{ package: '@mushi-mushi/web', version: '1.20.0', latest: '1.30.0', status: 'behind' }],
    latestRelease: { version: '2.1.0', publishedAt: null },
    radar: { status: 'warn', open: { error: 0, warn: 2, info: 0 }, unchecked: 1 },
    spend: { llmUsd30d: 1.2, autofixCapUsd: null, monthlyLlmBudgetUsd: null },
  }],
}

describe('mushi portfolio show', () => {
  it('reads the current organization by default and prints one line per app', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'show'], () => okReply(portfolio))
    expect(run.calls).toEqual([expect.objectContaining({ method: 'GET', path: '/v1/admin/orgs/current/portfolio?page=1' })])
    expect(run.stdout).toContain('Indie Apps — 1 app(s), page 1/1')
    expect(run.stdout).toContain('Habit app')
    expect(run.stdout).toContain('3 open report(s)')
    expect(run.stdout).toContain('SDK behind (@mushi-mushi/web 1.20.0→1.30.0)')
    expect(run.exitCode).toBe(0)
  })

  it('passes --org and --page through, and prints JSON with --json', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'show', '--org', ORG, '--page', '2', '--json'], () => okReply(portfolio))
    expect(run.calls[0]!.path).toBe(`/v1/admin/orgs/${ORG}/portfolio?page=2`)
    expect(JSON.parse(run.stdout)).toEqual(portfolio)
  })

  it('rejects a malformed --org before calling the API', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'show', '--org', 'not-a-uuid'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })

  it('lists the organizations to pick from when the caller has several', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'show'], () =>
      errorReply(400, 'ORG_REQUIRED', 'You belong to several organizations; pass one of these ids.', {
        organizations: [{ id: ORG, name: 'Indie Apps' }, { id: 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'Client work' }],
      }))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain(`--org ${ORG}   Indie Apps`)
    expect(run.stderr).toContain('Client work')
  })

  it('explains the account-level key when the key is bound to one project', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'show'], () =>
      errorReply(403, 'PORTFOLIO_NEEDS_ACCOUNT_KEY', 'This key is bound to one project.'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('account-level key')
  })
})

describe('mushi portfolio resources', () => {
  it('lists shared resources with the apps that use them', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'resources'], () => okReply({
      organizationId: ORG,
      resources: [{ id: 'r1', kind: 'domain', externalId: 'example.com', uses: [{ projectId: 'p1', role: 'web', source: 'recipe' }, { projectId: 'p2', role: 'api', source: 'csv' }] }],
      findings: [{ id: 'f1', rule_id: 'domain_expiry', severity: 'warn', project_ids: ['p1', 'p2'], message: 'example.com expires in 20 days' }],
    }))
    expect(run.calls[0]!.path).toBe('/v1/admin/orgs/current/portfolio/resources')
    expect(run.stdout).toContain('example.com  used by 2 app(s)')
    expect(run.stdout).toContain('domain_expiry — example.com expires in 20 days')
  })

  it('says where resources come from when there are none', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'resources'], () => okReply({ organizationId: ORG, resources: [], findings: [] }))
    expect(run.stdout).toContain('No shared resources recorded yet')
  })
})

describe('mushi portfolio findings', () => {
  const findings: PortfolioFindingsData = {
    organizationId: ORG,
    groups: [{ ruleId: 'missing_rls', gate: 'schema_drift', severity: 'error', projectIds: ['p1', 'p2'], findingCount: 4, sampleMessage: 'Table todos has no RLS', suggestedFix: 'Enable RLS' }],
    sdkSkew: [{ projectId: 'p2', package: '@mushi-mushi/web', version: '1.0.0', latest: '1.30.0', status: 'behind', reason: 'old' }],
    holes: [{ projectId: 'p2', integration: 'sentry', siblingsWith: 1, reason: 'Habit app has Sentry connected' }],
    crossProject: [],
  }

  it('groups the same problem across apps', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'findings'], () => okReply(findings))
    expect(run.calls[0]!.path).toBe('/v1/admin/orgs/current/portfolio/findings')
    expect(run.stdout).toContain('missing_rls (schema_drift) — 4 finding(s) in 2 app(s)')
    expect(run.stdout).toContain('p2  @mushi-mushi/web 1.0.0 → 1.30.0')
    expect(run.stdout).toContain('sentry')
  })

  it('says so when nothing repeats', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'findings'], () =>
      okReply({ organizationId: ORG, groups: [], sdkSkew: [], holes: [], crossProject: [] }))
    expect(run.stdout).toContain('No repeated problems')
  })
})
