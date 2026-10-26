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
    state.calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null })
    if (method === 'GET' && path.endsWith('/site-watch')) {
      const pid = path.split('/')[4]
      return { ok: true, data: state.watches[pid] }
    }
    if (method === 'GET' && path.endsWith('/search-ranks')) {
      const pid = path.split('/')[4]
      return { ok: true, data: state.ranks[pid] ?? { keywords: [], target: null } }
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
              : null
    return { data, loading: false, error: null, isValidating: false, reload: () => {}, lastFetchedAt: null }
  },
}))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', async () => {
  const { createElement: h } = await import('react')
  return {
    PageHeaderBar: ({ title, titleAs }: { title: string; titleAs?: string }) =>
      h(titleAs === 'h1' ? 'h1' : 'h2', null, title),
  }
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
    expect(host.querySelector('h1')?.textContent).toBe('Spend credits')
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Cursor: fix bugs',
      'Cursor: improve your apps with skills',
      'Firecrawl: find bugs on your live sites',
    ])
    const sentenceLinks = [...host.querySelectorAll('a')].filter((a) => a.className.includes('text-brand'))
    expect(sentenceLinks.length).toBeGreaterThan(0)
    for (const a of sentenceLinks) {
      expect(a.classList.contains('underline')).toBe(true)
      expect(a.className).not.toContain('hover:underline')
    }
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
