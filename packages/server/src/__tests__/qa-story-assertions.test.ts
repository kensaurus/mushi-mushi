/**
 * FILE: packages/server/src/__tests__/qa-story-assertions.test.ts
 * PURPOSE: An empty QA scrape must not pass a story that has text
 *          assertions, and mustNotContain must fail when that text is
 *          present (report 56ab8726-a658-4cc7-a206-6e2198a6b693).
 *
 * OVERVIEW:
 * - Unit tests for qaContentFailures.
 * - Runner tests call runFirecrawl and runDirectFetch with a mocked fetch
 *   and assert the returned status and assertion failures.
 *
 * DEPENDENCIES:
 * - vitest
 * - qa-story-assertions.ts
 * - qa-story-runner/index.ts (dynamic import after Deno.serve is stubbed)
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { qaContentFailures } from '../../supabase/functions/_shared/qa-story-assertions.ts'

function story(script: unknown, prompt: string | null = null) {
  return {
    id: 'story-1',
    project_id: 'proj-1',
    name: 'Pricing page',
    prompt,
    script: typeof script === 'string' || script === null ? script : JSON.stringify(script),
    script_lang: 'json',
    browser_provider: 'firecrawl_actions',
    schedule_cron: '0 * * * *',
    enabled: true,
    capture_video: false,
    byok_provider: null,
    target_url: 'https://example.com/pricing',
    last_run_status: null,
    consecutive_failures: 0,
    slack_failure_ts: null,
    last_notified_at: null,
  }
}

describe('qaContentFailures', () => {
  it('does not pass when the scrape is empty and the story has assertions', () => {
    const failures = qaContentFailures(story({ assertContains: ['Pricing'] }), '')
    expect(failures).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(empty scrape)' },
    ])
  })

  it('treats a whitespace-only scrape as empty', () => {
    const failures = qaContentFailures(story({ assertContains: ['Pricing'] }), ' \n\t')
    expect(failures.map((f) => f.actual)).toEqual(['(empty scrape)'])
  })

  it('fails an empty scrape that only forbids text', () => {
    const failures = qaContentFailures(story({ mustNotContain: ['NaN'] }), '')
    expect(failures).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(empty scrape)' },
    ])
  })

  it('leaves an empty scrape alone when the story has no text assertions', () => {
    expect(qaContentFailures(story(null, 'load the home page'), '')).toEqual([])
    expect(qaContentFailures(story([{ type: 'screenshot' }], 'open the app'), '')).toEqual([])
    expect(qaContentFailures(story({ assertContains: [' ', ''] }), '')).toEqual([])
  })

  it('fails mustNotContain ["NaN"] when the page shows NaN', () => {
    const failures = qaContentFailures(
      story({ mustNotContain: ['NaN'] }),
      '# Tools\n\n事業年度 NaN',
    )
    expect(failures).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(found)' },
    ])
  })

  it('forbids the text wherever it appears, including inside a longer token', () => {
    // Same case-insensitive substring as assertContains. Token boundaries
    // let "categories.economy" through inside "categories.economy_label".
    expect(qaContentFailures(
      story({ mustNotContain: ['categories.economy'] }),
      'Filter: categories.economy_label',
    )).toEqual([
      { step: 'content', expected: 'must not contain "categories.economy"', actual: '(found)' },
    ])
    expect(qaContentFailures(story({ mustNotContain: ['NaN'] }), 'total is nan')).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(found)' },
    ])
    expect(qaContentFailures(story({ mustNotContain: ['NaN'] }), 'Annual finance report')).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(found)' },
    ])
    expect(qaContentFailures(
      story({ mustNotContain: ['categories.economy'] }),
      'Filter: categoriesXeconomy and defined',
    )).toEqual([])
  })

  it('still requires assertContains as a case-insensitive substring', () => {
    const script = { assertContains: ['Pricing'], mustNotContain: ['NaN'] }
    expect(qaContentFailures(story(script), 'See the pricing plans')).toEqual([])
    expect(qaContentFailures(story(script), 'See the plans')).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(not found)' },
    ])
    expect(qaContentFailures(story(script), 'Pricing is NaN')).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(found)' },
    ])
  })

  it('keeps the required text as written, including surrounding spaces', () => {
    expect(qaContentFailures(story({ assertContains: [' Pricing '] }), 'Pricing')).toEqual([
      { step: 'content', expected: ' Pricing ', actual: '(not found)' },
    ])
    expect(qaContentFailures(story({ assertContains: [' Pricing '] }), 'See  Pricing  here')).toEqual([])
  })

  it('uses the caller label when a required phrase is missing', () => {
    const failures = qaContentFailures(
      story({ assertContains: ['Pricing'] }),
      ' Home ',
      '(not found in HTML)',
    )
    expect(failures).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(not found in HTML)' },
    ])
  })

  it('keeps prompt-required phrases when the script only forbids text', () => {
    const script = { mustNotContain: ['NaN'] }
    const prompt = 'The page must show "Pricing" and must not show "NaN"'
    expect(qaContentFailures(story(script, prompt), 'Tools for the fiscal year')).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(not found)' },
    ])
    expect(qaContentFailures(story(script, prompt), 'Pricing for the fiscal year')).toEqual([])
    expect(qaContentFailures(story(script, prompt), 'Pricing is NaN')).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(found)' },
    ])
    expect(qaContentFailures(story(script, prompt), '')).toEqual([
      {
        step: 'content',
        expected: 'Pricing; must not contain "NaN"',
        actual: '(empty scrape)',
      },
    ])
  })

  it('does not require a prompt quote that is itself forbidden', () => {
    expect(qaContentFailures(
      story({ mustNotContain: ['NaN'] }, 'The tools page must not show "NaN"'),
      'Tools for the fiscal year',
    )).toEqual([])
  })

  it('prefers assertContains over prompt quotes', () => {
    expect(qaContentFailures(
      story({ assertContains: ['Tools'] }, 'Show "Pricing"'),
      'Tools',
    )).toEqual([])
    expect(qaContentFailures(
      story({ assertContains: ['Tools'] }, 'Show "Pricing"'),
      'Pricing',
    )).toEqual([
      { step: 'content', expected: 'Tools', actual: '(not found)' },
    ])
  })

  it('still treats prompt quotes as required text when no script assertions are set', () => {
    expect(qaContentFailures(story(null, 'Check that "Pricing" is visible'), 'Home')).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(not found)' },
    ])
    expect(qaContentFailures(story(null, 'Check that "Pricing" is visible'), '')).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(empty scrape)' },
    ])
  })

  it('ignores blank and non-string assertion entries', () => {
    const failures = qaContentFailures(
      story({ assertContains: ['', ' ', 1, 'Pricing'], mustNotContain: ['', 'NaN'] }),
      'Pricing',
    )
    expect(failures).toEqual([])
  })
})

describe('qa-story-runner text assertions', () => {
  let runFirecrawl: typeof import('../../supabase/functions/qa-story-runner/index.ts').runFirecrawl
  let runDirectFetch: typeof import('../../supabase/functions/qa-story-runner/index.ts').runDirectFetch

  beforeAll(async () => {
    vi.stubGlobal('Deno', {
      env: { get: () => undefined },
      serve: () => {},
    })
    ;({ runFirecrawl, runDirectFetch } = await import('../../supabase/functions/qa-story-runner/index.ts'))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  function scrape(body: unknown, status = 200) {
    const fetchMock = vi.fn(async () => new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status, headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('fails a Firecrawl run whose markdown is empty', async () => {
    const fetchMock = scrape({
      success: true,
      data: { markdown: '', screenshot: 'data:image/png;base64,aaaa' },
    })
    const result = await runFirecrawl(
      story({ assertContains: ['Pricing'], mustNotContain: ['NaN'] }),
      'fc-key',
      'https://example.com/pricing',
    )
    expect(result.status).toBe('failed')
    expect(result.assertion_failures).toEqual([
      {
        step: 'content',
        expected: 'Pricing; must not contain "NaN"',
        actual: '(empty scrape)',
      },
    ])
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(sent.url).toContain('mushi_monitor=qa')
    expect(sent).not.toHaveProperty('assertContains')
    expect(sent).not.toHaveProperty('mustNotContain')
  })

  it('fails a Firecrawl run whose markdown contains NaN', async () => {
    scrape({ success: true, data: { markdown: 'Pricing is NaN' } })
    const result = await runFirecrawl(
      story({ assertContains: ['Pricing'], mustNotContain: ['NaN'] }),
      'fc-key',
      'https://example.com/pricing',
    )
    expect(result.status).toBe('failed')
    expect(result.assertion_failures).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(found)' },
    ])
  })

  it('keeps a prompt phrase when Firecrawl returns text and the script only forbids NaN', async () => {
    scrape({ success: true, data: { markdown: 'Tools for the fiscal year' } })
    const result = await runFirecrawl(
      story({ mustNotContain: ['NaN'] }, 'The page must show "Pricing"'),
      'fc-key',
      'https://example.com/pricing',
    )
    expect(result.status).toBe('failed')
    expect(result.assertion_failures).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(not found)' },
    ])
  })

  it('passes a Firecrawl run with no text assertions when the scrape is empty', async () => {
    scrape({ success: true, data: { markdown: '' } })
    const result = await runFirecrawl(story([{ type: 'screenshot' }], 'open the app'), 'fc-key', 'https://example.com/')
    expect(result.status).toBe('passed')
    expect(result.assertion_failures).toEqual([])
  })

  it('fails an empty htmlOnly body', async () => {
    scrape({ success: true, data: { rawHtml: '' } })
    const result = await runFirecrawl(
      story({ htmlOnly: true, assertContains: ['Pricing'] }),
      'fc-key',
      'https://example.com/pricing',
    )
    expect(result.status).toBe('failed')
    expect(result.assertion_failures).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(empty scrape)' },
    ])
  })

  it('fails a direct fetch of an empty page', async () => {
    scrape('')
    const result = await runDirectFetch(
      story({ directFetch: true, assertContains: ['Pricing'] }),
      'https://example.com/pricing',
    )
    expect(result.status).toBe('failed')
    expect(result.assertion_failures).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(empty scrape)' },
    ])
  })

  it('fails a direct fetch that shows NaN and labels a missing phrase as HTML', async () => {
    scrape('<html>Pricing is NaN</html>')
    const forbidden = await runDirectFetch(
      story({ directFetch: true, assertContains: ['Pricing'], mustNotContain: ['NaN'] }),
      'https://example.com/pricing',
    )
    expect(forbidden.status).toBe('failed')
    expect(forbidden.assertion_failures).toEqual([
      { step: 'content', expected: 'must not contain "NaN"', actual: '(found)' },
    ])

    scrape('<html>Home</html>')
    const missing = await runDirectFetch(
      story({ directFetch: true, assertContains: ['Pricing'] }),
      'https://example.com/pricing',
    )
    expect(missing.status).toBe('failed')
    expect(missing.assertion_failures).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(not found in HTML)' },
    ])
  })
})
