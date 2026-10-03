import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerDesignCommands } from './design.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const settings = { threshold: 40, failCi: true, autofix: true, autofixEnabled: false, canEdit: true }

describe('mushi design settings', () => {
  it('reads the configured project and says when the auto-fix does nothing', async () => {
    const run = await runCli(registerDesignCommands, ['design', 'settings'], () => okReply(settings))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/design/settings`)
    expect(run.stdout).toContain('Threshold: 40')
    expect(run.stdout).toContain('project auto-fix switch is off')
  })
})

describe('mushi design set', () => {
  it('PUTs only the flags given', async () => {
    const run = await runCli(registerDesignCommands, ['design', 'set', '--threshold', '55', '--fail-ci', 'off'], () => okReply({ ...settings, threshold: 55, failCi: false }))
    expect(run.calls[0]).toMatchObject({ method: 'PUT', path: `/v1/admin/projects/${PID}/design/settings`, body: { threshold: 55, failCi: false } })
    expect(run.stdout).toContain('Saved.')
  })

  it('refuses a bad threshold or no change before calling the API', async () => {
    for (const argv of [['design', 'set', '--threshold', '101'], ['design', 'set'], ['design', 'set', '--fail-ci', 'maybe']]) {
      const run = await runCli(registerDesignCommands, argv)
      expect(run.calls, argv.join(' ')).toHaveLength(0)
      expect(run.error?.code, argv.join(' ')).toBe('E_INVALID_INPUT')
    }
  })

  it('shows the api refusal when a key tries to turn the auto-fix on', async () => {
    const run = await runCli(registerDesignCommands, ['design', 'set', '--autofix', 'on'], () => errorReply(403, 'FORBIDDEN', 'Turning on the design auto-fix needs a signed-in owner or admin.'))
    expect(run.calls[0]!.body).toEqual({ autofix: true })
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('signed-in owner or admin')
  })
})
