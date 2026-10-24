/**
 * test-gen-from-story used to ask for Firecrawl actions and then insert
 * every qa_stories row as browser_provider `local` / script_lang
 * `playwright-ts`. qa-story-runner skips local stories, so a generated
 * test never ran on the schedule.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { usableFirecrawlScript } from '../../supabase/functions/test-gen-from-story/firecrawl-script.ts'
import { pagesForStory, qaStoryInsertRow, storedQaStoryScript } from '../../supabase/functions/test-gen-from-story/story-script.ts'

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

  it('keeps the Playwright spec when no public URL is known', () => {
    for (const baseUrls of [undefined, [], ['http://localhost:3000', 'http://10.0.0.5', 'https://192.168.1.20']]) {
      const stored = storedQaStoryScript({
        playwright: PLAYWRIGHT,
        firecrawlActions: ACTIONS,
        pages: PRICING,
        baseUrls,
      })
      expect(stored).toEqual({
        script: PLAYWRIGHT,
        script_lang: 'playwright-ts',
        browser_provider: 'local',
        target_url: null,
      })
    }
  })

  it('keeps the Playwright spec when no page is linked and the persona is signed in', () => {
    for (const persona of [
      'admin',
      'Administrator',
      'signed-in user',
      'logged in member',
      'authenticated',
      'subscriber',
      'registered user',
      'account holder',
      'member',
    ]) {
      const stored = storedQaStoryScript({
        playwright: PLAYWRIGHT,
        firecrawlActions: ACTIONS,
        pages: [],
        baseUrls: ['https://app.example.com'],
        story: { persona },
      })
      expect(`${persona}: ${stored.browser_provider}`).toBe(`${persona}: local`)
      expect(stored.script).toBe(PLAYWRIGHT)
    }
  })

  it('keeps the Playwright spec when the story itself requires auth', () => {
    const stored = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: PRICING,
      baseUrls: ['https://app.example.com'],
      story: { auth_required: true, persona: 'buyer' },
    })
    expect(stored).toEqual({
      script: PLAYWRIGHT,
      script_lang: 'playwright-ts',
      browser_provider: 'local',
      target_url: null,
    })
  })

  it('schedules Firecrawl for a guest story, including a public page viewed by an admin', () => {
    for (const persona of [undefined, 'end user', 'learner', 'buyer', 'guest', 'visitor', 'signed-out admin']) {
      const stored = storedQaStoryScript({
        playwright: PLAYWRIGHT,
        firecrawlActions: ACTIONS,
        pages: [],
        baseUrls: ['https://app.example.com'],
        story: { persona },
      })
      expect(`${String(persona)}: ${stored.browser_provider}`).toBe(`${String(persona)}: firecrawl_actions`)
    }

    const explicitGuest = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: [],
      baseUrls: ['https://app.example.com'],
      story: { auth_required: false, persona: 'admin' },
    })
    expect(explicitGuest.browser_provider).toBe('firecrawl_actions')

    const publicPage = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: PRICING,
      baseUrls: ['https://app.example.com'],
      story: { persona: 'admin' },
    })
    expect(publicPage.browser_provider).toBe('firecrawl_actions')
    expect(publicPage.target_url).toBe('https://app.example.com/pricing')
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

describe('usableFirecrawlScript', () => {
  it('keeps only the action types the prompt lists and drops script', () => {
    const stored = usableFirecrawlScript(`
actions:
  - type: wait
    milliseconds: 500
  - type: click
    selector: "#go"
    script: "fetch('https://evil.test')"
  - type: write
    text: hello
  - type: press
    key: Enter
  - type: scroll
    direction: down
  - type: screenshot
    fullPage: true
  - type: scrape
`)
    expect(JSON.parse(stored!)).toEqual({
      actions: [
        { type: 'wait', milliseconds: 500 },
        { type: 'click', selector: '#go' },
        { type: 'write', text: 'hello' },
        { type: 'press', key: 'Enter' },
        { type: 'scroll', direction: 'down' },
        { type: 'screenshot', fullPage: true },
        { type: 'scrape' },
      ],
    })
    expect(stored).not.toContain('evil.test')
    expect(stored).not.toContain('script')
  })

  it('rejects an action type the runner was not asked to store', () => {
    expect(usableFirecrawlScript('actions:\n  - type: executeJavascript\n    script: alert(1)\n')).toBeNull()
    expect(usableFirecrawlScript('actions:\n  - type: pdf\n')).toBeNull()
    expect(usableFirecrawlScript('actions:\n  - type: click\n    selector: a\n  - type: navigate\n')).toBeNull()
    const story = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: 'actions:\n  - type: executeJavascript\n    script: alert(1)\n',
      pages: PRICING,
      baseUrls: ['https://app.example.com'],
    })
    expect(story.browser_provider).toBe('local')
    expect(story.script).toBe(PLAYWRIGHT)
  })
})

describe('qaStoryInsertRow', () => {
  it('copies the stored script into the qa_stories insert', () => {
    const stored = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: PRICING,
      baseUrls: ['https://app.example.com'],
    })
    const row = qaStoryInsertRow({
      projectId: 'p1',
      name: 'See pricing',
      prompt: 'View the pricing page',
      stored,
      approvalStatus: 'pending_review',
      automationMode: 'review',
      storyId: 'see-pricing',
      generationModel: 'test-model',
    })
    expect(row).toEqual({
      project_id: 'p1',
      name: 'See pricing',
      prompt: 'View the pricing page',
      script: stored.script,
      script_lang: 'firecrawl-actions',
      browser_provider: 'firecrawl_actions',
      target_url: 'https://app.example.com/pricing',
      source: 'test_gen_from_story',
      approval_status: 'pending_review',
      automation_mode: 'review',
      origin_story_node_id: 'see-pricing',
      generation_model: 'test-model',
      enabled: false,
    })
    expect(row.script).not.toBe(PLAYWRIGHT)

    const local = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: [{ id: 'account', path: '/account', auth_required: true }],
      baseUrls: ['https://app.example.com'],
    })
    const localRow = qaStoryInsertRow({
      projectId: 'p1',
      name: 'See account',
      prompt: 'View the account page',
      stored: local,
      approvalStatus: 'approved',
      automationMode: 'auto',
      storyId: 'see-account',
      generationModel: 'test-model',
    })
    expect(localRow.browser_provider).toBe('local')
    expect(localRow.script_lang).toBe('playwright-ts')
    expect(localRow.script).toBe(PLAYWRIGHT)
    expect(localRow.enabled).toBe(true)
    expect(localRow.approval_status).toBe('approved')
    expect(Object.hasOwn(localRow, 'target_url')).toBe(false)
  })
})

describe('test-gen-from-story insert', () => {
  it('inserts the helper payload and still commits the Playwright spec', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/test-gen-from-story/index.ts'),
      'utf8',
    )
    expect(src).toMatch(/storedQaStoryScript\(\{[^}]*\bstory\b/)
    expect(src).toMatch(/const row = qaStoryInsertRow\(/)
    expect(src).toMatch(/\.insert\(row\)/)
    expect(src).not.toMatch(/browser_provider:\s*'local'/)
    expect(src).toMatch(/contents: output\.contents/)
  })
})
