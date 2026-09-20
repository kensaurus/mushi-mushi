/**
 * FILE: apps/admin/src/lib/track.test.ts
 * PURPOSE: `trackSelf` must never throw and must be a no-op when the
 *          dogfooded SDK is disabled or not loaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMushiSelf: vi.fn(),
  initMushiSelf: vi.fn(),
  isMushiSelfEnabled: vi.fn(),
}))

vi.mock('./mushi-self', () => mocks)

import { trackSelf } from './track'

describe('trackSelf', () => {
  beforeEach(() => {
    mocks.getMushiSelf.mockReset()
    mocks.initMushiSelf.mockReset()
    mocks.isMushiSelfEnabled.mockReset()
  })

  it('forwards to the loaded SDK', () => {
    const track = vi.fn().mockReturnValue(true)
    mocks.getMushiSelf.mockReturnValue({ track })
    trackSelf('report_opened', { report_id: 'r1' })
    expect(track).toHaveBeenCalledWith('report_opened', { report_id: 'r1' })
    expect(mocks.initMushiSelf).not.toHaveBeenCalled()
  })

  it('is a no-op when the SDK is disabled', () => {
    mocks.getMushiSelf.mockReturnValue(null)
    mocks.isMushiSelfEnabled.mockReturnValue(false)
    expect(() => trackSelf('invite_sent')).not.toThrow()
    expect(mocks.initMushiSelf).not.toHaveBeenCalled()
  })

  it('defers to the init promise when enabled but not yet loaded', async () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue(null)
    mocks.isMushiSelfEnabled.mockReturnValue(true)
    mocks.initMushiSelf.mockResolvedValue({ track })
    trackSelf('signup_completed', { signup_source: 'github' })
    await Promise.resolve()
    await Promise.resolve()
    expect(track).toHaveBeenCalledWith('signup_completed', { signup_source: 'github' })
  })

  it('never throws when the SDK throws', () => {
    mocks.getMushiSelf.mockReturnValue({
      track: () => {
        throw new Error('boom')
      },
    })
    expect(() => trackSelf('fix_dispatched', { report_id: 'r', agent: 'x' })).not.toThrow()
  })
})
