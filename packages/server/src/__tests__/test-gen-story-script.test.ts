/**
 * test-gen-from-story used to ask for Firecrawl actions and then insert
 * every qa_stories row as browser_provider `local` / script_lang
 * `playwright-ts`. qa-story-runner skips local stories, so a generated
 * test never ran on the schedule.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { TEST_GEN_MODEL } from '../../supabase/functions/_shared/models.ts'
import { usableFirecrawlScript } from '../../supabase/functions/test-gen-from-story/firecrawl-script.ts'
import { pagesForAuthAndTarget, pagesForStory, qaStoryInsertRow, storedQaStoryScript } from '../../supabase/functions/test-gen-from-story/story-script.ts'

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
      'account holder',
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

  it('schedules a team member, including one viewing a public page', () => {
    for (const persona of ['member', 'team member', 'team member viewing a public page', 'subscriber', 'registered user']) {
      const stored = storedQaStoryScript({
        playwright: PLAYWRIGHT,
        firecrawlActions: ACTIONS,
        pages: [],
        baseUrls: ['https://app.example.com'],
        story: { persona },
      })
      expect(`${persona}: ${stored.browser_provider}`).toBe(`${persona}: firecrawl_actions`)
    }

    const onPublicPage = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: [{ id: 'pricing', path: '/pricing' }],
      baseUrls: ['https://app.example.com'],
      story: { persona: 'team member' },
    })
    expect(onPublicPage.browser_provider).toBe('firecrawl_actions')
    expect(onPublicPage.target_url).toBe('https://app.example.com/pricing')

    const explicitSignIn = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: [{ id: 'pricing', path: '/pricing', auth_required: false }],
      baseUrls: ['https://app.example.com'],
      story: { auth_required: true, persona: 'team member' },
    })
    expect(explicitSignIn.browser_provider).toBe('local')
  })
})

describe('pagesForStory', () => {
  const pages = [
    { id: 'pricing', path: '/pricing', auth_required: false },
    { id: 'account', path: '/account', auth_required: true, user_story: 'billing' },
  ]

  it('uses listed page ids for prompt routes, and a user_story tag only for auth and target', () => {
    expect(pagesForStory({ id: 'see-pricing', pages: ['pricing'] }, pages).map((p) => p.id)).toEqual(['pricing'])
    expect(pagesForStory({ id: 'billing', pages: [] }, pages)).toEqual([])
    expect(pagesForStory({ id: 'billing', pages: ['missing'] }, pages)).toEqual([])
    expect(pagesForAuthAndTarget({ id: 'see-pricing', pages: ['pricing'] }, pages).map((p) => p.id)).toEqual(['pricing'])
    expect(pagesForAuthAndTarget({ id: 'billing', pages: [] }, pages).map((p) => p.id)).toEqual(['account'])
    expect(pagesForAuthAndTarget({ id: 'billing', pages: ['missing'] }, pages).map((p) => p.id)).toEqual(['account'])

    const story = { id: 'see-pricing', pages: [] as string[] }
    const catalog = [{ id: 'pricing', path: '/pricing', auth_required: false, user_story: 'see-pricing' }]
    expect(pagesForStory(story, catalog)).toEqual([])
    const stored = storedQaStoryScript({
      playwright: PLAYWRIGHT,
      firecrawlActions: ACTIONS,
      pages: pagesForAuthAndTarget(story, catalog),
      baseUrls: ['https://app.example.com'],
      story: { persona: 'team member' },
    })
    expect(stored.browser_provider).toBe('firecrawl_actions')
    expect(stored.target_url).toBe('https://app.example.com/pricing')
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

const h = vi.hoisted(() => ({
  served: null as null | ((req: Request) => Promise<Response>),
  inserted: [] as Array<Record<string, unknown>>,
  prompts: [] as string[],
  puts: [] as Array<Record<string, unknown>>,
  inventory: {} as Record<string, unknown>,
  output: {
    path: 'tests/see-pricing.spec.ts',
    contents: '',
    firecrawl_actions: '' as string | undefined,
    summary: 'See pricing',
    rationale: 'covers the story',
    needsHumanReview: false,
  },
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log }
  return { log }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (fn: (req: Request) => Promise<Response>) => fn,
  tagLangfuseTrace: () => {},
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/llm-failover.ts', () => ({
  withAnthropicOrOpenAi: async (
    _db: unknown,
    _projectId: string,
    anthropicFn: (key: { key: string; source: string }) => Promise<unknown>,
  ) => ({ result: await anthropicFn({ key: 'test-key', source: 'byok' }), usedProvider: 'anthropic' }),
  LlmFailoverError: class LlmFailoverError extends Error {},
}))
vi.mock('../../supabase/functions/_shared/llm-usage.ts', () => ({
  withLlmUsage: async (_db: unknown, _ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('../../supabase/functions/_shared/claude-messages.ts', () => ({
  claudeGenerateObject: async (args: { prompt: string }) => {
    h.prompts.push(args.prompt)
    return { object: h.output }
  },
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({ id: 'trace-1', span: () => ({ end: () => {} }), end: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/openai-compat.ts', () => ({ openAiProvider: () => () => ({}) }))

function fakeDb() {
  const table = (name: string) => {
    const result = () => {
      if (name === 'inventories') return { data: { parsed: h.inventory }, error: null }
      if (name === 'project_settings') {
        return {
          data: {
            github_repo_url: 'https://github.com/acme/app',
            github_access_token_ref: 'vault-1',
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    const builder: Record<string, unknown> = {
      maybeSingle: async () => result(),
      single: async () => (name === 'qa_stories' ? { data: { id: 'qa-1' }, error: null } : result()),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      insert: (row: Record<string, unknown>) => {
        h.inserted.push(row)
        return builder
      },
      update: () => builder,
    }
    for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = () => builder
    return builder
  }
  return {
    from: (name: string) => table(name),
    rpc: async (fn: string) => (fn === 'vault_get_secret' ? { data: 'test-token' } : { data: null, error: null }),
  }
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fakeDb() }))

function githubFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET'
  const u = String(url)
  if (method === 'PUT' && u.includes('/contents/')) {
    h.puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    return Promise.resolve(new Response('{}', { status: 201 }))
  }
  if (method === 'POST' && u.endsWith('/git/refs')) return Promise.resolve(new Response('{}', { status: 201 }))
  if (method === 'POST' && u.endsWith('/pulls')) {
    return Promise.resolve(new Response(JSON.stringify({ html_url: 'https://github.com/acme/app/pull/9' }), { status: 201 }))
  }
  if (method === 'GET' && u.includes('/contents/')) return Promise.resolve(new Response('missing', { status: 404 }))
  if (method === 'GET' && u.includes('/git/ref/heads/')) {
    return Promise.resolve(new Response(JSON.stringify({ object: { sha: 'abc123' } })))
  }
  if (method === 'GET' && u.endsWith('/repos/acme/app')) {
    return Promise.resolve(new Response(JSON.stringify({ default_branch: 'main' })))
  }
  return Promise.reject(new Error(`unexpected fetch ${method} ${u}`))
}

function decodeGithubContent(b64: string): string {
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function post(storyId: string): Promise<Response> {
  return h.served!(new Request('https://edge.local/test-gen-from-story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: 'p1',
      story_node_id: storyId,
      automation_mode: 'review',
      open_pr: true,
    }),
  }))
}

describe('test-gen-from-story insert', () => {
  beforeAll(async () => {
    vi.stubGlobal('Deno', {
      env: { get: () => undefined },
      serve: (fn: (req: Request) => Promise<Response>) => {
        h.served = fn
      },
    })
    vi.stubGlobal('fetch', githubFetch)
    await import('../../supabase/functions/test-gen-from-story/index.ts')
  })

  beforeEach(() => {
    h.inserted.length = 0
    h.prompts.length = 0
    h.puts.length = 0
    h.output.path = 'tests/see-pricing.spec.ts'
    h.output.contents = PLAYWRIGHT
    h.output.firecrawl_actions = ACTIONS
    h.output.summary = 'See pricing'
    h.output.needsHumanReview = false
  })

  afterAll(() => vi.unstubAllGlobals())

  it('inserts firecrawl actions for a guest story and commits the Playwright spec', async () => {
    h.inventory = {
      user_stories: [{
        id: 'see-pricing',
        title: 'See pricing',
        goal: 'View the pricing page',
        persona: 'team member',
        pages: [],
      }],
      pages: [{
        id: 'pricing',
        path: '/pricing',
        title: 'Pricing',
        auth_required: false,
        user_story: 'see-pricing',
      }],
      app: { base_url: 'https://app.example.com' },
    }

    const res = await post('see-pricing')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      data: { qaStoryId: 'qa-1', prUrl: 'https://github.com/acme/app/pull/9', path: 'tests/see-pricing.spec.ts' },
    })

    expect(h.prompts[0]).toContain('persona: team member')
    expect(h.prompts[0]).toContain('routes: see goal')
    expect(h.prompts[0]).not.toContain('/pricing')

    expect(h.inserted).toHaveLength(1)
    const row = h.inserted[0]
    expect(row).toMatchObject({
      project_id: 'p1',
      name: 'See pricing',
      prompt: 'View the pricing page',
      script_lang: 'firecrawl-actions',
      browser_provider: 'firecrawl_actions',
      target_url: 'https://app.example.com/pricing',
      source: 'test_gen_from_story',
      approval_status: 'pending_review',
      automation_mode: 'review',
      origin_story_node_id: 'see-pricing',
      generation_model: TEST_GEN_MODEL,
      enabled: false,
    })
    expect(row.script).not.toBe(PLAYWRIGHT)
    expect(JSON.parse(String(row.script))).toMatchObject({
      actions: [{ type: 'click', selector: "a[href='/pricing']" }, { type: 'screenshot' }],
      assertContains: ['Pricing'],
    })
    expect(h.puts).toHaveLength(1)
    expect(decodeGithubContent(String(h.puts[0].content))).toBe(PLAYWRIGHT)
  })

  it('inserts the Playwright spec when the story requires auth, and still commits that spec', async () => {
    h.inventory = {
      user_stories: [{
        id: 'see-account',
        title: 'See account',
        goal: 'View the account page',
        persona: 'buyer',
        auth_required: true,
        pages: ['pricing'],
      }],
      pages: [{ id: 'pricing', path: '/pricing', title: 'Pricing', auth_required: false }],
      app: { base_url: 'https://app.example.com' },
    }
    h.output.path = 'tests/see-account.spec.ts'
    h.output.summary = 'See account'

    const res = await post('see-account')
    expect(res.status).toBe(200)
    expect(h.inserted).toHaveLength(1)
    const row = h.inserted[0]
    expect(row).toMatchObject({
      name: 'See account',
      script: PLAYWRIGHT,
      script_lang: 'playwright-ts',
      browser_provider: 'local',
      source: 'test_gen_from_story',
      approval_status: 'pending_review',
      origin_story_node_id: 'see-account',
      generation_model: TEST_GEN_MODEL,
      enabled: false,
    })
    expect(Object.hasOwn(row, 'target_url')).toBe(false)
    expect(h.prompts[0]).toContain('/pricing')
    expect(decodeGithubContent(String(h.puts[0].content))).toBe(PLAYWRIGHT)
  })
})
