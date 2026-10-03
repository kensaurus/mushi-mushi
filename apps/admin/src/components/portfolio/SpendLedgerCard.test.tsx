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

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), reload: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path?.endsWith('/spend') ? LEDGER : path?.endsWith('/digest') ? DIGEST : null,
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}))

import { SpendLedgerCard } from './SpendLedgerCard'
import { DigestCard } from './DigestCard'

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

function calls(method: string): Array<{ path: string; body: Record<string, unknown> | null }> {
  return mocks.apiFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
    .map(([path, init]) => ({ path: String(path), body: (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : null }))
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
    expect(cells).toEqual(['glot.it', '$1.75', '$42.10', "Couldn't read", 'Not connected', '$20.00', '$63.85+'])
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
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Remove')!.click()
      await flush()
    })
    expect(calls('DELETE')).toEqual([{ path: `/v1/admin/orgs/${ORG}/spend/imports/imp1`, body: null }])
    expect(container.textContent).toContain('Import removed. 1 row left the ledger. 2 rows went back to the earlier import that had them.')
  })

  it('says when removing an import changed nothing in the ledger', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { importId: 'imp1', rowsRemoved: 0, rowsRestored: 0, restoredFrom: 0 } })
    await render(createElement(SpendLedgerCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Remove')!.click()
      await flush()
    })
    expect(container.textContent).toContain('a later import had already replaced all of its rows')
  })

  it('the digest card saves a Teams channel and the weekly day with the rest of the settings', async () => {
    await render(createElement(DigestCard, { orgId: ORG, projects: [{ projectId: P1, name: 'glot.it' }] }))
    expect(container.textContent).toContain('This week, glot.it')
    const teams = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).find((s) => s.closest('label')?.textContent?.includes('Teams webhook of'))!
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
})
