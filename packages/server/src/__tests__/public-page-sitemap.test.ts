/**
 * The `/r/` sitemap (gap #27): `mushi-mushi/r/sitemap.xml` is regenerated
 * from the published pages on publish, unpublish and project delete, so
 * search engines can find pages published after the docs build. The S3
 * client is the injected fetch; the DB is a small fake that pages like
 * PostgREST.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  loadSitemapEntries,
  regeneratePublicSitemap,
  renderPublicSitemap,
  SITEMAP_KEY,
  writePublicSitemap,
} from '../../supabase/functions/_shared/public-page-store.ts'

const cfg = { bucket: 'kensaur.us-mushi-mushi', region: 'ap-northeast-1', accessKey: 'AKTEST', secretKey: 'secret' }

interface DiagramRow {
  project_id: string
  payload: { owner?: string; repo?: string } | null
  static_page_at: string | null
}

/** Fake of the one query loadSitemapEntries runs: select → not(is null) → order → range. */
function fakeDb(rows: DiagramRow[], opts: { error?: string } = {}) {
  const ranges: Array<[number, number]> = []
  const db = {
    from(table: string) {
      expect(table).toBe('public_repo_diagrams')
      const q = {
        select: () => q,
        not: (col: string, op: string, value: null) => {
          expect([col, op, value]).toEqual(['static_page_at', 'is', null])
          return q
        },
        order: () => q,
        range: async (from: number, to: number) => {
          ranges.push([from, to])
          if (opts.error) return { data: null, error: { message: opts.error } }
          const live = rows
            .filter((r) => r.static_page_at !== null)
            .sort((a, b) => a.project_id.localeCompare(b.project_id))
          return { data: live.slice(from, to + 1), error: null }
        },
      }
      return q
    },
  }
  return { db: db as never, ranges }
}

function s3() {
  const calls: Array<{ url: string; method: string; body: string; headers: Record<string, string> }> = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? new TextDecoder().decode(init.body as Uint8Array) : '',
      headers: init?.headers as Record<string, string>,
    })
    return new Response(null, { status: 200 })
  })
  return { calls, fetchImpl }
}

describe('renderPublicSitemap', () => {
  it('lists each page at its canonical URL with lastmod, sorted, escaped', () => {
    const xml = renderPublicSitemap([
      { owner: 'Zeta', repo: 'app', lastmod: '2026-10-02T09:00:00Z' },
      { owner: 'Acme', repo: 'Shop.js', lastmod: null },
      { owner: 'a&b', repo: 'r<1>', lastmod: 'not a date' },
    ])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true)
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual([
      'https://kensaur.us/mushi-mushi/r/a&amp;b/r&lt;1&gt;',
      'https://kensaur.us/mushi-mushi/r/Acme/Shop.js',
      'https://kensaur.us/mushi-mushi/r/Zeta/app',
    ])
    expect(xml).toContain('<lastmod>2026-10-02T09:00:00.000Z</lastmod>')
    expect((xml.match(/<lastmod>/g) ?? []).length).toBe(1)
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
  })

  it('renders an empty but valid urlset when nothing is published', () => {
    expect(renderPublicSitemap([])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n',
    )
  })
})

describe('loadSitemapEntries', () => {
  it('keeps only rows whose static file exists and pages past 1000 rows', async () => {
    const rows: DiagramRow[] = Array.from({ length: 1001 }, (_, i) => ({
      project_id: `p${String(i).padStart(5, '0')}`,
      payload: { owner: 'org', repo: `repo-${i}` },
      static_page_at: '2026-10-01T00:00:00Z',
    }))
    rows.push({ project_id: 'z-unwritten', payload: { owner: 'org', repo: 'unwritten' }, static_page_at: null })
    rows.push({ project_id: 'z-bad', payload: null, static_page_at: '2026-10-01T00:00:00Z' })
    const { db, ranges } = fakeDb(rows)
    const entries = await loadSitemapEntries(db)
    expect(entries).toHaveLength(1001)
    expect(entries.some((e) => e.repo === 'unwritten')).toBe(false)
    expect(ranges).toEqual([[0, 999], [1000, 1999]])
  })

  it('throws on a read error instead of returning a partial list', async () => {
    const { db } = fakeDb([], { error: 'boom' })
    await expect(loadSitemapEntries(db)).rejects.toThrow(/boom/)
  })
})

