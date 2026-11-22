/**
 * @vitest-environment jsdom
 */

/**
 * "Your first auto-fix was merged" fires only while the account's merges
 * total exactly 1, once per account (UX review 2026-11-22: an account with
 * dozens of merges saw it).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMilestoneCelebration } from '../../lib/useMilestoneCelebration'
import { firstMergedFixMilestone, firstMergedFixSignal } from './firstMergedFix'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('firstMergedFixSignal', () => {
  it('is null while the projects load', () => {
    expect(firstMergedFixSignal(null)).toBeNull()
    expect(firstMergedFixSignal(undefined)).toBeNull()
  })
  it('is 1 only when the merges across every app total exactly 1', () => {
    expect(firstMergedFixSignal([{ merged_fix_count: 1 }])).toBe(1)
    expect(firstMergedFixSignal([{ merged_fix_count: 0 }, { merged_fix_count: 1 }])).toBe(1)
    expect(firstMergedFixSignal([{ merged_fix_count: 0 }])).toBe(0)
    expect(firstMergedFixSignal([{ merged_fix_count: 2 }])).toBe(0)
    // One app with 1 merge in an account with dozens elsewhere is not "first".
    expect(firstMergedFixSignal([{ merged_fix_count: 1 }, { merged_fix_count: 40 }])).toBe(0)
  })
  it('keys the milestone by account and has none without a user', () => {
    expect(firstMergedFixMilestone('u1')).toBe('first-merged-fix:u1')
    expect(firstMergedFixMilestone(null)).toBeNull()
  })
})

describe('first merged fix toast through useMilestoneCelebration', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    window.localStorage.clear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function Probe({ user, counts, onFire }: { user: string; counts: number[] | null; onFire: () => void }) {
    const milestone = firstMergedFixMilestone(user) ?? 'first-merged-fix'
    useMilestoneCelebration(milestone, firstMergedFixSignal(counts?.map((n) => ({ merged_fix_count: n })) ?? null), { onFire })
    return null
  }
  const show = (user: string, counts: number[] | null, onFire: () => void) =>
    act(() => root.render(createElement(Probe, { user, counts, onFire })))
  const remount = () => {
    act(() => root.unmount())
    root = createRoot(host)
  }

  it('never fires for an account with many merges', () => {
    const onFire = vi.fn()
    show('u-many', [12, 30], onFire)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('fires once for exactly one merge and stays dismissed after a remount', () => {
    const onFire = vi.fn()
    show('u-one', [1], onFire)
    expect(onFire).toHaveBeenCalledTimes(1)
    remount()
    show('u-one', [1], onFire)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('is per account: another user on the same browser still gets theirs', () => {
    const onFire = vi.fn()
    show('u-a', [1], onFire)
    remount()
    show('u-b', [1], onFire)
    expect(onFire).toHaveBeenCalledTimes(2)
  })
})
