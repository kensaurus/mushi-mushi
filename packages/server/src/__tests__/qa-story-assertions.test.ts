/**
 * FILE: packages/server/src/__tests__/qa-story-assertions.test.ts
 * PURPOSE: An empty Firecrawl scrape must not pass a story that has text
 *          assertions, and mustNotContain ["NaN"] must fail a page that
 *          shows NaN (report 56ab8726-a658-4cc7-a206-6e2198a6b693).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { qaContentFailures } from '../../supabase/functions/_shared/qa-story-assertions.ts'

function story(script: unknown, prompt: string | null = null) {
  return {
    script: typeof script === 'string' || script === null ? script : JSON.stringify(script),
    prompt,
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

  it('matches NaN regardless of case and not as letters inside another word', () => {
    const script = { mustNotContain: ['NaN'] }
    expect(qaContentFailures(story(script), 'total is nan').length).toBe(1)
    expect(qaContentFailures(story(script), 'Annual finance report for the tenant')).toEqual([])
    expect(qaContentFailures(story(script), 'NaNcy opened the report')).toEqual([])
  })

  it('fails when a raw translation key is on the page', () => {
    const script = { mustNotContain: ['categories.economy', 'undefined'] }
    const failures = qaContentFailures(
      story(script),
      'Filter: categories.economy\nThe total is undefined.',
    )
    expect(failures.map((f) => f.expected)).toEqual([
      'must not contain "categories.economy"',
      'must not contain "undefined"',
    ])
    expect(qaContentFailures(story(script), 'Filter: categoriesXeconomy and defined')).toEqual([])
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

  it('uses the caller label when a required phrase is missing', () => {
    const failures = qaContentFailures(
      story({ assertContains: ['Pricing'] }),
      '<html><body>Home</body></html>',
      '(not found in HTML)',
    )
    expect(failures).toEqual([
      { step: 'content', expected: 'Pricing', actual: '(not found in HTML)' },
    ])
  })

  it('does not turn mustNotContain quotes in the prompt into required text', () => {
    const page = 'Tools for the fiscal year'
    const failures = qaContentFailures(
      story({ mustNotContain: ['NaN'] }, 'The tools page must not show "NaN"'),
      page,
    )
    expect(failures).toEqual([])
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
      story({ assertContains: ['', '  ', 1, 'Pricing'], mustNotContain: ['', 'NaN'] }),
      'Pricing',
    )
    expect(failures).toEqual([])
  })
})

describe('qa-story-runner wiring', () => {
  const src = readFileSync(
    resolve(__dirname, '../../supabase/functions/qa-story-runner/index.ts'),
    'utf8',
  )

  it('scores Firecrawl and directFetch through qaContentFailures', () => {
    expect(src).toContain("import { qaContentFailures } from '../_shared/qa-story-assertions.ts'")
    expect(src).toContain('qaContentFailures(story, markdown)')
    expect(src).toContain("qaContentFailures(story, html, '(not found in HTML)')")
    expect(src).not.toContain('if (markdown && termsToCheck')
    expect(src).toContain('const passed = assertionFailures.length === 0')
    expect(src).toContain("status: passed ? 'passed' : 'failed'")
  })
})
