/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/DataEgressCard.test.tsx
 * PURPOSE: Settings → Security → Data egress. Shows local-only on or off,
 *          the allowlist, refusals by host and day and each integration's
 *          verdict; runs the self-test and says "Nothing left this stack" or
 *          names the reachable hosts; a viewer's 403, a 429 and a 5xx read
 *          as sentences; a failed status read offers a retry.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => api)

import { DataEgressCard } from './DataEgressCard'

type ApiReply = { ok: boolean; data?: unknown; error?: { code: string; message: string } }

const ON_STATUS = {
  localOnly: true,
  allowlist: ['git.corp.example', 'smtp.corp.example'],
  denials: [
    { host: 'api.openai.com', caller: 'classify-report', day: '2026-10-21', count: 2, lastAt: '2026-10-21T09:00:00Z' },
    { host: 'api.openai.com', caller: 'judge-batch', day: '2026-10-21', count: 3, lastAt: '2026-10-21T10:00:00Z' },
    { host: 'sentry.io', caller: 'api', day: '2026-10-20', count: 1, lastAt: '2026-10-20T08:00:00Z' },
  ],
  integrations: [
    { id: 'anthropic', label: 'Anthropic', destination: 'api.anthropic.com', enabled: true, allowed: false, note: null },
    { id: 'github', label: 'GitHub', destination: 'git.corp.example', enabled: true, allowed: true, note: 'GitHub Enterprise Server' },
    { id: 'firecrawl', label: 'Firecrawl', destination: 'api.firecrawl.dev', enabled: false, allowed: false, note: null },
  ],
}

function serve(status: ApiReply, selftest?: ApiReply) {
  api.apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && path === '/v1/admin/egress/selftest') return selftest ?? { ok: false }
    if (path === '/v1/admin/egress/status') return status
    throw new Error(`unexpected ${path}`)
  })
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  api.apiFetch.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(DataEgressCard, { projectId: 'p1', id: 'data-egress' })))
    await flush()
  })
}

function text(): string {
  return container.textContent ?? ''
}

function selftestButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    (b.textContent ?? '').includes('Run self-test'),
  )
  if (!button) throw new Error('no self-test button')
  return button
}

async function runSelftest(): Promise<void> {
  await act(async () => {
    selftestButton().click()
    await flush()
  })
}

