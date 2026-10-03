import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerOutboxCommands } from './outbox.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const MID = '33333333-4444-4555-8666-777777777777'

describe('mushi outbox list', () => {
  it('lists held messages and the text the reporter would get', async () => {
    const run = await runCli(registerOutboxCommands, ['outbox', 'list'], () => okReply({ messages: [{
      id: MID, project_id: 'p', report_id: 'r', report_title: 'Login\nbutton broken', notification_type: 'fixed',
      text: 'Your report was fixed.', body_override: null, created_at: '2026-10-01T00:00:00Z',
    }] }))
    expect(run.calls[0]).toMatchObject({ method: 'GET', path: '/v1/admin/reporter-outbox' })
    expect(run.stdout).toContain('1 update(s) waiting for review')
    expect(run.stdout).toContain('report: Login button broken')
    expect(run.stdout).toContain('sends:  Your report was fixed.')
  })

  it('says when nothing is held', async () => {
    const run = await runCli(registerOutboxCommands, ['outbox', 'list'], () => okReply({ messages: [] }))
    expect(run.stdout).toContain('Nothing held')
  })
})

describe('mushi outbox release / discard', () => {
  it('needs --yes to release', async () => {
    const run = await runCli(registerOutboxCommands, ['outbox', 'release', MID])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.message).toContain('--yes')
  })

  it('releases with an optional new wording', async () => {
    const run = await runCli(registerOutboxCommands, ['outbox', 'release', MID, '--text', 'Fixed in 1.4', '--yes'], () =>
      okReply({ delivered: 1, skipped: 0, duplicate: 0, failed: 0 }))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/reporter-outbox/${MID}/release`, body: { body_override: 'Fixed in 1.4' } })
    expect(run.stdout).toContain('Released: delivered 1')
  })

  it('reports a message that is no longer held', async () => {
    const run = await runCli(registerOutboxCommands, ['outbox', 'release', MID, '--yes'], () => errorReply(409, 'CONFLICT', 'Message is no longer held'))
    expect(run.calls[0]!.body).toEqual({})
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('no longer held')
  })

  it('discards only with --yes', async () => {
    const without = await runCli(registerOutboxCommands, ['outbox', 'discard', MID])
    expect(without.calls).toHaveLength(0)
    const run = await runCli(registerOutboxCommands, ['outbox', 'discard', MID, '--yes'], () => okReply({ delivered: 0, skipped: 1, duplicate: 0, failed: 0 }))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/reporter-outbox/${MID}/discard` })
  })
})

describe('mushi outbox edit', () => {
  it('patches the wording', async () => {
    const run = await runCli(registerOutboxCommands, ['outbox', 'edit', MID, '  Shipped today  '], () => okReply({ id: MID, body_override: 'Shipped today' }))
    expect(run.calls[0]).toMatchObject({ method: 'PATCH', body: { body_override: 'Shipped today' } })
  })

  it('refuses text over the cap', async () => {
    const run = await runCli(registerOutboxCommands, ['outbox', 'edit', MID, 'x'.repeat(1001)])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})
