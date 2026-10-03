import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerReleasesCommands } from './releases.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const RID = '22222222-3333-4444-8555-666666666666'
const release = {
  id: RID, project_id: PID, version: '1.4.0', title: 'Login fixes', status: 'draft', published_at: null,
  credited_reporter_ids: [], fixed_report_ids: ['r1', 'r2'], fulfilled_ticket_ids: [], created_at: '2026-10-01T00:00:00Z',
}

describe('mushi releases list', () => {
  it('lists releases with the total from meta', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'list', '--status', 'draft'], () =>
      okReply([release], { meta: { total: 3, limit: 20, offset: 0 } }))
    expect(run.calls[0]!.path).toBe('/v1/admin/releases?limit=20&offset=0&status=draft')
    expect(run.stdout).toContain('1.4.0')
    expect(run.stdout).toContain('… 2 more')
  })

  it('rejects an unknown status', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'list', '--status', 'live'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})

describe('mushi releases draft', () => {
  it('takes the version as an argument and posts the window', async () => {
    const run = await runCli(
      registerReleasesCommands,
      ['releases', 'draft', '1.4.0', '--title', 'Login fixes', '--since', '2026-09-01'],
      () => okReply({ release, creditCount: 2, reportCount: 2 }),
    )
    expect(run.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/admin/releases/draft',
      body: { project_id: PID, version: '1.4.0', title: 'Login fixes', window_start: '2026-09-01' },
    })
    expect(run.stdout).toContain(`Drafted 1.4.0 (${RID}) from 2 fixed report(s), crediting 2 reporter(s).`)
  })

  it('prints a string error from the route instead of "undefined"', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'draft', '1.4.0'], () => ({ status: 500, body: { ok: false, error: 'release-builder failed' } }))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('release-builder failed')
    expect(run.stderr).not.toContain('undefined')
  })
})

describe('mushi releases publish', () => {
  it('needs --yes because reporters are messaged', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'publish', RID])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.message).toContain('--yes')
  })

  it('publishes and reports the delivery', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'publish', RID, '--yes'], () => okReply(
      { ...release, status: 'published' },
      { notified: 1, tickets_fulfilled: 0, delivery: { reports_listed: 2, reports_resolved: 2, reporters_notified: 1, reporters_held: 1, reporters_failed: 0 } },
    ))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/releases/${RID}/publish` })
    expect(run.stdout).toContain('Reporters messaged: 1, held for review: 1')
    expect(run.stdout).toContain('mushi outbox list')
  })
})

describe('mushi releases edit / delete / show / stats', () => {
  it('patches only the fields passed', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'edit', RID, '--set-version', '1.4.1'], () => okReply({ ...release, version: '1.4.1' }))
    expect(run.calls[0]).toMatchObject({ method: 'PATCH', body: { version: '1.4.1' } })
  })

  it('refuses an edit with nothing to change', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'edit', RID])
    expect(run.error?.message).toContain('Nothing to change')
  })

  it('deletes a draft only with --yes', async () => {
    const without = await runCli(registerReleasesCommands, ['releases', 'delete', RID])
    expect(without.calls).toHaveLength(0)
    const run = await runCli(registerReleasesCommands, ['releases', 'delete', RID, '--yes'], () => ({ body: { ok: true } }))
    expect(run.calls[0]).toMatchObject({ method: 'DELETE', path: `/v1/admin/releases/${RID}` })
  })

  it('shows notes and credits', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'show', RID], () => okReply({ ...release, body_md: '## Fixed\n- login', credits: [] }))
    expect(run.stdout).toContain('1.4.0 — Login fixes [draft]')
    expect(run.stdout).toContain('## Fixed')
  })

  it('prints the stats line', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'stats'], () => okReply({ draftCount: 1, publishedCount: 4, totalFixesLinked: 9, totalCredits: 5, creditsPending: 1, topPriorityLabel: 'Publish 1.4.0' }))
    expect(run.stdout).toContain('1 draft, 4 published')
    expect(run.stdout).toContain('Next: Publish 1.4.0')
  })
})

describe('mushi releases calendar', () => {
  it('reads the org calendar', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'calendar'], () => okReply({
      rows: [{ projectId: 'p1', name: 'Habit app', stage: 'waiting_for_build', mergedNotBuilt: 2, builtNotSubmitted: null, otaPending: 1, live: { version: '2.0.0', rolloutPct: 50 }, inReview: false }],
      batchSuggestion: { otaNow: ['p1'], nextStoreBatch: ['p1'], ciMinutesNow: 40, ciMinutesBatched: 20, note: 'Ship JS-only fixes as OTA now.' },
    }))
    expect(run.calls[0]!.path).toBe('/v1/admin/orgs/current/releases')
    expect(run.stdout).toContain('live 2.0.0 at 50%')
    expect(run.stdout).toContain('Ship JS-only fixes as OTA now.')
  })

  it('lists organizations on ORG_REQUIRED', async () => {
    const run = await runCli(registerReleasesCommands, ['releases', 'calendar'], () =>
      errorReply(400, 'ORG_REQUIRED', 'several', { organizations: [{ id: 'o1', name: 'A' }] }))
    expect(run.stderr).toContain('--org o1')
  })
})
