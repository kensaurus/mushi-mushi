import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerStoreCommands } from './store.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'

describe('mushi store reviews', () => {
  it('shows intake, the bound stores and the reviews seen lately', async () => {
    const run = await runCli(registerStoreCommands, ['store', 'reviews'], () => okReply({
      settings: { enabled: false, maxRating: 2, lastPulledAt: null, lastStatus: null, lastError: null },
      sources: [{ store: 'app_store', appId: '123456', connected: true }],
      recent: [{ store: 'play', reviewId: 'r1', rating: 1, reportId: 'rep-1', seenAt: '2026-10-01T00:00:00Z' }],
      canManage: true,
      canPull: true,
    }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/store/reviews`)
    expect(run.stdout).toContain('Store reviews as reports: off')
    expect(run.stdout).toContain('app_store')
    expect(run.stdout).toContain('report rep-1')
    expect(run.stdout).toContain('Turn it on in the console')
  })
})

describe('mushi store reviews-pull', () => {
  it('POSTs a pull and prints each store line', async () => {
    const run = await runCli(registerStoreCommands, ['store', 'reviews-pull'], () => okReply({
      status: 'ok', filed: 2, stores: [{ store: 'play', appId: 'com.x', status: 'ok', fetched: 10, newReviews: 3, filed: 2, detail: null }],
    }))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/store/reviews/pull` })
    expect(run.stdout).toContain('filed 2 review(s)')
    expect(run.stdout).toContain('fetched 10, new 3, filed 2')
  })

  it('shows the cooldown refusal', async () => {
    const run = await runCli(registerStoreCommands, ['store', 'reviews-pull'], () => errorReply(429, 'RATE_LIMITED', 'Reviews were pulled a few minutes ago.'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('RATE_LIMITED')
  })
})

describe('mushi store reviews-set', () => {
  it('--off turns intake off; --max-rating alone keeps it on', async () => {
    const reply = () => okReply({ enabled: false, maxRating: 2, lastPulledAt: null, lastStatus: null, lastError: null })
    const off = await runCli(registerStoreCommands, ['store', 'reviews-set', '--off'], reply)
    expect(off.calls[0]).toMatchObject({ method: 'PUT', path: `/v1/admin/projects/${PID}/store/reviews/settings`, body: { enabled: false } })
    const threshold = await runCli(registerStoreCommands, ['store', 'reviews-set', '--max-rating', '1'], reply)
    expect(threshold.calls[0]!.body).toEqual({ enabled: true, maxRating: 1 })
  })

  it('refuses a bad threshold or no change before calling the API', async () => {
    for (const argv of [['store', 'reviews-set'], ['store', 'reviews-set', '--max-rating', '6']]) {
      const run = await runCli(registerStoreCommands, argv)
      expect(run.calls, argv.join(' ')).toHaveLength(0)
      expect(run.error?.code, argv.join(' ')).toBe('E_INVALID_INPUT')
    }
  })

  it('shows that turning intake on needs the console', async () => {
    const run = await runCli(registerStoreCommands, ['store', 'reviews-set', '--max-rating', '3'], () => errorReply(403, 'HUMAN_REQUIRED', 'Turning on store reviews as reports needs a signed-in owner or admin.'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('HUMAN_REQUIRED')
  })
})
