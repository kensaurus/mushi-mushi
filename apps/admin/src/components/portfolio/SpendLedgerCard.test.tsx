/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/portfolio/SpendLedgerCard.test.tsx
 * PURPOSE: The spend ledger on /portfolio (gap #22) shows a failed source as
 *          "Couldn't read" (never $0), marks the total as a floor, uploads a
 *          picked CSV to the import route, and removes an import. The daily
 *          digest card saves the new Discord / Teams / Telegram and weekly
 *          line settings with the rest.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendLedgerResponse } from '../../lib/portfolioTypes'
import type { DigestPreviewResponse } from '../../lib/radarTypes'

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'

const LEDGER: SpendLedgerResponse = {
  organizationId: ORG,
  from: '2026-09-03T12:00:00Z',
  to: '2026-10-03T12:00:00Z',
  days: 30,
  ciUsdPerLinuxMinute: 0.006,
  apps: [{
    projectId: P1,
    name: 'glot.it',
    mushiLlm: { state: 'ok', usd: 1.75, calls: 2, detail: null },
    providerLlm: { state: 'ok', usd: 42.1, detail: null },
    ci: { state: 'error', usd: null, minutes: null, runs: 0, detail: 'CI runs could not be read.' },
    supabase: { state: 'not_connected', usd: null, usage: [], detail: 'Import a Supabase usage or invoice CSV to see egress and invocations.' },
    bills: { state: 'ok', usd: 20, byVendor: [{ vendor: 'vercel', usd: 20 }], detail: 'From imported bills.' },
    totalUsd: 63.85,
    complete: false,
  }],
  totals: { mushiLlmUsd: 1.75, providerLlmUsd: 42.1, ciUsd: 0, supabaseUsd: 0, billsUsd: 20, totalUsd: 63.85 },
  unattributedProviderUsd: 7.5,
  complete: false,
  imports: [{ id: 'imp1', vendor: 'vercel', projectId: P1, filename: 'sept.csv', format: 'focus', rowsRead: 3, rowsImported: 3, rowsSkipped: 0, totalUsd: 20, periodStart: '2026-09-01', periodEnd: '2026-09-30', createdAt: '2026-10-03T00:00:00Z' }],
}

const DIGEST: DigestPreviewResponse = {
  settings: {
    organizationId: ORG, enabled: true, slackProjectId: null, discordProjectId: null, teamsProjectId: null, telegramProjectId: null,
    email: true, webPush: false, sendHourUtc: 9, gtmWeekday: 1, lastSentAt: null, lastStatus: null, lastError: null,
  },
  preview: { title: 'Mushi daily digest for A', lines: ['This week, glot.it: 40 did signed_up, 9 reached activated (22.5%).'], text: '', hasContent: true },
}

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), reload: vi.fn(), role: { value: 'owner' }, ledger: { value: null as unknown }, spendLoading: { value: false } }))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path?.endsWith('/spend')
      ? mocks.spendLoading.value ? null : mocks.ledger.value ?? LEDGER
      : path?.endsWith('/digest')
        ? DIGEST
        : path === '/v1/org'
          ? { organizations: [{ id: ORG, slug: 'a', name: 'A', plan_id: 'free', role: mocks.role.value }] }
          : null,
    loading: path?.endsWith('/spend') ? mocks.spendLoading.value : false,
    error: null,
    reload: mocks.reload,
  }),
}))

import { SpendLedgerCard } from './SpendLedgerCard'
import { DigestCard, sendNowBlocker } from './DigestCard'
import { CI_READ_TIMEOUT_MS } from '../../lib/ciReadTimeout'

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

function calls(method: string): Array<{ path: string; body: Record<string, unknown> | null }> {
  return mocks.apiFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
    .map(([path, init]) => ({ path: String(path), body: (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : null }))
}

function bodyButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}

/** Remove asks first (QA 44): click Remove, then confirm in the dialog. */
async function removeAndConfirm(): Promise<void> {
  await act(async () => {
    bodyButton('Remove')!.click()
    await flush()
  })
  expect(calls('DELETE')).toEqual([])
  await act(async () => {
    bodyButton('Remove bill')!.click()
    await flush()
  })
}

