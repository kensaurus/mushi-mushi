import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerReportsCommands } from './reports.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-2222-4333-8444-555555555555'
const RID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const filed = (over: Record<string, unknown> = {}) => ({
  reportId: RID, projectId: PID, title: 'Checkout adds tax twice', status: 'new', severity: null, component: null, ...over,
})

describe('mushi reports file: input checks', () => {
  const file = (args: string[]) => runCli(registerReportsCommands, ['reports', 'file', ...args], () => okReply(filed()))

  it('trims and sends only the fields given', async () => {
    const plain = await file(['--title', '  Checkout adds tax twice ', '--description', ' Cart of 2 '])
    expect(plain.calls[0]!.body).toEqual({ title: 'Checkout adds tax twice', description: 'Cart of 2' })
    const full = await file(['--title', 'Bump sharp', '--description', 'x', '--severity', 'LOW', '--component', ' build '])
    expect(full.calls[0]!.body).toEqual({ title: 'Bump sharp', description: 'x', severity: 'low', component: 'build' })
  })

  it.each([
    [['--title', 'ab', '--description', 'x'], /--title/],
    [['--title', 'x'.repeat(201), '--description', 'x'], /--title/],
    [['--title', 'fine title', '--description', '  '], /--description/],
    [['--title', 'fine title', '--description', 'x'.repeat(10_001)], /--description/],
    [['--title', 'fine title', '--description', 'x', '--severity', 'urgent'], /--severity/],
    [['--title', 'fine title', '--description', 'x', '--component', 'c'.repeat(201)], /--component/],
  ])('refuses %j before calling the API', async (args, message) => {
    const run = await file(args)
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
    expect(run.error?.message).toMatch(message)
  })
})

describe('mushi reports file', () => {
  it('posts to the configured project and prints the new report', async () => {
    const run = await runCli(
      registerReportsCommands,
      ['reports', 'file', '--title', 'Checkout adds tax twice', '--description', 'Cart of 2 shows tax x2', '--severity', 'high', '--component', 'checkout'],
      () => okReply(filed({ severity: 'high', component: 'checkout' })),
    )
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]).toMatchObject({
      method: 'POST',
      path: `/v1/admin/projects/${PID}/reports`,
      body: { title: 'Checkout adds tax twice', description: 'Cart of 2 shows tax x2', severity: 'high', component: 'checkout' },
    })
    expect(run.stdout).toContain(`Filed report ${RID}`)
    expect(run.stdout).toContain(`mushi reports show ${RID}`)
    expect(run.exitCode).toBe(0)
  })

  it('files on another project with --project or --project-id', async () => {
    for (const flag of ['--project', '--project-id']) {
      const run = await runCli(
        registerReportsCommands,
        ['reports', 'file', '--title', 'Blank settings page', '--description', 'White screen', flag, OTHER],
        () => okReply(filed({ projectId: OTHER })),
      )
      expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${OTHER}/reports`)
    }
  })

  it('prints JSON with --json', async () => {
    const run = await runCli(
      registerReportsCommands,
      ['reports', 'file', '--title', 'Blank settings page', '--description', 'White screen', '--json'],
      () => okReply(filed()),
    )
    expect(JSON.parse(run.stdout)).toMatchObject({ reportId: RID, status: 'new' })
  })

  it('refuses a bad severity or project id before calling the API', async () => {
    const bad = await runCli(registerReportsCommands, ['reports', 'file', '--title', 'fine title', '--description', 'x', '--severity', 'urgent'])
    expect(bad.calls).toHaveLength(0)
    expect(bad.error?.message).toMatch(/--severity/)
    const badProject = await runCli(registerReportsCommands, ['reports', 'file', '--title', 'fine title', '--description', 'x', '--project', 'nope'])
    expect(badProject.calls).toHaveLength(0)
  })

  it('surfaces a rate limit from the server', async () => {
    const run = await runCli(
      registerReportsCommands,
      ['reports', 'file', '--title', 'fine title', '--description', 'x'],
      () => errorReply(429, 'RATE_LIMITED', 'This app already had 30 reports filed in the last hour. Try again later.'),
    )
    expect(run.exitCode).not.toBe(0)
    expect(run.stderr).toContain('RATE_LIMITED')
  })
})
