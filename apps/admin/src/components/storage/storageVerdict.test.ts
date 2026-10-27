/**
 * One storage verdict for the open app: an app on the built-in storage has
 * nothing to check (it no longer reads "not checked yet" beside a team-wide
 * "1 failing"), and other apps' failing buckets are their own clause.
 */

import { describe, expect, it } from 'vitest'
import { storageVerdict } from './storageVerdict'
import { EMPTY_STORAGE_STATS, type StorageStats } from './types'

const stats = (over: Partial<StorageStats>): StorageStats => ({ ...EMPTY_STORAGE_STATS, projectId: 'p1', projectName: 'yen-yen', ...over })

describe('storageVerdict', () => {
  it('says the built-in storage needs no check, and names other apps failing separately', () => {
    const v = storageVerdict(stats({ activeProjectConfigured: false, activeProjectHealthStatus: 'unknown', configuredCount: 1, failingCount: 1 }))
    expect(v).toMatchObject({ tone: 'ok', chip: 'Built-in storage', action: 'configure' })
    expect(v.sentence).toBe("yen-yen stores screenshots in Mushi's built-in storage. There's nothing to check. 1 other app's own bucket is failing.")
    expect(v.sentence).not.toMatch(/not checked/)
  })

  it("does not count this app's own failing bucket as another app's", () => {
    const v = storageVerdict(stats({ activeProjectConfigured: true, activeProjectProvider: 's3', activeProjectHealthStatus: 'failing', failingCount: 1 }))
    expect(v).toMatchObject({ tone: 'danger', chip: 'Failing', action: 'reprobe' })
    expect(v.sentence).not.toMatch(/other app/)
  })

  it('asks for a first check only on a saved bucket nobody has checked', () => {
    expect(storageVerdict(stats({ activeProjectConfigured: true, activeProjectProvider: 'r2', activeProjectHealthStatus: 'unknown' }))).toMatchObject({
      chip: 'Not checked yet',
      action: 'probe',
    })
    expect(storageVerdict(stats({ activeProjectConfigured: true, activeProjectHealthStatus: 'healthy' }))).toMatchObject({ tone: 'ok', chip: 'Working', action: null })
    expect(storageVerdict(stats({ projectId: null }))).toMatchObject({ chip: 'No app picked', action: null })
  })
})