describe('SpendLedgerCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { importId: 'imp2', format: 'generic', rowsRead: 1, rowsImported: 1, rowsSkipped: 0, skipReasons: [], unmatchedApps: [], totalUsd: 3, periodStart: '2026-10-01', periodEnd: '2026-10-01' } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(el: ReturnType<typeof createElement>): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, el))
      await flush()
    })
  }

  it('shows a failed source as unread, never $0, and the total as a floor', async () => {
    await render(createElement(SpendLedgerCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    const row = container.querySelector('[data-testid="spend-ledger-table"] tbody tr')!
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    // Not connected is a hatched dash with the reason as its tooltip; the split bar has no text.
    expect(cells).toEqual(['glot.it', '$1.75', '$42.10', "Couldn't read", '—', '$20.00', '$63.85+', ''])
    const supabase = row.querySelectorAll('td')[4]!
    expect(supabase.className).toContain('ci-nodata')
    expect(supabase.getAttribute('title')).toBe('Not connected. Import a Supabase usage or invoice CSV to see egress and invocations.')
    expect(container.textContent).toContain('some totals are a floor')
    expect(container.textContent).toContain('$7.50 of AI provider spend is not tied to any app')
  })

  it('uploads the picked CSV to the import route with the vendor and app', async () => {
    await render(createElement(SpendLedgerCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    const selects = container.querySelectorAll<HTMLSelectElement>('fieldset select')
    await act(async () => {
      selects[0].value = 'aws'
      selects[0].dispatchEvent(new Event('change', { bubbles: true }))
      selects[1].value = P1
      selects[1].dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['date,service,cost\n2026-10-01,S3,3'], 'aws.csv', { type: 'text/csv' })
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Import')!.click()
      await flush()
      await new Promise((r) => setTimeout(r, 0))
      await flush()
    })
    expect(calls('POST')).toEqual([{ path: `/v1/admin/orgs/${ORG}/spend/imports`, body: { vendor: 'aws', projectId: P1, filename: 'aws.csv', csv: 'date,service,cost\n2026-10-01,S3,3' } }])
    expect(container.textContent).toContain('Imported 1 row ($3.00) for 2026-10-01 to 2026-10-01.')
  })

  it('removes an import and says which rows went back to an earlier import', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { importId: 'imp1', rowsRemoved: 1, rowsRestored: 2, restoredFrom: 1 } })
    await render(createElement(SpendLedgerCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    await removeAndConfirm()
    expect(calls('DELETE')).toEqual([{ path: `/v1/admin/orgs/${ORG}/spend/imports/imp1`, body: null }])
    expect(container.textContent).toContain('Import removed. 1 row left the ledger. 2 rows went back to the earlier import that had them.')
  })

  it('says when removing an import changed nothing in the ledger', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { importId: 'imp1', rowsRemoved: 0, rowsRestored: 0, restoredFrom: 0 } })
    await render(createElement(SpendLedgerCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    await removeAndConfirm()
    expect(container.textContent).toContain('a later import had already replaced all of its rows')
  })

  it('the digest card saves a Teams channel and the weekly day with the rest of the settings', async () => {
    await render(createElement(DigestCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    expect(container.textContent).toContain('This week, glot.it')
    const teams = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).find((s) => s.getAttribute('aria-label') === "Teams: which app's Teams webhook")!
    await act(async () => {
      teams.value = P1
      teams.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })
    expect(calls('PUT')[0]).toEqual({
      path: `/v1/admin/orgs/${ORG}/digest/settings`,
      body: { enabled: true, slackProjectId: null, discordProjectId: null, teamsProjectId: P1, telegramProjectId: null, email: true, webPush: false, sendHourUtc: 9, gtmWeekday: 1 },
    })
    const weekly = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).find((s) => s.closest('label')?.textContent?.includes('Weekly signups'))!
    await act(async () => {
      weekly.value = ''
      weekly.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })
    expect(calls('PUT')[1].body).toMatchObject({ gtmWeekday: null })
  })

  it('the digest says what each channel picker sends to, and shows the preview as a quote, not a card', async () => {
    await render(createElement(DigestCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    const slack = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).find((s) => s.getAttribute('aria-label') === "Slack: which app's Slack channel")!
    expect(Array.from(slack.options).map((o) => o.textContent)).toEqual(['Off', "glot.it's Slack channel"])
    expect(container.textContent).not.toContain('Slack channel of')
    const preview = container.querySelector('[data-testid="digest-preview"]')!
    expect(preview.className).not.toMatch(/rounded|shadow/)
    expect(preview.textContent).toContain('This week, glot.it')
    // Send now can run: no reason shown.
    expect(container.querySelector('[data-testid="digest-send-blocker"]')).toBeNull()
  })

  it('says inline why Send now is off', () => {
    expect(sendNowBlocker({ enabled: false })).toBe('Turn on "Send the digest every day" first.')
    expect(sendNowBlocker({ enabled: true })).toBeNull()
  })
})

const app = (projectId: string, name: string, over: Partial<SpendLedgerResponse['apps'][number]>): SpendLedgerResponse['apps'][number] => ({
  projectId,
  name,
  mushiLlm: { state: 'ok', usd: 0, calls: 0, detail: null },
  providerLlm: { state: 'not_connected', usd: null, detail: 'Connect AI provider spend under Connected sources.' },
  ci: { state: 'ok', usd: 0, minutes: 0, runs: 0, detail: null },
  supabase: { state: 'not_connected', usd: null, usage: [], detail: 'Import a Supabase CSV.' },
  bills: { state: 'not_connected', usd: null, byVendor: [], detail: 'Import a Vercel or AWS bill CSV.' },
  totalUsd: 0,
  complete: true,
  ...over,
})

