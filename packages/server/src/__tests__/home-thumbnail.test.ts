/**
 * FILE: home-thumbnail.test.ts
 * PURPOSE: The Home card screenshot (_shared/home-thumbnail.ts):
 *            - one capture per app at a time: the claim is a conditional
 *              update on last_attempt_at, so a second caller inside the gap
 *              gets nothing to bill;
 *            - Firecrawl's hosted URL is downloaded at once and never stored;
 *              only png / jpeg / webp under 5 MB is kept, at one fixed path;
 *            - a failure is recorded on the row and rethrown.
 */

import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { captureThumbnail, claimCapture, THUMBNAIL_MAX_BYTES } from '../../supabase/functions/_shared/home-thumbnail.ts'

const P = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-27T12:00:00Z')

function withStorage(db: FakeDb) {
  const uploads: Array<{ path: string; size: number; contentType: string }> = []
  const removed: string[][] = []
  ;(db as unknown as { storage: unknown }).storage = {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, opts: { contentType: string }) => {
        uploads.push({ path, size: bytes.byteLength, contentType: opts.contentType })
        return { data: { path }, error: null }
      },
      remove: async (paths: string[]) => {
        removed.push(paths)
        return { data: [], error: null }
      },
    }),
  }
  return { uploads, removed }
}

function fakeFetch(image: { type: string; bytes: number }, scrape: { status?: number; screenshot?: unknown; markdown?: string; pageStatus?: number } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.startsWith('https://api.firecrawl.dev/')) {
      const status = scrape.status ?? 200
      return new Response(JSON.stringify({ data: { screenshot: 'screenshot' in scrape ? scrape.screenshot : 'https://storage.example.com/shot.png', markdown: scrape.markdown ?? '# My app\n\nWelcome.', metadata: { statusCode: scrape.pageStatus ?? 200 } } }), { status })
    }
    return new Response(new Uint8Array(image.bytes), { status: 200, headers: { 'content-type': image.type } })
  }) as unknown as typeof fetch
}

describe('claimCapture', () => {
  it('lets one caller in per gap', async () => {
    const db = makeFakeDb()
    const asDb = db as never
    expect(await claimCapture(asDb, P, NOW, 600_000)).toBe(true)
    expect(await claimCapture(asDb, P, new Date(NOW.getTime() + 60_000), 600_000)).toBe(false)
    expect(await claimCapture(asDb, P, new Date(NOW.getTime() + 11 * 60_000), 600_000)).toBe(true)
    expect(db.table('project_home_thumbnails')).toHaveLength(1)
  })
})

