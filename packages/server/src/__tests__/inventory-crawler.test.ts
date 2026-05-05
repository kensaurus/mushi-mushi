/**
 * inventory-crawler — pure helper tests.
 *
 * The Deno edge function uses `fetch` directly. We mock it via vi.stubGlobal
 * and exercise both the diff logic and the concurrency runner without
 * spinning up a real HTTP server.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { crawlPage, runWithConcurrency } from '../../supabase/functions/inventory-crawler/index.ts'

describe('runWithConcurrency', () => {
  it('processes every item even with concurrency > items.length', async () => {
    const items = [1, 2, 3]
    const out = await runWithConcurrency(items, async (n) => n * 2, 8)
    expect(out).toEqual([2, 4, 6])
  })

  it('caps in-flight workers', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 10 }, (_, i) => i)
    await runWithConcurrency(
      items,
      async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 10))
        inFlight -= 1
      },
      3,
    )
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('crawlPage diff', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          `<html><body>
            <button data-testid="btn-submit">Submit</button>
            <a data-testid="lnk-streak" href="/streak">Streak</a>
            <script src="/api/practice/submit"></script>
          </body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        ),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an empty diff when discovery matches inventory', async () => {
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit', 'lnk-streak'],
      {},
    )
    expect(r.status_code).toBe(200)
    expect(r.missing_in_app).toEqual([])
    expect(r.missing_in_inventory).toEqual([])
    expect(r.api_paths).toContain('/api/practice/submit')
  })

  it('flags missing-in-app when the inventory declares an unrendered testid', async () => {
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit', 'btn-share'],
      {},
    )
    expect(r.missing_in_app).toEqual(['btn-share'])
  })

  it('flags missing-in-inventory when the page renders an undeclared testid', async () => {
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit'],
      {},
    )
    expect(r.missing_in_inventory).toContain('lnk-streak')
  })

  it('records fetch failures as a structured error rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('refused')
      }),
    )
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit'],
      {},
    )
    expect(r.error).toMatch(/refused/)
    expect(r.status_code).toBeNull()
  })
})
