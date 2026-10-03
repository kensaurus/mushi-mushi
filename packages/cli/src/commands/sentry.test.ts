import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerSentryCommands } from './sentry.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const PID = '11111111-2222-4333-8444-555555555555'

const emptyImport = {
  items: [], created: [], linked: [], failed: 0, indexing: { queued: false, paths: 0 }, sentryProject: 'web', sentryProjects: ['web'], nextCursor: null,
}

describe('mushi sentry import: request body', () => {
  it('sends issue ids alone', async () => {
    const run = await runCli(registerSentryCommands, ['sentry', 'import', 'WEB-1', 'WEB-2'], () => okReply(emptyImport))
    expect(run.calls[0]!.body).toEqual({ issueIds: ['WEB-1', 'WEB-2'] })
  })

  it.each([
    [['WEB-1', '--query', 'is:unresolved'], /not both/],
    [['WEB-1', '--sentry-project', 'web'], /not both/],
    [['--limit', '11'], /--limit/],
    [['--since-days', '91'], /--since-days/],
    [Array.from({ length: 11 }, (_, i) => `W-${i}`), /at most 10/],
  ])('refuses %j before calling the API', async (args, message) => {
    const run = await runCli(registerSentryCommands, ['sentry', 'import', ...args])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.message).toMatch(message)
  })

  it('builds a search body', async () => {
    const run = await runCli(
      registerSentryCommands,
      ['sentry', 'import', '--query', 'level:error', '--limit', '5', '--since-days', '7', '--sentry-project', 'web'],
      () => okReply({ ...emptyImport, nextCursor: '0:10:0' }),
    )
    expect(run.calls[0]!.body).toEqual({ query: 'level:error', limit: 5, sinceDays: 7, sentryProject: 'web' })
    expect(run.stdout).toContain('More issues: mushi sentry import --query "level:error" --since-days 7 --limit 5 --sentry-project web --cursor 0:10:0')
  })
})

describe('mushi sentry import', () => {
  it('posts to the configured project and prints each outcome', async () => {
    const run = await runCli(registerSentryCommands, ['sentry', 'import', '--query', 'level:error'], () => okReply({
      items: [
        { input: 'WEB-1', issueId: '1', shortId: 'WEB-1', outcome: 'created', reportId: 'r1' },
        { input: 'WEB-2', issueId: '2', shortId: 'WEB-2', outcome: 'linked', reportId: 'r2' },
      ],
      created: ['r1'], linked: ['r2'], failed: 0,
      indexing: { queued: true, paths: 3 }, sentryProject: 'web', sentryProjects: ['web'], nextCursor: '0:5:0',
    }))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/sentry/import`, body: { query: 'level:error' } })
    expect(run.stdout).toContain('CREATED    WEB-1 → report r1')
    expect(run.stdout).toContain('New reports: 1 · linked to existing: 1 · failed: 0')
    expect(run.stdout).toContain('Indexing 3 file(s)')
    expect(run.stdout).toContain('More issues: mushi sentry import --query "level:error" --cursor 0:5:0')
    expect(run.exitCode).toBe(0)
  })

  it('exits 1 when an issue failed', async () => {
    const run = await runCli(registerSentryCommands, ['sentry', 'import', 'WEB-9'], () => okReply({
      items: [{ input: 'WEB-9', issueId: null, shortId: null, outcome: 'error', reportId: null, error: 'not found' }],
      created: [], linked: [], failed: 1, indexing: { queued: false, paths: 0 }, sentryProject: 'web', sentryProjects: ['web'], nextCursor: null,
    }))
    expect(run.calls[0]!.body).toEqual({ issueIds: ['WEB-9'] })
    expect(run.exitCode).toBe(1)
  })

  it('surfaces SENTRY_NOT_CONFIGURED', async () => {
    const run = await runCli(registerSentryCommands, ['sentry', 'import'], () =>
      errorReply(400, 'SENTRY_NOT_CONFIGURED', 'Set the Sentry auth token in Integrations → Sentry before importing.'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('SENTRY_NOT_CONFIGURED')
  })
})