describe('SpendLedgerCard signals', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.ledger.value = {
      ...LEDGER,
      complete: true,
      apps: [
        app('s', 'small', { mushiLlm: { state: 'ok', usd: 2, calls: 4, detail: null }, totalUsd: 2 }),
        app('b', 'big', { mushiLlm: { state: 'ok', usd: 10, calls: 9, detail: null }, providerLlm: { state: 'ok', usd: 30, detail: null }, ci: { state: 'ok', usd: 20, minutes: 3000, runs: 40, detail: null }, totalUsd: 60 }),
        app('m', 'mid', { ci: { state: 'ok', usd: 15, minutes: 2500, runs: 30, detail: null }, totalUsd: 15 }),
      ],
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mocks.ledger.value = null
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SpendLedgerCard, { orgId: ORG, projects: [] })))
      await flush()
    })
  }

  it('sorts apps by total, most first, with the total as a bar on one scale', async () => {
    await render()
    const rows = Array.from(container.querySelectorAll('[data-testid="spend-ledger-table"] tbody tr'))
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual(['big', 'mid', 'small'])
    const widths = rows.map((r) => (r.querySelector('[data-testid="spend-total"] [data-testid="bar-cell-fill"]') as HTMLElement).style.width)
    // jsdom 31 rounds serialised percentages (3.33333%), so compare the numbers.
    expect(widths.every((w) => w.endsWith('%'))).toBe(true)
    const expected = [100, 25, (2 / 60) * 100]
    widths.forEach((w, i) => expect(Number.parseFloat(w)).toBeCloseTo(expected[i], 3))
    // Where the money goes, per app, as a stacked bar named with its amounts.
    const split = rows[0]!.querySelector('[data-testid="spend-split"]')!
    expect(split.getAttribute('aria-label')).toBe('big spend: Mushi Mushi AI $10.00, AI provider $30.00, CI $20.00, Cloud bills $0.00')
    expect(Array.from(split.querySelectorAll('[data-part]')).map((s) => s.getAttribute('data-part'))).toEqual(['mushi', 'provider', 'ci'])
    expect(container.querySelectorAll('[data-testid="spend-legend"]')).toHaveLength(1)
  })

  it('never repeats "Not connected" per cell: a dash in the cells, one connect action per column', async () => {
    await render()
    const text = container.querySelector('[data-testid="spend-ledger-table"]')!.textContent ?? ''
    expect(text).not.toContain('Not connected')
    expect(container.querySelectorAll('td[data-state="not_connected"]')).toHaveLength(8)
    const labels = Array.from(container.querySelectorAll('thead button, thead a')).map((b) => b.textContent)
    expect(labels).toEqual(['Connect AI provider', 'Connect Supabase', 'Import bills'])
  })
})

describe('portfolio cards for a member (QA 177)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.role.value = 'member'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mocks.role.value = 'owner'
  })

  async function render(el: ReturnType<typeof createElement>): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, el))
      await flush()
    })
  }

  it('hides bill import and removal and says who can do it', async () => {
    await render(createElement(SpendLedgerCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).not.toContain('Import')
    expect(labels).not.toContain('Remove')
    // The header actions that lead to the import form go too; Connected sources stays open to members.
    expect(labels).not.toContain('Connect Supabase')
    expect(labels).not.toContain('Import bills')
    expect(container.textContent).toContain('Only team owners and admins can change this.')
  })

  it('shows the digest read-only with no Send now', async () => {
    await render(createElement(DigestCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    expect(container.querySelector('fieldset')?.disabled).toBe(true)
    expect(Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())).not.toContain('Send now')
  })
})

// Round 3 (2026-11-19): Spend sat on "Adding up what each app costs…". A read that never
// answers turns into "not checked" with one Retry after the timeout.
describe('SpendLedgerCard read that never answers', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.spendLoading.value = true
    mocks.reload.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mocks.spendLoading.value = false
    vi.useRealTimers()
  })

  it('shows the loading line, then "Spend per app: not checked" with Retry', () => {
    act(() => root.render(createElement(MemoryRouter, null, createElement(SpendLedgerCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))))
    expect(container.textContent).toContain('Adding up what each app costs…')
    act(() => vi.advanceTimersByTime(CI_READ_TIMEOUT_MS))
    const row = container.querySelector('[data-testid="portfolio-spend-not-checked"]')!
    expect(row.textContent).toContain('Spend per app: not checked')
    expect(container.textContent).not.toContain('Adding up what each app costs…')
    act(() => Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Retry')!.click())
    expect(mocks.reload).toHaveBeenCalled()
  })
})
