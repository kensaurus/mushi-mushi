/**
 * FILE: packages/server/src/__tests__/public-diagram-page.test.ts
 * PURPOSE: The crawlable public diagram page and its `.md` twin (Plan 020
 *          §10.3.3): they carry exactly the published payload, escape every
 *          string, point canonical at kensaur.us, embed SoftwareSourceCode
 *          JSON-LD, and are written / deleted in S3 under lowercase keys with
 *          a short cache lifetime. Off when the store is not configured.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  diagramBadgeMarkdown,
  escapeHtml,
  livePublicUrl,
  publicPageDescription,
  publicPageKeys,
  renderPublicDiagramHtml,
  renderPublicDiagramMarkdown,
} from '../../supabase/functions/_shared/public-diagram-page.ts'
import {
  deletePublicPage,
  readPublicPageStoreConfig,
  removeProjectPublicPage,
  writePublicPage,
  PAGE_MAX_AGE_SECONDS,
} from '../../supabase/functions/_shared/public-page-store.ts'
import type { PublicDiagramPayload } from '../../supabase/functions/_shared/repo-diagram.ts'

const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const PAYLOAD: PublicDiagramPayload = {
  owner: 'Acme',
  repo: 'Shop.js',
  sha: SHA,
  generated_at: '2026-10-02T09:00:00Z',
  groups: [
    { id: 'web', label: 'Web app', x: 0, y: 0, w: 252, h: 200 },
    { id: 'data', label: 'Data', x: 324, y: 0, w: 252, h: 120 },
  ],
  nodes: [
    { id: 'ui', label: 'Checkout <UI>', group: 'web', path: 'apps/web/src/checkout', description: 'Shows the cart & "pay" button', x: 16, y: 52 },
    { id: 'db', label: 'Postgres', group: 'data', path: null, description: '', x: 340, y: 52 },
  ],
  edges: [{ from: 'ui', to: 'db', label: 'reads' }],
}

describe('renderPublicDiagramHtml', () => {
  const html = renderPublicDiagramHtml(PAYLOAD)

  it('escapes every published string', () => {
    expect(html).toContain('Checkout &lt;UI&gt;')
    expect(html).toContain('Shows the cart &amp; &quot;pay&quot; button')
    expect(html).not.toContain('<UI>')
  })

  it('is indexable with a kensaur.us canonical and a Markdown alternate', () => {
    expect(html).toContain('<link rel="canonical" href="https://kensaur.us/mushi-mushi/r/Acme/Shop.js">')
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="https://kensaur.us/mushi-mushi/r/Acme/Shop.js.md">')
    expect(html).toContain('<meta name="robots" content="index,follow">')
    expect(html).toContain(`<title>Acme/Shop.js architecture diagram · Mushi</title>`)
  })

  it('embeds SoftwareSourceCode JSON-LD that cannot close its script early', () => {
    const m = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)
    expect(m).not.toBeNull()
    const ld = JSON.parse(m![1])
    expect(ld['@type']).toBe('SoftwareSourceCode')
    expect(ld.codeRepository).toBe('https://github.com/Acme/Shop.js')
    expect(ld.version).toBe(SHA)
    expect(ld.hasPart.map((p: { name: string }) => p.name)).toEqual(['Checkout <UI>', 'Postgres'])
    expect(m![1]).not.toContain('<UI>')
  })

  it('lists the parts as text, links each path at the commit, and needs no script', () => {
    expect(html).toContain(`https://github.com/Acme/Shop.js/tree/${SHA}/apps/web/src/checkout`)
    expect(html).toContain('<h2>Parts</h2>')
    expect(html).toContain('Postgres')
    expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/)
  })

  it('reports privately: a mailto, never a public issue', () => {
    expect(html).toContain('mailto:kensaurus@gmail.com?subject=')
    expect(html).not.toContain('issues/new')
  })

  it('describes the page in one sentence under 160 characters', () => {
    const d = publicPageDescription(PAYLOAD)
    expect(d).toBe('Architecture of Acme/Shop.js: 2 parts in 2 groups (Web app, Data). Drawn by AI from commit abcdef1.')
    expect(d.length).toBeLessThanOrEqual(160)
  })
})

describe('renderPublicDiagramMarkdown', () => {
  it('carries the same parts, paths and connections, with table cells escaped', () => {
    const md = renderPublicDiagramMarkdown({
      ...PAYLOAD,
      nodes: [{ ...PAYLOAD.nodes[0], description: 'a | b' }, PAYLOAD.nodes[1]],
    })
    expect(md).toContain('# Acme/Shop.js: architecture')
    expect(md).toContain(`commit \`${SHA}\``)
    expect(md).toContain(`[\`apps/web/src/checkout\`](https://github.com/Acme/Shop.js/tree/${SHA}/apps/web/src/checkout)`)
    expect(md).toContain('a \\| b')
    expect(md).toContain('- Checkout \\<UI\\> → Postgres (reads)')
  })

  it('keeps newlines in a path or label from breaking the table', () => {
    const md = renderPublicDiagramMarkdown({
      ...PAYLOAD,
      nodes: [{ ...PAYLOAD.nodes[0], label: 'Check\nout', path: 'apps/a\nb', description: 'line one\nline two' }],
    })
    const row = md.split('\n').find((l) => l.startsWith('| Check'))!
    expect(row).toContain('Check out')
    expect(row).toContain('apps/a b')
    expect(row).toContain('line one line two')
  })

  it('keeps a | in a path from splitting the table row', () => {
    const md = renderPublicDiagramMarkdown({ ...PAYLOAD, nodes: [{ ...PAYLOAD.nodes[0], path: 'apps/a|b' }] })
    const row = md.split('\n').find((l) => l.startsWith('| Checkout'))!
    expect(row).toContain('apps/a\\|b')
    // Four cells: five pipes once the escaped one is removed.
    expect(row.replace(/\\\|/g, '').split('|')).toHaveLength(6)
  })
})

describe('keys and badge', () => {
  it('stores pages under lowercase keys the router can find', () => {
    expect(publicPageKeys('Acme', 'Shop.js')).toEqual({ html: 'mushi-mushi/r/acme/shop.js.html', markdown: 'mushi-mushi/r/acme/shop.js.md' })
  })
  it('gives a README badge that links to the page', () => {
    expect(diagramBadgeMarkdown('Acme', 'Shop.js')).toBe(
      '[![Architecture diagram](https://img.shields.io/badge/architecture-diagram-c2410c)](https://kensaur.us/mushi-mushi/r/Acme/Shop.js)',
    )
  })
  it('sends people to the interactive view until the static page exists', () => {
    // Without the file, /r/<owner>/<repo> would be an S3 NoSuchKey page.
    expect(livePublicUrl('Acme', 'Shop.js', false)).toBe('https://kensaur.us/mushi-mushi/docs/r?repo=Acme%2FShop.js')
    expect(livePublicUrl('Acme', 'Shop.js', true)).toBe('https://kensaur.us/mushi-mushi/r/Acme/Shop.js')
    expect(diagramBadgeMarkdown('Acme', 'Shop.js', false)).toContain('(https://kensaur.us/mushi-mushi/docs/r?repo=Acme%2FShop.js)')
  })
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('public page store', () => {
  const cfg = { bucket: 'kensaur.us-mushi-mushi', region: 'us-east-1', accessKey: 'AKIDEXAMPLE', secretKey: 'test-secret' }

  it('is off until all four settings exist', () => {
    const env: Record<string, string> = {
      MUSHI_PUBLIC_PAGES_BUCKET: 'b',
      MUSHI_PUBLIC_PAGES_REGION: 'r',
      MUSHI_PUBLIC_PAGES_ACCESS_KEY_ID: 'k',
    }
    expect(readPublicPageStoreConfig((n) => env[n])).toBeNull()
    env.MUSHI_PUBLIC_PAGES_SECRET_ACCESS_KEY = 's'
    expect(readPublicPageStoreConfig((n) => env[n])).toEqual({ bucket: 'b', region: 'r', accessKey: 'k', secretKey: 's' })
  })

  it('does nothing when not configured', async () => {
    const fetchImpl = vi.fn()
    expect(await writePublicPage(null, PAYLOAD, fetchImpl)).toBe('not_configured')
    expect(await deletePublicPage(null, 'Acme', 'Shop.js', fetchImpl)).toBe('not_configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('writes the twin then the page, path-style, signed, with a short cache lifetime', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init! })
      return new Response(null, { status: 200 })
    })
    expect(await writePublicPage(cfg, PAYLOAD, fetchImpl)).toBe('written')
    expect(calls.map((c) => c.url)).toEqual([
      'https://s3.us-east-1.amazonaws.com/kensaur.us-mushi-mushi/mushi-mushi/r/acme/shop.js.md',
      'https://s3.us-east-1.amazonaws.com/kensaur.us-mushi-mushi/mushi-mushi/r/acme/shop.js.html',
    ])
    const headers = calls[1].init.headers as Record<string, string>
    expect(calls[1].init.method).toBe('PUT')
    expect(headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(headers['Cache-Control']).toBe(`public, max-age=${PAGE_MAX_AGE_SECONDS}`)
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request/)
  })

  it('fails loudly when S3 refuses a write', async () => {
    const fetchImpl = vi.fn(async () => new Response('denied', { status: 403 }))
    await expect(writePublicPage(cfg, PAYLOAD, fetchImpl)).rejects.toThrow(/S3 PUT .* 403/)
  })

  it('removes a deleted project\'s page from S3 and never throws', async () => {
    const db = (row: unknown) => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
    })
    const urls: string[] = []
    const ok = vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(null, { status: 204 })
    })
    const onError = vi.fn()
    expect(await removeProjectPublicPage(db({ payload: { owner: 'Acme', repo: 'Shop.js' }, static_page_at: null }), 'p1', cfg, onError, ok)).toBe('deleted')
    expect(urls).toHaveLength(2)
    expect(await removeProjectPublicPage(db(null), 'p1', cfg, onError, ok)).toBe('none')
    const unreadable = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }) }
    // Not knowing whether a page exists must stop the project delete, not count as "no page".
    expect(await removeProjectPublicPage(unreadable, 'p1', cfg, onError, ok)).toBe('failed')
    expect(onError).toHaveBeenCalledTimes(1)
    onError.mockClear()
    const broken = vi.fn(async () => new Response('denied', { status: 403 }))
    expect(await removeProjectPublicPage(db({ payload: { owner: 'Acme', repo: 'Shop.js' } }), 'p1', cfg, onError, broken)).toBe('failed')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('deletes the page before its twin and treats a missing key as gone', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method} ${url}`)
      return new Response(null, { status: urls.length === 1 ? 204 : 404 })
    })
    expect(await deletePublicPage(cfg, 'Acme', 'Shop.js', fetchImpl)).toBe('deleted')
    expect(urls).toEqual([
      'DELETE https://s3.us-east-1.amazonaws.com/kensaur.us-mushi-mushi/mushi-mushi/r/acme/shop.js.html',
      'DELETE https://s3.us-east-1.amazonaws.com/kensaur.us-mushi-mushi/mushi-mushi/r/acme/shop.js.md',
    ])
  })
})