describe('captureThumbnail', () => {
  it('downloads the screenshot, stores one object per app and records the time', async () => {
    const db = makeFakeDb({ project_home_thumbnails: [{ project_id: P, storage_path: null, last_error: 'old' }] })
    const { uploads, removed } = withStorage(db)
    const fetchImpl = fakeFetch({ type: 'image/png', bytes: 2048 })
    const path = await captureThumbnail(db as never, P, 'https://glot.it', 'fc-own', { fetchImpl, now: () => NOW })
    expect(path).toBe(`${P}/home.png`)
    expect(uploads).toEqual([{ path: `${P}/home.png`, size: 2048, contentType: 'image/png' }])
    expect(removed[0]).toEqual([`${P}/home.jpg`, `${P}/home.webp`])
    const row = db.table('project_home_thumbnails')[0]
    expect(row).toMatchObject({ storage_path: `${P}/home.png`, page_url: 'https://glot.it', captured_at: NOW.toISOString(), last_error: null })
    // Firecrawl's hosted URL is never kept.
    expect(JSON.stringify(row)).not.toContain('storage.example.com')
    const body = JSON.parse((fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].body as string)
    expect(body.formats[0]).toMatchObject({ type: 'screenshot', fullPage: false })
  })

  it('refuses anything but png, jpeg or webp, and records why', async () => {
    const db = makeFakeDb({ project_home_thumbnails: [{ project_id: P }] })
    const { uploads } = withStorage(db)
    await expect(captureThumbnail(db as never, P, 'https://glot.it', 'k', { fetchImpl: fakeFetch({ type: 'text/html', bytes: 10 }) })).rejects.toThrow(/not png/)
    expect(uploads).toEqual([])
    expect(db.table('project_home_thumbnails')[0].last_error).toMatch(/text\/html/)
  })

  it('refuses a screenshot over 5 MB', async () => {
    const db = makeFakeDb({ project_home_thumbnails: [{ project_id: P }] })
    const { uploads } = withStorage(db)
    await expect(captureThumbnail(db as never, P, 'https://glot.it', 'k', { fetchImpl: fakeFetch({ type: 'image/png', bytes: THUMBNAIL_MAX_BYTES + 1 }) })).rejects.toThrow(/5 MB/)
    expect(uploads).toEqual([])
  })

  it('keeps the last good picture when the page is an error screen, and says why', async () => {
    const db = makeFakeDb({ project_home_thumbnails: [{ project_id: P, storage_path: `${P}/home.png`, captured_at: '2026-10-20T00:00:00Z' }] })
    const { uploads } = withStorage(db)
    const fetchImpl = fakeFetch({ type: 'image/png', bytes: 10 }, { markdown: "This page couldn't load\n\nReload to try again, or go back." })
    await expect(captureThumbnail(db as never, P, 'https://kensaur.us/mushi-mushi', 'k', { fetchImpl })).rejects.toThrow(/error .*kept/)
    expect(uploads).toEqual([])
    const row = db.table('project_home_thumbnails')[0]
    expect(row).toMatchObject({ storage_path: `${P}/home.png`, captured_at: '2026-10-20T00:00:00Z' })
    expect(row.last_error).toMatch(/couldn't load/)
    await expect(captureThumbnail(db as never, P, 'https://glot.it', 'k', { fetchImpl: fakeFetch({ type: 'image/png', bytes: 10 }, { pageStatus: 503 }) })).rejects.toThrow(/answered 503/)
  })

  it('tells an error screen from a page that only mentions errors', async () => {
    const run = (markdown: string) => {
      const db = makeFakeDb({ project_home_thumbnails: [{ project_id: P }] })
      withStorage(db)
      return captureThumbnail(db as never, P, 'https://glot.it', 'k', { fetchImpl: fakeFetch({ type: 'image/png', bytes: 10 }, { markdown }) })
    }
    await expect(run('Application error: a client-side exception has occurred')).rejects.toThrow(/Application error/)
    await expect(run('# Shop\n\nNew arrivals this week.')).resolves.toBe(`${P}/home.png`)
    // A long page that only mentions an error (an FAQ) is the app, not an error screen.
    await expect(run(`# FAQ\n\nWhat does Internal Server Error mean? ${'x'.repeat(700)}`)).resolves.toBe(`${P}/home.png`)
  })

  it('says the key was refused or out of credits, and needs an https screenshot URL', async () => {
    const db = makeFakeDb({ project_home_thumbnails: [{ project_id: P }] })
    withStorage(db)
    await expect(captureThumbnail(db as never, P, 'https://glot.it', 'k', { fetchImpl: fakeFetch({ type: 'image/png', bytes: 1 }, { status: 401 }) })).rejects.toThrow(/refused the key/)
    await expect(captureThumbnail(db as never, P, 'https://glot.it', 'k', { fetchImpl: fakeFetch({ type: 'image/png', bytes: 1 }, { status: 402 }) })).rejects.toThrow(/out of credits/)
    await expect(captureThumbnail(db as never, P, 'https://glot.it', 'k', { fetchImpl: fakeFetch({ type: 'image/png', bytes: 1 }, { screenshot: 'http://x/y.png' }) })).rejects.toThrow(/no screenshot/)
  })
})
