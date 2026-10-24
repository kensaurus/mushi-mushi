/**
 * test-gen-from-story used to ask for Firecrawl actions and then insert
 * every qa_stories row as browser_provider `local` / script_lang
 * `playwright-ts`. qa-story-runner skips local stories, so a generated
 * test never ran on the schedule.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { pagesForStory, storedQaStoryScript } from '../../supabase/functions/test-gen-from-story/story-script.ts'

const PLAYWRIGHT = "import { test, expect } from '@playwright/test'\n"
const ACTIONS = `
actions:
  - type: click
    selector: "a[href='/pricing']"
  - type: screenshot
assertContains:
  - Pricing
`
const PRICING = [{ id: 'pricing', path: '/pricing', auth_required: false as const }]

describe('storedQaStoryScript', () => {
  it('stores firecrawl actions for a guest-reachable story', () => {
    const stored = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: PRICING,
      baseUrls: ['http://localhost:3000', 'https://app.example.com'],
    })
    expect(stored.browser_provider).toBe('firecrawl_actions')
    expect(stored.script_lang).toBe('firecrawl-actions')
    expect(JSON.parse(stored.script)).toEqual({
      actions: [
        { type: 'click', selector: "a[href='/pricing']" },
        { type: 'screenshot' },
      ],
      assertContains: ['Pricing'],
    })
    expect(stored.target_url).toBe('https://app.example.com/pricing')
    expect(stored.script).not.toContain('@playwright/test')
  })

  it('accepts JSON and a fenced actions list, the shapes the runner JSON.parses', () => {
    const json = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: JSON.stringify({ actions: [{ type: 'screenshot' }], assertContains: ['Welcome'] }),
      pages: PRICING,
      baseUrls: ['https://app.example.com'],
    })
    expect(json.browser_provider).toBe('firecrawl_actions')
    expect(JSON.parse(json.script)).toEqual({
      actions: [{ type: 'screenshot' }],
      assertContains: ['Welcome'],
    })

    const fenced = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: '```yaml\n- type: screenshot\n```',
      pages: [],
      baseUrls: ['https://app.example.com/docs'],
    })
    expect(fenced.script_lang).toBe('firecrawl-actions')
    expect(JSON.parse(fenced.script)).toEqual({ actions: [{ type: 'screenshot' }] })
    expect(fenced.target_url).toBe('https://app.example.com/docs')
  })

  it('keeps a content check that does not need clicks', () => {
    const stored = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: 'htmlOnly: true\nassertContains:\n  - Pricing\n',
      pages: [{ id: 'pricing', path: '/pricing' }],
      baseUrls: ['https://app.example.com'],
    })
    expect(stored.browser_provider).toBe('firecrawl_actions')
    expect(JSON.parse(stored.script)).toEqual({ htmlOnly: true, assertContains: ['Pricing'] })
  })

  it('keeps the Playwright spec when a page requires sign-in', () => {
    const stored = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: [
        { id: 'pricing', path: '/pricing', auth_required: false },
        { id: 'account', path: '/account', auth_required: true },
      ],
      baseUrls: ['https://app.example.com'],
    })
    expect(stored).toEqual({
      script: PLAYWRIGHT,
      script_lang: 'playwright-ts',
      browser_provider: 'local',
      target_url: null,
    })
  })

  it('keeps the Playwright spec when the actions are not executable', () => {
    for (const firecrawlActions of ['click the pricing link', '', 'actions:\n  - type: click\n', undefined]) {
      const stored = storedQaStoryScript({
        playwright: PLAYWRIGHT,
        firecrawlActions,
        pages: PRICING,
        baseUrls: ['https://app.example.com'],
      })
      expect(stored.browser_provider).toBe('local')
      expect(stored.script_lang).toBe('playwright-ts')
      expect(stored.script).toBe(PLAYWRIGHT)
    }
  })

  it('does not point Firecrawl at a machine the cloud cannot reach', () => {
    const stored = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: PRICING,
      baseUrls: ['http://localhost:3000', 'http://10.0.0.5', 'https://192.168.1.20'],
    })
    expect(stored.browser_provider).toBe('firecrawl_actions')
    expect(stored.target_url).toBeNull()
  })
})

describe('pagesForStory', () => {
  const pages = [
    { id: 'pricing', path: '/pricing', auth_required: false },
    { id: 'account', path: '/account', auth_required: true, user_story: 'billing' },
  ]

  it('uses the story page ids, then a user_story tag', () => {
    expect(pagesForStory({ id: 'see-pricing', pages: ['pricing'] }, pages).map((p) => p.id)).toEqual(['pricing'])
    expect(pagesForStory({ id: 'billing', pages: [] }, pages).map((p) => p.id)).toEqual(['account'])
  })
})

describe('test-gen-from-story insert', () => {
  it('persists the helper result and still commits the Playwright spec', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/test-gen-from-story/index.ts'),
      'utf8',
    )
    expect(src).toMatch(/storedQaStoryScript\(/)
    expect(src).toMatch(/script_lang: stored\.script_lang/)
    expect(src).toMatch(/browser_provider: stored\.browser_provider/)
    expect(src).not.toMatch(/browser_provider:\s*'local'/)
    expect(src).toMatch(/contents: output\.contents/)
  })
})