describe('DataEgressCard', () => {
  it('shows local-only on, the allowlist, refusals by host and day, and integration verdicts', async () => {
    serve({ ok: true, data: ON_STATUS })
    await render()
    expect(api.apiFetch).toHaveBeenCalledWith('/v1/admin/egress/status', { cache: 'no-store' })
    expect(container.querySelector('#data-egress')).not.toBeNull()
    expect(text()).toContain('Local-only mode')
    expect(text()).toContain('Only the hosts below can be reached.')

    const allowed = container.querySelector('[aria-label="Allowed hosts"]')
    expect(allowed?.textContent).toContain('git.corp.example')
    expect(allowed?.textContent).toContain('smtp.corp.example')

    const denials = container.querySelector('table[aria-label="Refused requests by host and day"]')!
    const denialCells = [...denials.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    )
    expect(denialCells).toEqual([
      ['api.openai.com', '2026-10-21', '5', 'classify-report, judge-batch'],
      ['sentry.io', '2026-10-20', '1', 'api'],
    ])

    const integrations = container.querySelector('table[aria-label="Integrations and where they send data"]')!
    const verdicts = [...integrations.querySelectorAll('tbody tr')].map((tr) => tr.lastElementChild?.textContent)
    expect(verdicts).toEqual(['Refused', 'Allowed', 'Off'])
    expect(integrations.textContent).toContain('GitHub Enterprise Server')
  })

  it('says when local-only is off and nothing has been refused', async () => {
    serve({ ok: true, data: { localOnly: false, allowlist: [], denials: [], integrations: [] } })
    await render()
    expect(text()).toContain('Off')
    expect(text()).toContain('Set MUSHI_LOCAL_ONLY=1 on the server')
    expect(text()).toContain('The list only applies when local-only mode is on.')
    expect(text()).toContain('No refused requests recorded.')
    expect(text()).toContain('No integrations reported.')
  })

  it('says nothing can be reached when local-only is on with an empty allowlist', async () => {
    serve({ ok: true, data: { ...ON_STATUS, allowlist: [] } })
    await render()
    expect(text()).toContain('nothing can be reached')
  })

  it('reports a failed status read with a retry, and the self-test stays available', async () => {
    serve({ ok: false, error: { code: 'HTTP_ERROR', message: '404: Not Found' } })
    await render()
    expect(text()).toContain('does not have the data egress check yet')
    expect(text()).not.toContain('Loading the egress status')
    expect(selftestButton().disabled).toBe(false)

    serve({ ok: true, data: ON_STATUS })
    const retry = [...container.querySelectorAll('button')].find((b) => /retry|try again/i.test(b.textContent ?? ''))
    expect(retry).toBeDefined()
    await act(async () => {
      retry!.click()
      await flush()
    })
    expect(text()).toContain('git.corp.example')
  })

  it('a passing self-test says nothing left this stack, lists each host and reloads the refusals', async () => {
    serve(
      { ok: true, data: ON_STATUS },
      {
        ok: true,
        data: {
          localOnly: true,
          passed: true,
          results: [
            { host: 'api.anthropic.com', outcome: 'blocked_by_mushi', ms: 1.4 },
            { host: 'sentry.io', outcome: 'network_unreachable', ms: 31 },
          ],
        },
      },
    )
    await render()
    api.apiFetch.mockClear()
    await runSelftest()
    expect(api.apiFetch).toHaveBeenCalledWith('/v1/admin/egress/selftest', { method: 'POST' })
    expect(api.apiFetch).toHaveBeenCalledWith('/v1/admin/egress/status', { cache: 'no-store' })
    const result = container.querySelector('[data-testid="egress-selftest-result"]')!
    expect(result.textContent).toContain('Passed')
    expect(result.textContent).toContain('Nothing left this stack')
    expect(result.textContent).toContain('Refused by Mushi')
    expect(result.textContent).toContain('Refused by the network')
    expect(result.textContent).toContain('31 ms')
  })

  it('a failing self-test names the hosts that were reachable', async () => {
    serve(
      { ok: true, data: { ...ON_STATUS, localOnly: false } },
      {
        ok: true,
        data: {
          localOnly: false,
          passed: false,
          results: [
            { host: 'api.openai.com', outcome: 'reachable', ms: 120 },
            { host: 'sentry.io', outcome: 'blocked_by_mushi', ms: 1 },
          ],
        },
      },
    )
    await render()
    await runSelftest()
    const result = container.querySelector('[data-testid="egress-selftest-result"]')!
    expect(result.textContent).toContain('Failed')
    expect(result.textContent).toContain('These hosts were reachable: api.openai.com.')
    expect(result.textContent).toContain('Reachable')
  })

  it.each([
    [{ code: 'FORBIDDEN', message: 'Forbidden' }, 'Viewers can see this card but cannot run the self-test'],
    [{ code: 'RATE_LIMITED', message: 'Too many requests' }, 'Wait a minute, then run it again'],
    [{ code: 'HTTP_ERROR', message: '503: upstream' }, 'The server could not run the self-test'],
  ])('a self-test error (%o) reads as a sentence and shows no result', async (error, sentence) => {
    serve({ ok: true, data: ON_STATUS }, { ok: false, error })
    await render()
    await runSelftest()
    expect(text()).toContain(sentence)
    expect(container.querySelector('[data-testid="egress-selftest-result"]')).toBeNull()
    expect(selftestButton().disabled).toBe(false)
  })
})
