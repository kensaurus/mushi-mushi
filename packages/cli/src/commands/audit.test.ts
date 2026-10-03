import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerAuditCommands } from './audit.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const FID = '55555555-6666-4777-8888-999999999999'

describe('mushi audit (no subcommand)', () => {
  it('still POSTs the full-stack audit', async () => {
    const run = await runCli(registerAuditCommands, ['audit', '--json'], () => okReply({
      summary: { overall: 'ok', error_count: 0, warn_count: 0 }, findings: [], gate_runs: [], backend_linked: true, audit_at: '2026-10-01T00:00:00Z',
    }))
    expect(run.calls).toEqual([expect.objectContaining({ method: 'POST', path: `/v1/admin/projects/${PID}/audit` })])
  })
})

describe('mushi audit findings', () => {
  const data = {
    runs: [{ id: 'run1', gate: 'code_health', status: 'fail', findings_count: 2, started_at: '2026-10-01T00:00:00Z', commit_sha: null }],
    findings: [
      { id: FID, gate_run_id: 'run1', severity: 'error', rule_id: 'god_file', message: 'Home.tsx is 2,400 lines', file_path: 'app/Home.tsx', line: 1, allowlisted: false, created_at: '2026-10-01T00:00:00Z' },
      { id: 'f2', gate_run_id: 'run1', severity: 'warn', rule_id: 'god_file', message: 'allowed one', file_path: 'app/Big.tsx', line: null, allowlisted: true, created_at: '2026-10-01T00:00:00Z' },
    ],
  }

  it('calls the /v1 findings API with the filters and the subcommand keeps its own --json', async () => {
    const run = await runCli(registerAuditCommands, ['audit', 'findings', '--gate', 'code_health', '--severity', 'error', '--json'], () => okReply(data))
    expect(run.calls).toEqual([expect.objectContaining({ method: 'GET', path: `/v1/admin/inventory/${PID}/findings?gate=code_health&severity=error` })])
    expect(JSON.parse(run.stdout)).toEqual(data)
  })

  it('reads --project-id even though audit itself declares it', async () => {
    const other = '66666666-7777-4888-8999-aaaaaaaaaaaa'
    const run = await runCli(registerAuditCommands, ['audit', 'findings', '--project-id', other], () => okReply(data))
    expect(run.calls[0]!.path).toBe(`/v1/admin/inventory/${other}/findings`)
  })

  it('hides allowlisted findings unless --all', async () => {
    const run = await runCli(registerAuditCommands, ['audit', 'findings'], () => okReply(data))
    expect(run.stdout).toContain('app/Home.tsx:1')
    expect(run.stdout).not.toContain('app/Big.tsx')
    const all = await runCli(registerAuditCommands, ['audit', 'findings', '--all'], () => okReply(data))
    expect(all.stdout).toContain('app/Big.tsx')
  })

  it('rejects an unknown gate before calling the API', async () => {
    const run = await runCli(registerAuditCommands, ['audit', 'findings', '--gate', 'nope'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })

  it('says plainly when the plan does not include the list', async () => {
    const run = await runCli(registerAuditCommands, ['audit', 'findings'], () => errorReply(402, 'feature_not_in_plan', 'inventory_v2 is not on your plan'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('not on your plan')
  })
})

describe('mushi audit explain', () => {
  it('explains one finding', async () => {
    const run = await runCli(registerAuditCommands, ['audit', 'explain', FID], () => okReply({
      id: FID, gate: 'code_health', gateLabel: 'Code health', gateMeaning: 'Files too large to change safely.', ruleId: 'god_file', rule: null,
      severity: 'error', reason: 'Home.tsx is 2,400 lines', fix: { text: 'Split it', consolePath: null, command: null },
      location: { filePath: 'app/Home.tsx', line: 1, target: null }, state: 'open', stateReason: 'Still in the latest run.',
      run: { status: 'fail', completedAt: '2026-10-01T00:00:00Z', commitSha: 'abcdef123' },
    }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/findings/${FID}`)
    expect(run.stdout).toContain('ERROR — Code health (god_file)')
    expect(run.stdout).toContain('Why it fired: Home.tsx is 2,400 lines')
    expect(run.stdout).toContain('Fix: Split it')
    expect(run.stdout).toContain('State: open')
  })

  it('needs a UUID', async () => {
    const run = await runCli(registerAuditCommands, ['audit', 'explain', 'f1'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})
