import { describe, expect, it } from 'vitest'
import { deriveUpdateCenterView, normalizeVersion } from './updateCenterView'

const MUSHI = {
  sdk_package: '@mushi-mushi/web',
  sdk_version: '1.31.1',
  sdk_latest_version: '1.31.1',
  sdk_status: 'up-to-date' as const,
}
const GLOT = {
  sdk_package: '@mushi-mushi/web',
  sdk_version: '1.28.0',
  sdk_latest_version: '1.31.1',
  sdk_status: 'outdated' as const,
}
const PLAN_142 = [
  { package: '@mushi-mushi/core', from: '1.28.0', to: '1.31.0' },
  { package: '@mushi-mushi/web', from: '1.28.0', to: '1.31.0' },
]

describe('deriveUpdateCenterView', () => {
  it('says up to date with no upgrade button when the app runs the latest release (finding A10)', () => {
    // mushi-mushi on 2026-10-04: web 1.31.1 reported, 1.31.1 published; the
    // page still showed a red "Create Upgrade PR".
    const v = deriveUpdateCenterView(MUSHI, { status: 'idle' })
    expect(v.mode).toBe('up_to_date')
    expect(v.upgradeLabel).toBeNull()
    expect(v.packages).toEqual([
      { package: '@mushi-mushi/web', installed: '1.31.1', latest: '1.31.1', current: true },
    ])
  })

  it('labels the one upgrade button with the target version', () => {
    const v = deriveUpdateCenterView(GLOT, { status: 'idle' })
    expect(v.mode).toBe('upgrade_available')
    expect(v.upgradeLabel).toBe('Upgrade to 1.31.1')
    expect(v.packages[0]).toMatchObject({ installed: '1.28.0', latest: '1.31.1', current: false })
  })

  it('shows an open PR with its CI state instead of offering a new one', () => {
    const v = deriveUpdateCenterView(GLOT, {
      status: 'completed',
      prUrl: 'https://github.com/kensaurus/glot.it/pull/142',
      plan: PLAN_142,
      prState: 'open',
      checkRunConclusion: 'failure',
    })
    expect(v.mode).toBe('pr_open')
    expect(v.upgradeLabel).toBeNull()
    expect(v.ci).toBe('failing')
    expect(v.prTargetVersion).toBe('1.31.0')
  })

  it('treats an unsynced PR (pr_state null) as open, never as a reason for a duplicate', () => {
    const v = deriveUpdateCenterView(GLOT, {
      status: 'completed',
      prUrl: 'https://github.com/kensaurus/glot.it/pull/142',
      plan: PLAN_142,
    })
    expect(v.mode).toBe('pr_open')
    expect(v.ci).toBe('not_checked')
  })

  it('after a merge, offers the next upgrade only when a newer release shipped since', () => {
    const merged = {
      status: 'completed' as const,
      prUrl: 'https://github.com/kensaurus/glot.it/pull/142',
      plan: PLAN_142,
      prState: 'merged',
    }
    const v = deriveUpdateCenterView(GLOT, merged)
    expect(v.mode).toBe('pr_merged')
    expect(v.newerThanPr).toBe(true)
    expect(v.upgradeLabel).toBe('Upgrade to 1.31.1')

    const caughtUp = deriveUpdateCenterView({ ...GLOT, sdk_latest_version: '1.31.0' }, merged)
    expect(caughtUp.mode).toBe('pr_merged')
    expect(caughtUp.upgradeLabel).toBeNull()
  })

  it('only says "ship a new build" when the app is behind the merged PR (the-wanting-mind)', () => {
    const merged = { status: 'completed' as const, prUrl: 'https://github.com/kensaurus/x/pull/157', plan: PLAN_142, prState: 'merged' }
    // PR moved it to 1.31.0; the app already runs 1.31.1 and 1.31.2 is out.
    const ahead = deriveUpdateCenterView({ ...GLOT, sdk_version: '1.31.1', sdk_latest_version: '1.31.2' }, merged)
    expect(ahead.appBehindPr).toBe(false)
    expect(ahead.upgradeLabel).toBe('Upgrade to 1.31.2')
    const behind = deriveUpdateCenterView({ ...GLOT, sdk_version: '1.30.0', sdk_latest_version: '1.31.0' }, merged)
    expect(behind.appBehindPr).toBe(true)
  })

  it('shows the lockfile wait as its own state with no button', () => {
    const v = deriveUpdateCenterView(GLOT, { status: 'awaiting_lockfile', jobId: 'j' })
    expect(v.mode).toBe('awaiting_lockfile')
    expect(v.upgradeLabel).toBeNull()
  })

  it('says not checked yet when no app has reported a version', () => {
    const v = deriveUpdateCenterView({ sdk_status: 'unknown' }, { status: 'idle' })
    expect(v.mode).toBe('not_checked')
    expect(v.packages).toEqual([])
  })

  it('compares versions with or without a v prefix', () => {
    expect(normalizeVersion('v1.31.1')).toBe('1.31.1')
    const v = deriveUpdateCenterView(
      { ...MUSHI, sdk_version: 'v1.31.1', sdk_status: 'unknown' },
      { status: 'idle' },
    )
    expect(v.mode).toBe('up_to_date')
  })
})
