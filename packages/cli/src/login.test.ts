import { describe, expect, it, vi } from 'vitest'

import {
  getPostLoginBannerMessage,
  pollUntilApproved,
  resolveProjectChoice,
  type PollUntilApprovedDeps,
} from './login.js'
import type { pollDeviceToken } from './device-auth.js'

type PollOutcome = Awaited<ReturnType<typeof pollDeviceToken>>

describe('getPostLoginBannerMessage', () => {
  it('returns null when suppressPostLoginBanner is set (setup mid-flow)', () => {
    expect(getPostLoginBannerMessage({ suppressPostLoginBanner: true })).toBeNull()
  })

  it('returns init hint for standalone login', () => {
    expect(getPostLoginBannerMessage({})).toContain('mushi init')
  })

  it('returns setup hint for upgrade-scope login', () => {
    expect(getPostLoginBannerMessage({ upgradeScope: true })).toContain('mushi setup')
  })
})

describe('pollUntilApproved', () => {
  const DEVICE = { device_code: 'dc-1', interval: 5, expires_in: 600 }

  function deps(outcomes: PollOutcome[]): PollUntilApprovedDeps & {
    sleeps: number[]
  } {
    const queue = [...outcomes]
    const sleeps: number[] = []
    let clock = 0
    return {
      poll: vi.fn(async () => {
        const next = queue.shift()
        if (!next) throw new Error('poll called more times than outcomes provided')
        return next
      }),
      sleep: async (ms: number) => {
        sleeps.push(ms)
        clock += ms
      },
      now: () => clock,
      sleeps,
    }
  }

  it('resolves approved after pending polls', async () => {
    const d = deps([{ status: 'pending' }, { status: 'pending' }, { status: 'approved', cliToken: 'tok' }])
    const result = await pollUntilApproved('https://api', DEVICE, d)
    expect(result).toEqual({ status: 'approved', cliToken: 'tok' })
    expect(d.poll).toHaveBeenCalledTimes(3)
    // First poll is immediate; subsequent polls wait the interval.
    expect(d.sleeps).toEqual([5000, 5000])
  })

  it('honors slow_down by raising the poll interval', async () => {
    const d = deps([
      { status: 'slow_down', retryAfterMs: 10_000 },
      { status: 'pending' },
      { status: 'approved', cliToken: 'tok' },
    ])
    const result = await pollUntilApproved('https://api', DEVICE, d)
    expect(result.status).toBe('approved')
    expect(d.sleeps).toEqual([10_000, 10_000])
  })

  it('returns denied immediately', async () => {
    const d = deps([{ status: 'denied' }])
    expect(await pollUntilApproved('https://api', DEVICE, d)).toEqual({ status: 'denied' })
  })

  it('maps expired to timeout', async () => {
    const d = deps([{ status: 'expired' }])
    expect(await pollUntilApproved('https://api', DEVICE, d)).toEqual({ status: 'timeout' })
  })

  it('retries transient errors then surfaces the error at MAX_CONSECUTIVE_ERRORS', async () => {
    const transient: PollOutcome = { status: 'error', retryable: true, message: 'ECONNRESET' }
    const d = deps([transient, transient, transient, transient, transient])
    const result = await pollUntilApproved('https://api', DEVICE, d)
    expect(result).toEqual({ status: 'error', message: 'ECONNRESET' })
    expect(d.poll).toHaveBeenCalledTimes(5)
  })

  it('a pending in between resets the consecutive-error counter', async () => {
    const transient: PollOutcome = { status: 'error', retryable: true, message: 'flaky' }
    const d = deps([
      transient,
      transient,
      { status: 'pending' },
      transient,
      { status: 'approved', cliToken: 'tok' },
    ])
    expect((await pollUntilApproved('https://api', DEVICE, d)).status).toBe('approved')
  })

  it('non-retryable errors surface immediately', async () => {
    const d = deps([{ status: 'error', retryable: false, message: 'HTTP 500' }])
    expect(await pollUntilApproved('https://api', DEVICE, d)).toEqual({ status: 'error', message: 'HTTP 500' })
  })

  it('times out at the device-code deadline', async () => {
    const pending: PollOutcome = { status: 'pending' }
    // 30s expiry with 10s interval → immediate poll + 3 sleeps, then deadline.
    const d = deps([pending, pending, pending, pending])
    const result = await pollUntilApproved('https://api', { device_code: 'dc-1', interval: 10, expires_in: 30 }, d)
    expect(result).toEqual({ status: 'timeout' })
  })
})

describe('resolveProjectChoice', () => {
  const PROJECTS = [
    { id: 'p-1', name: 'Alpha' },
    { id: 'p-2', name: 'Beta' },
  ]

  it('picks an existing project by number', async () => {
    const ask = vi.fn(async () => '2')
    expect(await resolveProjectChoice(PROJECTS, ask)).toEqual({ kind: 'picked', id: 'p-2', name: 'Beta' })
  })

  it('out-of-range choice falls through to create-new', async () => {
    const ask = vi.fn(async (q: string) => (q.includes('Pick a project') ? '9' : 'My New App'))
    expect(await resolveProjectChoice(PROJECTS, ask)).toEqual({ kind: 'create', name: 'My New App' })
  })

  it('non-numeric choice falls through to create-new', async () => {
    const ask = vi.fn(async (q: string) => (q.includes('Pick a project') ? 'nope' : 'App'))
    expect(await resolveProjectChoice(PROJECTS, ask)).toEqual({ kind: 'create', name: 'App' })
  })

  it('empty project list goes straight to the name prompt', async () => {
    const ask = vi.fn(async () => 'First App')
    expect(await resolveProjectChoice([], ask)).toEqual({ kind: 'create', name: 'First App' })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('blank name is rejected as empty_name', async () => {
    const ask = vi.fn(async () => '   ')
    expect(await resolveProjectChoice([], ask)).toEqual({ kind: 'empty_name' })
  })
})
