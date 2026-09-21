/**
 * FILE: apps/admin/src/lib/track.test.ts
 * PURPOSE: `trackSelf` must never throw and must be a no-op when the
 *          dogfooded SDK is disabled or not loaded. It accepts only taxonomy
 *          events with their required properties (the `@ts-expect-error`
 *          lines are checked by `tsc`), and warns in dev when a cast slips a
 *          required property past the types.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('trackSelf — taxonomy contract', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mocks.getMushiSelf.mockReset()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('sends an empty bag for events with no required properties', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    trackSelf('invite_sent')
    expect(track).toHaveBeenCalledWith('invite_sent', {})
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns in dev when a cast drops a required property, and still sends', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    const incomplete = { report_id: 'r1' } as unknown as { report_id: string; agent: string }
    trackSelf('fix_dispatched', incomplete)
    expect(warn).toHaveBeenCalledWith('[track] fix_dispatched is missing required properties: agent')
    expect(track).toHaveBeenCalledWith('fix_dispatched', { report_id: 'r1' })
  })

  it('treats a null required property as missing', () => {
    mocks.getMushiSelf.mockReturnValue({ track: vi.fn() })
    const nulled = { report_id: null } as unknown as { report_id: string }
    trackSelf('report_opened', nulled)
    expect(warn).toHaveBeenCalledWith('[track] report_opened is missing required properties: report_id')
  })

  it('rejects off-taxonomy names and missing required properties at compile time', () => {
    mocks.getMushiSelf.mockReturnValue({ track: vi.fn() })
    // @ts-expect-error — not a MUSHI_EVENTS name
    trackSelf('pageview')
    // @ts-expect-error — report_opened requires report_id
    trackSelf('report_opened', { project_id: 'p1' })
    // @ts-expect-error — required properties cannot be null
    trackSelf('upgrade_clicked', { plan: null })
    // @ts-expect-error — events with required properties need a bag
    trackSelf('loop_signup')
    // At runtime the three required-property gaps still reach the dev
    // warning; the unknown name has no taxonomy entry to check against.
    expect(warn).toHaveBeenCalledTimes(3)
  })
})
