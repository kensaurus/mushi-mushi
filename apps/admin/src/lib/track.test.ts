/**
 * FILE: apps/admin/src/lib/track.test.ts
 * PURPOSE: `trackSelf` must never throw and must be a no-op when the
 *          dogfooded SDK is disabled or not loaded. It accepts only taxonomy
 *          events with their required properties (the `@ts-expect-error`
 *          lines are checked by `tsc`), reports through the admin debug
 *          channel when a cast slips a required property past the types, and
 *          drops a cast off-taxonomy name. `trackAdHoc` is the path for
 *          non-taxonomy events: valid names only, never a taxonomy name.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMushiSelf: vi.fn(),
  initMushiSelf: vi.fn(),
  isMushiSelfEnabled: vi.fn(),
}))

const debug = vi.hoisted(() => ({ debugWarn: vi.fn() }))

vi.mock('./mushi-self', () => mocks)
vi.mock('./debug', () => debug)

import { trackAdHoc, trackSelf } from './track'

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
  const warn = debug.debugWarn

  beforeEach(() => {
    mocks.getMushiSelf.mockReset()
    warn.mockReset()
  })

  it('sends an empty bag for events with no required properties', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    trackSelf('invite_sent')
    expect(track).toHaveBeenCalledWith('invite_sent', {})
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn when every required property is present', () => {
    mocks.getMushiSelf.mockReturnValue({ track: vi.fn() })
    trackSelf('fix_dispatched', { report_id: 'r1', agent: 'claude' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns when a cast drops a required property, and still sends', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    const incomplete = { report_id: 'r1' } as unknown as { report_id: string; agent: string }
    trackSelf('fix_dispatched', incomplete)
    expect(warn).toHaveBeenCalledWith(
      'track',
      'fix_dispatched is missing required properties: agent',
      { event: 'fix_dispatched', missing: ['agent'] },
    )
    expect(track).toHaveBeenCalledWith('fix_dispatched', { report_id: 'r1' })
  })

  it('still sends when the debug channel itself throws (blocked storage)', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    warn.mockImplementationOnce(() => {
      throw new Error('SecurityError: localStorage blocked')
    })
    const incomplete = { report_id: 'r1' } as unknown as { report_id: string; agent: string }
    trackSelf('fix_dispatched', incomplete)
    expect(track).toHaveBeenCalledWith('fix_dispatched', { report_id: 'r1' })
  })

  it('treats a null required property as missing', () => {
    mocks.getMushiSelf.mockReturnValue({ track: vi.fn() })
    const nulled = { report_id: null } as unknown as { report_id: string }
    trackSelf('report_opened', nulled)
    expect(warn).toHaveBeenCalledWith(
      'track',
      'report_opened is missing required properties: report_id',
      { event: 'report_opened', missing: ['report_id'] },
    )
  })

  it('rejects off-taxonomy names and missing required properties at compile time', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    // @ts-expect-error — not a MUSHI_EVENTS name (a bag is passed so the
    // error is the name, not the argument count)
    trackSelf('pageview', {})
    // @ts-expect-error — report_opened requires report_id
    trackSelf('report_opened', { project_id: 'p1' })
    // @ts-expect-error — required properties cannot be null
    trackSelf('upgrade_clicked', { plan: null })
    // @ts-expect-error — events with required properties need a bag
    trackSelf('loop_signup')
    // At runtime all four reach the debug warning. The three required-
    // property gaps are still sent; the unknown name is dropped.
    expect(warn).toHaveBeenCalledTimes(4)
    expect(track).toHaveBeenCalledTimes(3)
    expect(track).not.toHaveBeenCalledWith('pageview', expect.anything())
  })

  it('drops an off-taxonomy name that reaches it through a cast', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    trackSelf('checkout_started' as unknown as 'invite_sent')
    expect(track).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'track',
      'checkout_started is not a Mushi taxonomy event; use trackAdHoc for non-funnel events',
      { event: 'checkout_started' },
    )
  })
})

describe('trackAdHoc', () => {
  const warn = debug.debugWarn

  beforeEach(() => {
    mocks.getMushiSelf.mockReset()
    mocks.initMushiSelf.mockReset()
    mocks.isMushiSelfEnabled.mockReset()
    warn.mockReset()
  })

  it('sends a valid non-taxonomy event with its properties', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    trackAdHoc('graph_layout_toggled', { layout: 'force' })
    expect(track).toHaveBeenCalledWith('graph_layout_toggled', { layout: 'force' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('sends an empty bag when no properties are given', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    trackAdHoc('palette_opened')
    expect(track).toHaveBeenCalledWith('palette_opened', {})
  })

  it('drops names that fail EVENT_NAME_RE', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    for (const bad of ['Checkout', '1st_open', 'a', 'has-dash', 'x'.repeat(65), '$pageview']) {
      trackAdHoc(bad)
    }
    expect(track).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(6)
    expect(warn).toHaveBeenCalledWith(
      'track',
      'Checkout is not a valid event name (lowercase snake_case, 2-64 chars)',
      { event: 'Checkout' },
    )
  })

  it('refuses taxonomy names, which must go through trackSelf', () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue({ track })
    // @ts-expect-error — a literal taxonomy name is rejected at compile time
    trackAdHoc('report_opened', { report_id: 'r1' })
    const widened: string = 'fix_dispatched'
    trackAdHoc(widened)
    expect(track).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'track',
      'fix_dispatched is a Mushi taxonomy event; use trackSelf so its required properties are checked',
      { event: 'fix_dispatched' },
    )
  })

  it('defers to the init promise when enabled but not yet loaded', async () => {
    const track = vi.fn()
    mocks.getMushiSelf.mockReturnValue(null)
    mocks.isMushiSelfEnabled.mockReturnValue(true)
    mocks.initMushiSelf.mockResolvedValue({ track })
    trackAdHoc('palette_opened', { via: 'kbd' })
    await Promise.resolve()
    await Promise.resolve()
    expect(track).toHaveBeenCalledWith('palette_opened', { via: 'kbd' })
  })

  it('is a no-op when disabled and never throws', () => {
    mocks.getMushiSelf.mockReturnValue(null)
    mocks.isMushiSelfEnabled.mockReturnValue(false)
    expect(() => trackAdHoc('palette_opened')).not.toThrow()
    expect(mocks.initMushiSelf).not.toHaveBeenCalled()
    mocks.getMushiSelf.mockReturnValue({
      track: () => {
        throw new Error('boom')
      },
    })
    expect(() => trackAdHoc('palette_opened')).not.toThrow()
  })
})
