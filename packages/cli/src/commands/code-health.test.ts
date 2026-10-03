import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli } from '../test-harness.js'
import { registerCodeHealthCommands } from './code-health.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const PID = '11111111-2222-4333-8444-555555555555'

describe('mushi code-health show', () => {
  it('reads the configured project with the trend window', async () => {
    const run = await runCli(registerCodeHealthCommands, ['code-health', 'show', '--days', '14'], () => okReply({
      godFiles: [{ id: 'f1', rule_id: 'god_file', severity: 'error', file_path: 'app/screens/Home.tsx', line: null, message: '2,400 lines', suggested_fix: null }],
      latestRunAt: '2026-10-02T00:00:00Z',
      latestRunStatus: 'fail',
      summary: { error_count: 1, warn_count: 0, max_loc: 2400, latest_bundle_kb: 512 },
    }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/code-health?project_id=${PID}&days=14`)
    expect(run.stdout).toContain('1 error(s), 0 warning(s)')
    expect(run.stdout).toContain('largest file 2400 lines')
    expect(run.stdout).toContain('app/screens/Home.tsx')
    expect(run.stdout).toContain('[f1]')
  })

  it('explains how data arrives when nothing has run', async () => {
    const run = await runCli(registerCodeHealthCommands, ['code-health', 'show'], () => okReply({
      godFiles: [], latestRunAt: null, latestRunStatus: null, summary: { error_count: 0, warn_count: 0, max_loc: null, latest_bundle_kb: null },
    }))
    expect(run.stdout).toContain('No code-health run yet')
    expect(run.stdout).toContain('/v1/ingest/metrics')
  })
})

describe('mushi code-health stats', () => {
  it('prints the counts', async () => {
    const run = await runCli(registerCodeHealthCommands, ['code-health', 'stats', '--project-id', PID], () => okReply({
      hasAnyProject: true, projectName: 'Habit app', errorCount: 2, warnCount: 1, godFileCount: 3, hasRun: true, latestRunAt: '2026-10-02T00:00:00Z', topPriorityLabel: 'Split Home.tsx',
    }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/code-health/stats?project_id=${PID}`)
    expect(run.stdout).toContain('Habit app: 2 error(s), 1 warning(s), 3 oversized file(s)')
    expect(run.stdout).toContain('Next: Split Home.tsx')
  })
})
