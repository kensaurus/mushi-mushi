import { describe, expect, it } from 'vitest'
import { missingAppsAreNew, NEW_APP_MS, projectsHeaderStatus } from './newApps'

const now = Date.parse('2026-10-30T12:00:00Z')
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()

describe('missingAppsAreNew', () => {
  it('is true when every app without a heartbeat was made today', () => {
    expect(missingAppsAreNew([{ createdAt: hoursAgo(1) }, { createdAt: hoursAgo(23) }], 2, now)).toBe(true)
  })

  it('is false once one of them is older than a day', () => {
    expect(missingAppsAreNew([{ createdAt: hoursAgo(1) }, { createdAt: hoursAgo(25) }], 2, now)).toBe(false)
    expect(missingAppsAreNew([{ createdAt: new Date(now - NEW_APP_MS).toISOString() }], 1, now)).toBe(false)
  })

  it('is false when the list is capped below the count, empty, or has no dates', () => {
    expect(missingAppsAreNew([{ createdAt: hoursAgo(1) }], 6, now)).toBe(false)
    expect(missingAppsAreNew([], 0, now)).toBe(false)
    expect(missingAppsAreNew(undefined, undefined, now)).toBe(false)
    expect(missingAppsAreNew([{ createdAt: null }], 1, now)).toBe(false)
    expect(missingAppsAreNew([{}], 1, now)).toBe(false)
  })
})

describe('projectsHeaderStatus', () => {
  const fresh = [{ createdAt: hoursAgo(1) }]
  const old = [{ createdAt: hoursAgo(48) }]
  const base = { projectCount: 1, neverIngestedCount: 0, sdkMissingCount: 1 }

  it('reads Setting up in info for a just-made app, whatever not-set-up priority the server picked', () => {
    for (const topPriority of ['never_ingested', 'no_sdk_heartbeat', 'sdk_missing']) {
      expect(projectsHeaderStatus({ ...base, topPriority, sdkMissingProjects: fresh }, now)).toEqual({ label: 'SETTING UP', tone: 'info' })
    }
  })

  it('keeps the warning for an older app, and the healthy and empty states', () => {
    expect(projectsHeaderStatus({ ...base, topPriority: 'no_sdk_heartbeat', sdkMissingProjects: old }, now)).toEqual({ label: 'NO HEARTBEAT', tone: 'warn' })
    expect(projectsHeaderStatus({ ...base, topPriority: 'healthy', sdkMissingProjects: [], sdkMissingCount: 0 }, now)).toEqual({ label: 'INGESTING', tone: 'ok' })
    expect(projectsHeaderStatus({ ...base, projectCount: 0, topPriority: 'no_projects' }, now)).toEqual({ label: 'EMPTY', tone: 'brand' })
  })
})
