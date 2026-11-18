/**
 * FILE: packages/server/src/__tests__/app-icon.test.ts
 * PURPOSE: Each app's own icon for Portfolio cards and the switcher
 *          (_shared/app-icon.ts, owner 2026-10-14): store ids come from the
 *          connector snapshots, the App Store icon wins over Play, only store
 *          hosts are trusted, an outage is never stored as "no icon", and the
 *          portfolio read refreshes stale icons without blocking the page.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

import {
  ICON_FORCE_MIN_MS,
  ICON_REFRESH_MS,
  iconsDue,
  isStoreIconUrl,
  refreshAppIcons,
  resolveStoreIcon,
  storeIdsFromSnapshots,
} from '../../supabase/functions/_shared/app-icon.ts'

const ITUNES = (icon: string) => JSON.stringify({ results: [{ trackName: 'glot.it', sellerName: 'K', artworkUrl512: icon }] })
const PLAY = (icon: string) =>
  `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'SoftwareApplication', name: 'glot.it', image: icon })}</script></html>`
const res = (status: number, text = '') => ({ status, text, headers: new Headers(), finalUrl: '' })

const APPLE_ICON = 'https://is1-ssl.mzstatic.com/image/thumb/Purple/AppIcon/512x512bb.jpg'
const PLAY_ICON = 'https://play-lh.googleusercontent.com/abc=w480'

describe('storeIdsFromSnapshots', () => {
  it('reads App Store ids and Play packages from the connector snapshots', () => {
    expect(
      storeIdsFromSnapshots([
        { kind: 'app_store_connect', snapshot: { facts: { apps: [{ appleId: '6761582648' }, { appleId: 'not-a-number' }] } } },
        { kind: 'play_console', snapshot: { facts: { apps: [{ package: 'com.glotit.app' }] } } },
        { kind: 'github', snapshot: { facts: { apps: [{ appleId: '1234567' }] } } },
      ]),
    ).toEqual({ appleIds: ['6761582648'], packages: ['com.glotit.app'] })
  })
})

describe('resolveStoreIcon', () => {
  it('prefers the App Store icon', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('itunes') ? res(200, ITUNES(APPLE_ICON)) : res(200, PLAY(PLAY_ICON))))
    await expect(resolveStoreIcon({ appleIds: ['1'], packages: ['p.q'] }, fetcher)).resolves.toEqual({
      icon: { url: APPLE_ICON, source: 'app_store' },
      complete: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('asks a storefront first: the bare lookup is a stale cache (lets-talk 1.3.2 vs 1.4.0, 2026-11-18)', async () => {
    const urls: string[] = []
    const fetcher = async (url: string) => {
      urls.push(url)
      return url.includes('country=') ? res(200, ITUNES(APPLE_ICON)) : res(200, ITUNES('https://is1-ssl.mzstatic.com/old.png'))
    }
    await expect(resolveStoreIcon({ appleIds: ['6799392790'], packages: [] }, fetcher)).resolves.toEqual({ icon: { url: APPLE_ICON, source: 'app_store' }, complete: true })
    expect(urls).toEqual(['https://itunes.apple.com/lookup?id=6799392790&country=us'])
  })

  it('tries jp, then the bare lookup, for an app the us storefront does not sell', async () => {
    const urls: string[] = []
    const fetcher = async (url: string) => {
      urls.push(url)
      return url.endsWith('country=us') || url.endsWith('country=jp') ? res(200, '{"resultCount":0,"results":[]}') : res(200, ITUNES(APPLE_ICON))
    }
    await expect(resolveStoreIcon({ appleIds: ['1'], packages: [] }, fetcher)).resolves.toMatchObject({ icon: { url: APPLE_ICON } })
    expect(urls).toEqual(['https://itunes.apple.com/lookup?id=1&country=us', 'https://itunes.apple.com/lookup?id=1&country=jp', 'https://itunes.apple.com/lookup?id=1'])
  })

  it('falls back to the Play icon, and never trusts a non-store host', async () => {
    const fetcher = async (url: string) => (url.includes('itunes') ? res(200, ITUNES('https://evil.example/x.png')) : res(200, PLAY(PLAY_ICON)))
    await expect(resolveStoreIcon({ appleIds: ['1'], packages: ['p.q'] }, fetcher)).resolves.toEqual({
      icon: { url: PLAY_ICON, source: 'google_play' },
      complete: true,
    })
    expect(isStoreIconUrl('http://is1-ssl.mzstatic.com/a.png')).toBe(false)
  })

  it('marks a store outage incomplete, so "no icon" is not stored', async () => {
    await expect(resolveStoreIcon({ appleIds: ['1'], packages: [] }, async () => res(503))).resolves.toEqual({ icon: null, complete: false })
    await expect(
      resolveStoreIcon({ appleIds: ['1'], packages: [] }, async () => {
        throw new Error('timeout')
      }),
    ).resolves.toEqual({ icon: null, complete: false })
    await expect(resolveStoreIcon({ appleIds: [], packages: [] }, async () => res(200))).resolves.toEqual({ icon: null, complete: true })
  })
})

describe('iconsDue', () => {
  const now = new Date('2026-10-14T00:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it('picks never-checked and day-old icons only', () => {
    // A day, not a week (owner, 2026-11-17): a new store icon shows by the next day.
    expect(ICON_REFRESH_MS).toBe(86_400_000)
    expect(iconsDue([{ id: 'a', icon_checked_at: null }, { id: 'b', icon_checked_at: ago(ICON_REFRESH_MS + 1000) }, { id: 'c', icon_checked_at: ago(2 * 3600_000) }], now)).toEqual(['a', 'b'])
  })

  it('a forced refresh re-checks icons over ten minutes old, never one checked just now', () => {
    const rows = [
      { id: 'two-hours', icon_checked_at: ago(2 * 3600_000) },
      { id: 'one-minute', icon_checked_at: ago(60_000) },
      { id: 'never', icon_checked_at: null },
    ]
    expect(ICON_FORCE_MIN_MS).toBe(10 * 60_000)
    expect(iconsDue(rows, now, { force: true })).toEqual(['two-hours', 'never'])
    expect(iconsDue(rows, now)).toEqual(['never'])
  })
})

describe('refreshAppIcons', () => {
  function fakeDb(snapshots: Array<{ project_id: string; kind: string; snapshot: unknown }>) {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
    const db = {
      from(table: string) {
        if (table === 'connector_snapshots') {
          const q = { select: () => q, in: () => q, eq: () => q, then: (r: (v: unknown) => void) => r({ data: snapshots, error: null }) }
          return q
        }
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              updates.push({ id, patch })
              return { error: null }
            },
          }),
        }
      },
    }
    return { db, updates }
  }

  it('stores the icon, stamps a project with no store as checked, and skips one whose store was down', async () => {
    const { db, updates } = fakeDb([
      { project_id: 'p1', kind: 'app_store_connect', snapshot: { facts: { apps: [{ appleId: '111111' }] } } },
      { project_id: 'p3', kind: 'app_store_connect', snapshot: { facts: { apps: [{ appleId: '333333' }] } } },
    ])
    const fetcher = async (url: string) => (url.includes('111111') ? res(200, ITUNES(APPLE_ICON)) : res(503))
    const now = new Date('2026-10-14T00:00:00Z')
    const saved = await refreshAppIcons(db as never, ['p1', 'p2', 'p3'], fetcher, now)
    // What was stored, so a forced refresh can show it at once; p3 kept its old value.
    expect([...saved]).toEqual([['p1', APPLE_ICON], ['p2', null]])
    expect(updates).toEqual([
      { id: 'p1', patch: { icon_url: APPLE_ICON, icon_source: 'app_store', icon_checked_at: now.toISOString() } },
      { id: 'p2', patch: { icon_url: null, icon_source: null, icon_checked_at: now.toISOString() } },
    ])
  })
})
