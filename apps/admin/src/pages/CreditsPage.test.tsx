/**
 * @vitest-environment jsdom
 *
 * /credits ("Spend credits"): each Cursor key's spend-down as a switch, the
 * model it runs on, review follow-ups with their models, the Firecrawl
 * balance and what the site watches use before it resets, and a site watch
 * switch per app.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendDownKeyStatus } from '../components/settings/spendDown'

const state = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
  watches: {} as Record<string, unknown>,
  audits: {} as Record<string, unknown>,
  ranks: {} as Record<string, unknown>,
  workerFlags: [] as unknown[],
  skillRuns: {
    skills: [
      { slug: 'audit-accessibility', label: 'Accessibility (WCAG 2.2 AA)', measure: 'axe-core violations on each page in scope', inCatalog: true },
      { slug: 'audit-responsive', label: 'Layouts at every width', measure: 'horizontal scroll at 360 px', inCatalog: true },
    ],
    runs: [
      { id: 'run1', project_id: 'p2', skill_slug: 'audit-accessibility', scope: 'the booking flow', rounds_max: 3, round: 2, auto_merge: true, status: 'active', stop_reason: null, current_report_id: 'rep2', history: [{ round: 1, reportId: 'rep1', outcome: 'merged', prUrl: 'https://github.com/o/r/pull/9' }], created_at: '2026-10-23T09:00:00Z', updated_at: '2026-10-23T10:00:00Z' },
    ],
  } as unknown,
}))

const KEY: SpendDownKeyStatus = {
  id: 'k1',
  label: 'hirose',
  keyHint: 'crsr_e76…c203',
  scope: 'project',
  status: 'active',
  enabled: false,
  creditsExpireAt: '2026-10-28T23:59:00Z',
  model: null,
  dailyLimit: 30,
  windowDays: 14,
  state: 'off',
  startsAt: null,
  dispatchedToday: 0,
  remainingToday: 0,
  projects: [{ id: 'p1', name: 'mushi-mushi' }],
  lastRunAt: null,
  lastSummary: null,
}

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async (path: string, opts: { method?: string; body?: string } = {}) => {
    const method = opts.method ?? 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    state.calls.push({ path, method, body })
    if (method === 'GET' && path.endsWith('/site-watch')) {
      const pid = path.split('/')[4]
      return { ok: true, data: state.watches[pid] }
    }
    if (method === 'GET' && path.endsWith('/search-ranks')) {
      const pid = path.split('/')[4]
      return { ok: true, data: state.ranks[pid] ?? { keywords: [], target: null } }
    }
    if (method === 'PUT' && path.endsWith('/site-audit')) {
      const pid = path.split('/')[4]
      const slot = (state.audits[pid] as { audit: Record<string, unknown> | null; findings: unknown[] } | undefined) ?? {
        audit: null,
        findings: [],
      }
      const prev = slot.audit
      const patch = (body ?? {}) as { enabled?: boolean; baseUrl?: string; pageLimit?: number; cadenceDays?: number }
      state.audits[pid] = {
        findings: slot.findings,
        audit: {
          ...(prev ?? {}),
          id: (prev?.id as string | undefined) ?? `a-${pid}`,
          enabled: patch.enabled === true,
          base_url: patch.baseUrl ?? (prev?.base_url as string | undefined) ?? '',
          page_limit: patch.pageLimit ?? (prev?.page_limit as number | undefined) ?? 200,
          cadence_days: patch.cadenceDays ?? (prev?.cadence_days as number | undefined) ?? 7,
          next_run_at: (prev?.next_run_at as string | null | undefined) ?? null,
          batch_id: (prev?.batch_id as string | null | undefined) ?? null,
          last_run_at: (prev?.last_run_at as string | null | undefined) ?? null,
          last_error: (prev?.last_error as string | null | undefined) ?? null,
          last_summary: prev?.last_summary ?? null,
        },
      }
    }
    if (method === 'GET' && path.endsWith('/site-audit')) {
      const pid = path.split('/')[4]
      return { ok: true, data: state.audits[pid] ?? { audit: null, findings: [] } }
    }
    if (method === 'GET' && path === '/v1/admin/skill-runs') {
      return { ok: true, data: state.skillRuns }
    }
    if (method === 'POST' && path.endsWith('/skill-runs')) {
      return { ok: true, data: { run: { id: 'run2' } } }
    }
    return { ok: true, data: {} }
  },
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const data =
      path === '/v1/admin/byok/credits'
        ? { keys: [{ id: 'fc', provider: 'firecrawl', credits: { kind: 'credits', remaining: 64175, limit: 100000, used: null, periodEnd: '2026-11-03T00:25:32Z', unit: 'credits', source: 'x' } }] }
        : path === '/v1/admin/byok/spend-down'
          ? { projectId: 'p1', keys: [KEY] }
          : path === '/v1/admin/byok/review-followups'
            ? { available: true, canManage: true, settings: { enabled: true, keyId: null, model: 'grok-4.7?reasoning_effort=xhigh', escalationModel: 'claude-opus-5-5', dailyLimit: 200 } }
            : path === '/v1/admin/projects'
              ? { projects: [{ id: 'p1', name: 'mushi-mushi' }, { id: 'p2', name: 'tsumagoi' }, { id: 'p3', name: 'lets-talk' }] }
              : path === '/v1/admin/work/lanes'
                ? {
                    generatedAt: '2026-10-23T02:00:00Z',
                    projects: [{ id: 'p2', name: 'tsumagoi' }],
                    flags: state.workerFlags,
                    hosts: [{ id: 'h1', hostname: 'alienware', platform: 'wsl2', version: null, online: true, lastHeartbeatAt: '2026-10-23T01:59:00Z', status: {}, guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, revoked: false, mine: true }],
                    lanes: [
                      { id: 'l1', hostId: 'h1', projectId: 'p2', projectName: 'tsumagoi', name: 'tsumagoi', config: { paused: false, concurrency: 1, model: 'claude-opus-5-5-medium', mode: 'fix', stop_at: null, drain: false, prune_own: false }, status: {}, lastSeenAt: '2026-10-23T01:59:00Z', active: [], queue: [], recent: [], counts7d: { runs: 0, prs: 0, noChange: 0, timeouts: 0, errors: 0, infra: 0 } },
                    ],
                  }
                : null
    return { data, loading: false, error: null, isValidating: false, reload: () => {}, lastFetchedAt: null }
  },
}))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', async () => {
  const { createElement: h } = await import('react')
  return { PageHeaderBar: ({ title }: { title: string }) => h('h1', null, title) }
})

import { CreditsPage, firecrawlBalance } from './CreditsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T02:00:00Z'))
  state.calls = []
  state.watches = {
    p1: { watch: { base_url: 'https://kensaur.us/mushi-mushi', page_limit: 100, status: 'active', estimated_credits_per_month: 6000 }, openPages: [], suggestedUrl: null, firecrawlReady: true },
    p2: { watch: { base_url: 'https://tsumagoi.kensaur.us', page_limit: 30, status: 'active', estimated_credits_per_month: 1800 }, openPages: [], suggestedUrl: null, firecrawlReady: true },
    p3: { watch: null, openPages: [], suggestedUrl: 'https://talk.kensaur.us', firecrawlReady: true },
  }
  state.ranks = {
    p2: {
      target: 'tsumagoi.kensaur.us',
      keywords: [
        { id: 'r1', query: '嬬恋 車中泊', country: 'JP', last_rank: 2, last_top: ['carstay.jp'], last_checked_at: '2026-10-23T01:00:00Z', last_error: null, history: [{ at: '2026-10-23T01:00:00Z', rank: 2 }, { at: '2026-10-16T01:00:00Z', rank: 5 }] },
        { id: 'r2', query: 'Tsumagoi camping', country: 'US', last_rank: null, last_top: [], last_checked_at: '2026-10-23T01:00:00Z', last_error: null, history: [] },
      ],
    },
  }
  state.audits = {
    p2: {
      audit: { id: 'a2', enabled: true, base_url: 'https://tsumagoi.kensaur.us', page_limit: 139, cadence_days: 7, next_run_at: null, batch_id: null, last_run_at: '2026-10-22T02:00:00Z', last_error: null, last_summary: { pages: 76, credits: 76, reportsFiled: 2 } },
      findings: [{ rule: 'locale_text_leak' }, { rule: 'locale_link_drop' }],
    },
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CreditsPage)))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function toggle(label: string): HTMLButtonElement | HTMLInputElement {
  const el = Array.from(host.querySelectorAll('[role="switch"], input[type="checkbox"]')).find((n) =>
    (n.getAttribute('aria-label') ?? n.closest('label')?.textContent ?? '').includes(label),
  )
  if (!el) throw new Error(`no toggle "${label}"`)
  return el as HTMLButtonElement
}

describe('CreditsPage', () => {
  it('shows the Cursor key expiry and the follow-up models, and turns spend-down on with one switch', async () => {
    await render()
    // The page opens with the one thing to do: a key with an expiry date is not spending down.
    expect(host.textContent).toContain('1 Cursor key has an expiry date but spend-down is off.')
    expect(host.textContent).toContain('expires Oct 28 (6 days)')
    expect(host.textContent).toContain("Runs on each app's Cursor model")
    expect(host.textContent).toContain('Rounds run on Grok 4.7 (Extra high); the last round on Claude Opus 5.5.')
    await act(async () => toggle('Fix open bugs before the credits expire').click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/byok/keys/k1/spend-down', method: 'PATCH', body: { enabled: true } })
  })

  it('shows the Firecrawl balance, the pace to its reset, and a switch per app', async () => {
    await render()
    expect(host.textContent).toContain('64,175 of 100,000 credits left')
    expect(host.textContent).toContain('resets Nov 3 (11 days)')
    expect(host.textContent).toContain('Watches, audits and rank checks use about 272 a day · about 2,994 before Nov 3 · about 61,181 would go unused.')
    const rows = host.querySelectorAll('[aria-label="Site watch per app"] > li')
    expect(rows).toHaveLength(3)
  })

  it('widens a capped watch, and starts one for an unwatched app from its suggested address', async () => {
    await render()
    const widen = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Watch up to 100 pages'))!
    await act(async () => widen.click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/projects/p2/site-watch', method: 'PUT', body: { baseUrl: 'https://tsumagoi.kensaur.us', pageLimit: 100 } })
    const watchSwitches = Array.from(host.querySelectorAll('[aria-label="Site watch per app"] > li'))
    const letsTalk = watchSwitches[2].querySelector('[role="switch"], input[type="checkbox"]') as HTMLButtonElement
    await act(async () => letsTalk.click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/projects/p3/site-watch', method: 'PUT', body: { baseUrl: 'https://talk.kensaur.us', pageLimit: 25 } })
  })
})

describe('expiry countdown on /credits', () => {
  it('opens on one card per expiring key, soonest first, and turns spend-down on from the status line', async () => {
    await render()
    const cards = Array.from(host.querySelectorAll('[aria-label="Credits by expiry date"] > li'))
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Cursor · hirose'),
      expect.stringContaining('Firecrawl'),
    ])
    expect(cards[0].textContent).toContain('Expires Oct 28')
    expect(cards[0].textContent).toContain('Spend-down is off, so nothing is spending these credits.')
    expect(cards[1].textContent).toContain('64,175 credits left until the reset.')
    const turnOn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Turn on spend-down')!
    await act(async () => turnOn.click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/byok/keys/k1/spend-down', method: 'PATCH', body: { enabled: true } })
  })
})

describe('site audit on /credits', () => {
  it('shows the last run, counts audits in the pace, and turns one on or runs it now', async () => {
    await render()
    expect(host.textContent).toContain('76 pages, 2 rules failing, 2 reports filed.')
    // 260 a day of watches + (76 + 1) / 7 = 11 a day of audit.
    expect(host.textContent).toContain('Watches, audits and rank checks use about 272 a day')
    const rows = Array.from(host.querySelectorAll('[aria-label="Site watch per app"] > li'))
    const auditSwitch = (row: Element) =>
      Array.from(row.querySelectorAll('[role="switch"], input[type="checkbox"]')).find((n) =>
        (n.getAttribute('aria-label') ?? n.closest('label')?.textContent ?? '').includes('Audit links'),
      ) as HTMLButtonElement
    await act(async () => auditSwitch(rows[0]).click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/projects/p1/site-audit', method: 'PUT', body: { enabled: true, baseUrl: 'https://kensaur.us/mushi-mushi' } })
    const runNow = Array.from(rows[1].querySelectorAll('button')).find((b) => b.textContent?.includes('Run now'))!
    await act(async () => runNow.click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/projects/p2/site-audit/run', method: 'POST', body: null })
  })

  it('saves Daily and a page limit while the audit is on, and reloads the saved cadence', async () => {
    await render()
    const row = (name: string) =>
      Array.from(host.querySelectorAll('[aria-label="Site watch per app"] > li')).find((li) => li.textContent?.includes(name))!
    expect(row('mushi-mushi').querySelector('[aria-label="How often to audit"]')).toBeNull()
    const tsumagoi = row('tsumagoi')
    expect(tsumagoi.textContent).toContain('Up to 139 credits a run, one per page.')
    expect(Array.from(tsumagoi.querySelectorAll('[role="radio"]')).map((b) => b.textContent)).toEqual(['Daily', 'Every 3 days', 'Weekly'])
    expect(tsumagoi.querySelector('[aria-label="How often to audit"] [aria-checked="true"]')?.textContent).toBe('Weekly')
    const daily = Array.from(tsumagoi.querySelectorAll('[role="radio"]')).find((b) => b.textContent === 'Daily') as HTMLButtonElement
    await act(async () => daily.click())
    await act(async () => {
      await Promise.resolve()
    })
    expect(state.calls).toContainEqual({
      path: '/v1/admin/projects/p2/site-audit',
      method: 'PUT',
      body: { enabled: true, baseUrl: 'https://tsumagoi.kensaur.us', cadenceDays: 1 },
    })
    expect(row('tsumagoi').querySelector('[aria-label="How often to audit"] [aria-checked="true"]')?.textContent).toBe('Daily')
    const pages = row('tsumagoi').querySelector('select') as HTMLSelectElement
    expect(Array.from(pages.options).map((o) => o.textContent)).toEqual([
      'Up to 50 pages',
      'Up to 100 pages',
      'Up to 139 pages',
      'Up to 200 pages',
      'Up to 500 pages',
    ])
    await act(async () => {
      pages.value = '200'
      pages.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(state.calls).toContainEqual({
      path: '/v1/admin/projects/p2/site-audit',
      method: 'PUT',
      body: { enabled: true, baseUrl: 'https://tsumagoi.kensaur.us', pageLimit: 200 },
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(row('tsumagoi').textContent).toContain('Up to 200 credits a run, one per page.')
  })
})

describe('skill runs on /credits', () => {
  it('lists runs with their round, and starts one on the chosen app, skill and part of the app', async () => {
    await render()
    expect(host.textContent).toContain('Cursor: improve your apps with skills')
    expect(host.textContent).toContain('tsumagoi · Accessibility (WCAG 2.2 AA) · the booking flow')
    expect(host.textContent).toContain('Round 2 of 3 · 1 merged')
    expect(host.textContent).toContain('Each round measures axe-core violations on each page in scope')
    const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    }
    const selects = Array.from(host.querySelectorAll('select'))
    const appSelect = selects.find((s) => Array.from(s.options).some((o) => o.textContent === 'tsumagoi'))!
    const skillSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === 'audit-responsive'))!
    const scope = host.querySelector('input[placeholder^="e.g. the /settings pages"]') as HTMLInputElement
    await act(async () => {
      setValue(appSelect, 'p3')
      setValue(skillSelect, 'audit-responsive')
      setValue(scope, 'the chat screens')
    })
    const start = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Start skill run')!
    await act(async () => start.click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/projects/p3/skill-runs', method: 'POST', body: { skillSlug: 'audit-responsive', scope: 'the chat screens', rounds: 3, autoMerge: true } })
  })
})

describe('search rank on /credits', () => {
  it('shows each keyword\'s rank and its change, and saves edited keywords', async () => {
    await render()
    expect(host.textContent).toContain('嬬恋 車中泊 (JP): #2 (was #5)')
    expect(host.textContent).toContain('Tsumagoi camping: not in the top 20')
    const rows = Array.from(host.querySelectorAll('[aria-label="Site watch per app"] > li'))
    const edit = Array.from(rows[1].querySelectorAll('button')).find((b) => b.textContent === 'Edit keywords')!
    await act(async () => edit.click())
    const box = rows[1].querySelector('textarea') as HTMLTextAreaElement
    expect(box.value).toBe('嬬恋 車中泊 @JP\nTsumagoi camping')
    const save = Array.from(rows[1].querySelectorAll('button')).find((b) => b.textContent?.includes('Save'))!
    await act(async () => save.click())
    expect(state.calls).toContainEqual({ path: '/v1/admin/projects/p2/search-ranks', method: 'PUT', body: { keywords: '嬬恋 車中泊 @JP\nTsumagoi camping' } })
  })
})

describe('Cursor key model on /credits', () => {
  it('names the model spend-down runs on, and links to Settings to change it', async () => {
    const { CursorLevers } = await import('../components/credits/CursorLevers')
    const key = (id: string, model: string | null): SpendDownKeyStatus => ({ ...KEY, id, model, state: 'active', enabled: true, dispatchedToday: 3 })
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(CursorLevers, {
        spendDown: { projectId: 'p1', keys: [key('k1', 'claude-opus-5-5?effort=high&context=1m'), key('k2', null)] },
        followups: null,
        now: new Date('2026-10-23T02:00:00Z'),
        onChanged: () => {},
      })))
    })
    const text = host.textContent ?? ''
    expect(text).toContain('Spending down: 3 of 30 fixes today')
    expect(text).toContain('on Claude Opus 5.5 (High, 1M)')
    expect(text).toContain("each app's Cursor model")
    const changes = Array.from(host.querySelectorAll('a')).filter((a) => a.textContent === 'Change')
    expect(changes.map((a) => a.getAttribute('href'))).toEqual(['/settings?tab=byok', '/settings?tab=byok'])
  })
})

describe('firecrawlBalance', () => {
  it('takes the first Firecrawl key that reported a balance', () => {
    expect(firecrawlBalance({ keys: [{ id: 'a', provider: 'firecrawl', credits: { kind: 'error' } }, { id: 'b', provider: 'firecrawl', credits: { kind: 'credits', remaining: 5, limit: 10, periodEnd: null } }] })).toEqual({ remaining: 5, limit: 10, periodEnd: null })
    expect(firecrawlBalance(null)).toBeNull()
  })
})

describe('Local workers on /credits', () => {
  it('lists each lane with its model and whether it takes reports, linked to the Workers tab', async () => {
    await render()
    const row = host.querySelector('[data-testid="credits-worker-model-l1"]')!
    expect(row.textContent).toContain('tsumagoi')
    expect(row.textContent).toContain('claude-opus-5-5-medium')
    expect(row.textContent).toContain('taking reports')
    expect(host.querySelector('[data-testid="credits-worker-models"] a[href="/pipeline?tab=workers"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="credits-idle"]')).toBeNull()
  })

  it('says the credits are idle, for how long and what blocks the work (ADR 0048 amendment 2026-10-28)', async () => {
    state.workerFlags = [
      {
        id: 'credits_idle',
        kind: 'credits_idle',
        severity: 'danger',
        hostId: null,
        hostname: null,
        laneId: null,
        laneName: null,
        projectId: null,
        title: 'Cursor credits idle for 7 h',
        cause: 'Cursor key "suzu" expires in 24 h. What blocks the work: glot: a run has held an agent space for 4 h 10 min.',
        sinceSec: 7 * 3600,
        actions: [],
      },
    ]
    try {
      await render()
      const idle = host.querySelector('[data-testid="credits-idle"]')!
      expect(idle.textContent).toContain('Cursor credits idle for 7 h.')
      expect(idle.textContent).toContain('What blocks the work: glot: a run has held an agent space')
      expect(host.querySelector('[data-testid="credits-idle-open"]')!.getAttribute('href')).toBe('/pipeline?tab=workers')
    } finally {
      state.workerFlags = []
    }
  })
})

describe('FirecrawlLevers while the project list loads', () => {
  it('says it is reading instead of claiming nothing is watched', async () => {
    const { FirecrawlLevers } = await import('../components/credits/FirecrawlLevers')
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(FirecrawlLevers, { balance: null, projects: null, now: new Date() })))
    })
    expect(host.textContent).toContain('Reading each app')
    expect(host.textContent).not.toContain('nothing is spent')
  })
})