describe('writing the sitemap to S3', () => {
  it('does nothing while the store is not configured', async () => {
    const { fetchImpl } = s3()
    expect(await writePublicSitemap(null, [], fetchImpl)).toBe('not_configured')
    const { db } = fakeDb([])
    expect(await regeneratePublicSitemap(db, null, vi.fn(), fetchImpl)).toBe('not_configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('PUTs the regenerated XML at the sitemap key, signed', async () => {
    const { calls, fetchImpl } = s3()
    const { db } = fakeDb([
      { project_id: 'p1', payload: { owner: 'Acme', repo: 'Shop' }, static_page_at: '2026-10-02T00:00:00Z' },
      { project_id: 'p2', payload: { owner: 'acme', repo: 'draft' }, static_page_at: null },
    ])
    expect(await regeneratePublicSitemap(db, cfg, vi.fn(), fetchImpl)).toBe('written')
    expect(SITEMAP_KEY).toBe('mushi-mushi/r/sitemap.xml')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe('https://s3.ap-northeast-1.amazonaws.com/kensaur.us-mushi-mushi/mushi-mushi/r/sitemap.xml')
    expect(calls[0].headers['Content-Type']).toBe('application/xml; charset=utf-8')
    expect(calls[0].headers.Authorization ?? calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /)
    expect(calls[0].body).toContain('<loc>https://kensaur.us/mushi-mushi/r/Acme/Shop</loc>')
    expect(calls[0].body).not.toContain('draft')
  })

  it('after the last unpublish it writes an empty sitemap, not a stale one', async () => {
    const { calls, fetchImpl } = s3()
    const { db } = fakeDb([])
    expect(await regeneratePublicSitemap(db, cfg, vi.fn(), fetchImpl)).toBe('written')
    expect(calls[0].body).not.toContain('<url>')
  })

  it('never throws: a DB or S3 failure is reported and returns failed', async () => {
    const onError = vi.fn()
    const { db: broken } = fakeDb([], { error: 'db down' })
    const { fetchImpl } = s3()
    expect(await regeneratePublicSitemap(broken, cfg, onError, fetchImpl)).toBe('failed')
    expect(fetchImpl).not.toHaveBeenCalled()
    const denied = vi.fn(async () => new Response('denied', { status: 403 }))
    const { db } = fakeDb([])
    expect(await regeneratePublicSitemap(db, cfg, onError, denied)).toBe('failed')
    expect(onError).toHaveBeenCalledTimes(2)
  })
})

describe('call sites', () => {
  const FN = resolve(__dirname, '../../supabase/functions/api/routes')
  const diagram = readFileSync(resolve(FN, 'repo-diagram.ts'), 'utf8')
  const projects = readFileSync(resolve(FN, 'projects-crud.ts'), 'utf8')
  const after = (src: string, start: string, first: string, then: string) => {
    const body = src.slice(src.indexOf(start))
    const a = body.indexOf(first)
    const b = body.indexOf(then)
    expect(a, first).toBeGreaterThan(-1)
    expect(b, then).toBeGreaterThan(a)
  }

  it('publish regenerates after the static_page_at mark', () => {
    after(diagram, "app.post('/v1/admin/projects/:id/codebase/diagram/publish'", 'static_page_at: new Date().toISOString()', 'regeneratePublicSitemap(')
  })
  it('unpublish regenerates after the row delete', () => {
    after(diagram, "app.delete('/v1/admin/projects/:id/codebase/diagram/publish'", ".from('public_repo_diagrams').delete()", 'regeneratePublicSitemap(')
  })
  it('project delete regenerates after the cascade', () => {
    after(projects, 'removeProjectPublicPage(', ".from('projects').delete()", 'regeneratePublicSitemap(')
  })
})
