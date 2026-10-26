/**
 * @vitest-environment jsdom
 */

/**
 * SDK health (2026-10-26): every problem has its own Fix; Fix all confirms
 * once, then runs secrets → install → upgrade → CSP and shows each result;
 * a forbidden secrets write hands over the key and commands; checks that
 * could not run are listed as "Not checked".
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
const page = vi.hoisted(() => ({ data: null as unknown, reload: vi.fn() }))
const upgrade = vi.hoisted(() => ({ state: { status: 'idle' } as Record<string, unknown> }))

vi.mock('../lib/supabase', () => api)
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({ data: page.data, loading: false, isValidating: false, error: null, errorMessage: null, reload: page.reload }),
}))
vi.mock('../lib/useSdkUpgrade', () => ({
  useSdkUpgrade: () => ({
    state: upgrade.state,
    createUpgradePr: async () => {
      calls.order.push('upgrade')
    },
  }),
}))

import { SdkHealthPanel } from './SdkHealthPanel'
import { fixAllPlan, sdkHealthHref, type SdkHealthProblem } from '../lib/sdkHealth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'

const problem = (id: SdkHealthProblem['id'], fix: SdkHealthProblem['fix'], severity: SdkHealthProblem['severity'] = 'error'): SdkHealthProblem => ({
  id,
  severity,
  title: `title ${id}`,
  detail: `detail ${id}`,
  fix,
})

const ALL = [
  problem('csp_blocks_api', { kind: 'csp_task', label: 'File CSP task' }),
  problem('not_installed', { kind: 'install_task', label: 'File install task' }),
  problem('ci_secrets_missing', { kind: 'sync_ci_secrets', label: 'Write CI secrets' }),
  problem('outdated', { kind: 'upgrade_pr', label: 'Open upgrade PR' }, 'warn'),
  problem('stale', null, 'info'),
]

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined

describe('fixAllPlan', () => {
  it('runs secrets, install, upgrade, then CSP, each kind once', () => {
    expect(fixAllPlan(ALL)).toEqual(['sync_ci_secrets', 'install_task', 'upgrade_pr', 'csp_task'])
    expect(fixAllPlan([...ALL, problem('never_seen', { kind: 'sync_ci_secrets', label: 'x' })])).toHaveLength(4)
    expect(fixAllPlan([problem('stale', null)])).toEqual([])
  })

  it('links the header chip to the panel on the Connect page', () => {
    expect(sdkHealthHref(PROJECT)).toBe(`/connect?project=${PROJECT}#connect-sdk-health`)
  })
})

describe('SdkHealthPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    calls.order = []
    upgrade.state = { status: 'idle' }
    api.apiFetch.mockReset()
    api.apiFetchMutate.mockReset()
    api.apiFetchMutate.mockImplementation(async (path: string, opts: { body: string }) => {
      if (path.endsWith('/sync-ci-secrets')) {
        calls.order.push('sync')
        return { ok: true, data: { minted: { prefix: 'mushi_abc', rawKey: 'mushi_secret' }, written: ['VITE_MUSHI_API_KEY'], failed: [], fallback: { commands: [], envBlock: '' }, priorKeysRevoked: [] } }
      }
      const kind = JSON.parse(opts.body).kind as string
      calls.order.push(kind)
      return { ok: true, data: { reportId: `r-${kind}`, existing: false } }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount(problems: SdkHealthProblem[], notes: Array<{ check: string; detail: string }> = []) {
    page.data = { problems, notes, installed: false, lastSeenAt: null, repoUrl: null, siteUrl: null, checkedAt: '2026-10-26T00:00:00Z' }
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(SdkHealthPanel, { projectId: PROJECT })))
    })
    await flush()
  }

  it('shows each problem with its own Fix button', async () => {
    await mount(ALL)
    for (const label of [/File CSP task/, /File install task/, /Write CI secrets/, /Open upgrade PR/]) expect(button(label)).toBeTruthy()
    expect(document.body.textContent).toContain('5 problems found.')
  })

  it('Fix all confirms once, then runs every fix in order and shows each result', async () => {
    await mount(ALL)
    act(() => button(/Fix all \(4\)/)!.click())
    expect(api.apiFetchMutate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Older CI keys are revoked once GitHub accepts the new one.')
    act(() => Array.from(document.body.querySelectorAll('button')).filter((b) => /^Fix all$/.test(b.textContent ?? '')).pop()!.click())
    await flush()
    expect(calls.order).toEqual(['sync', 'install', 'upgrade', 'csp'])
    const text = document.body.textContent ?? ''
    expect(text).toContain('Wrote VITE_MUSHI_API_KEY.')
    expect(text).toContain('Task filed: your fix agent picks it up and opens the PR.')
    const links = Array.from(document.body.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toContain('/reports/r-install')
    expect(links).toContain('/reports/r-csp')
  })

  it('a single task files straight away; writing secrets asks first', async () => {
    await mount(ALL)
    act(() => button(/File install task/)!.click())
    await flush()
    expect(calls.order).toEqual(['install'])
    act(() => button(/Write CI secrets/)!.click())
    expect(document.body.textContent).toContain('Write new CI secrets to GitHub?')
    expect(calls.order).toEqual(['install'])
  })

  it('a forbidden secrets write shows the key once and the commands to run', async () => {
    api.apiFetchMutate.mockResolvedValue({
      ok: false,
      error: { code: 'GH_SECRETS_FORBIDDEN', message: '403' },
      data: { minted: { prefix: 'mushi_abc', rawKey: 'mushi_secret' }, written: [], failed: [], fallback: { commands: ['gh secret set VITE_MUSHI_API_KEY --body "<your-mushi-project-api-key>" --repo a/b'], envBlock: '' } },
    })
    await mount([ALL[2]])
    act(() => button(/Write CI secrets/)!.click())
    act(() => button(/Write secrets/)!.click())
    await flush()
    const text = document.body.textContent ?? ''
    expect(text).toContain("GitHub didn't let Mushi write secrets")
    expect(text).toContain('mushi_secret')
    expect(text).toContain('gh secret set VITE_MUSHI_API_KEY')
  })

  it('a failed task says why and keeps the rest of the panel', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'TASK_NOT_FILED', message: 'The task was not filed: check constraint' } })
    await mount([ALL[1]])
    act(() => button(/File install task/)!.click())
    await flush()
    expect(document.body.textContent).toContain('The task was not filed: check constraint')
  })

  it('lists checks that could not run', async () => {
    await mount([], [{ check: 'site_csp', detail: 'No live site address is known.' }])
    const text = document.body.textContent ?? ''
    expect(text).toContain('No SDK problems found.')
    expect(text).toContain('Not checked')
    expect(text).toContain('Site security policy: No live site address is known.')
    expect(button(/Fix all/)).toBeUndefined()
  })
})
