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
import { fixAllPlan, presentSdkHealthProblems, sdkHealthHref, type SdkHealthProblem } from '../lib/sdkHealth'

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

  // nativeApp: a store build runs in CI, so the missing-secrets row is stated, not asked.
  async function mount(problems: SdkHealthProblem[], notes: Array<{ check: string; detail: string }> = [], nativeApp = true) {
    page.data = { problems, notes, installed: false, lastSeenAt: null, repoUrl: null, siteUrl: null, checkedAt: '2026-10-26T00:00:00Z' }
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(SdkHealthPanel, { projectId: PROJECT, nativeApp })))
    })
    await flush()
  }

  it('shows each problem with its own Fix button', async () => {
    await mount(ALL)
    for (const label of [/File CSP task/, /File install task/, /Write CI secrets/, /Open upgrade PR/]) expect(button(label)).toBeTruthy()
    expect(document.body.textContent).toContain('5 problems found.')
  })

  it('asks a web app whether GitHub Actions builds it, instead of calling missing secrets a failure', async () => {
    const neverSeen: SdkHealthProblem = {
      ...problem('never_seen', null),
      detail: 'No build of this app has reached Mushi Mushi yet. The missing CI keys above are the likely cause: write them, then ship a new build.',
    }
    await mount([{ ...ALL[2]!, detail: 'VITE_MUSHI_API_KEY is not set in a/b.' }, ALL[1]!, ALL[3]!, neverSeen], [], false)
    const row = document.querySelector('[data-testid="sdk-health-problem-ci_secrets_missing"]')!.textContent ?? ''
    expect(row).toContain('Does GitHub Actions build this app?')
    expect(row).toContain('If Vercel, Netlify or another host builds it, GitHub needs nothing')
    // The bundler is unknown here, so no prefix is guessed.
    expect(row).not.toMatch(/VITE_|NEXT_PUBLIC_/)
    expect(button(/It does: write the keys to GitHub/)).toBeTruthy()
    expect(document.querySelector('[data-testid="sdk-health-problem-never_seen"]')!.textContent).not.toContain('missing CI keys')
    // Fix all leaves the question out: install task + upgrade PR only.
    expect(button(/Fix all \(2\)/)).toBeTruthy()
  })

  it('names the values the way the app builds them when the bundler is known', () => {
    const [p] = presentSdkHealthProblems([ALL[2]!], { nativeApp: false, bundler: 'next' })
    expect(p!.detail).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID and NEXT_PUBLIC_MUSHI_API_KEY')
    expect(p!.question).toBe(true)
    expect(presentSdkHealthProblems([ALL[2]!], { nativeApp: true, bundler: null })[0]).toEqual(ALL[2])
  })

  it('a never-seen app with only setup steps reads as steps left, not problems', async () => {
    await mount([ALL[1]!, ALL[2]!])
    const text = document.body.textContent ?? ''
    expect(text).toContain('2 steps left before this app sends bug reports.')
    expect(text).not.toContain('problems found')
    expect(document.body.querySelector('.bg-danger')).toBeNull()
  })

  it('Fix all confirms once, then runs every fix in order and shows each result', async () => {
    await mount(ALL)
    act(() => button(/Fix all \(4\)/)!.click())
    expect(api.apiFetchMutate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Older CI keys are revoked once GitHub accepts the new one')
    expect(document.body.textContent).toContain('Apps already in the store keep the old key until their next build')
    expect(document.body.textContent).toContain('Repo: no repo linked')
    act(() => Array.from(document.body.querySelectorAll('button')).filter((b) => /^Fix all$/.test(b.textContent ?? '')).pop()!.click())
    await flush()
    expect(calls.order).toEqual(['sync', 'install', 'upgrade', 'csp'])
    const text = document.body.textContent ?? ''
    expect(text).toContain('Wrote VITE_MUSHI_API_KEY.')
    // The preflight was not read (apiFetch mocked empty): no promise either way.
    expect(text).toContain('Task filed. Open it for the fix prompt to paste into your editor.')
    expect(text).not.toContain('your fix agent picks it up')
    const links = Array.from(document.body.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toContain('/reports/r-install#fix-prompt')
    expect(links).toContain('/reports/r-csp#fix-prompt')
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

  it('a successful secrets write hides the new key until Reveal key', async () => {
    await mount([ALL[2]])
    act(() => button(/Write CI secrets/)!.click())
    act(() => button(/Write secrets/)!.click())
    await flush()
    expect(document.body.textContent).not.toContain('mushi_secret')
    act(() => button(/Reveal key/)!.click())
    expect(document.querySelector('[data-testid="sdk-health-minted-key"]')!.textContent).toContain('mushi_secret')
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
    expect(text).toContain('GitHub refused the write: the Mushi Mushi GitHub App has no "Secrets: write" permission.')
    // The command carries the new key, so the person only pastes it.
    expect(text).toContain('gh secret set VITE_MUSHI_API_KEY --body "mushi_secret" --repo a/b')
  })

  it('a failed task says why and keeps the rest of the panel', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'TASK_NOT_FILED', message: 'The task was not filed: check constraint' } })
    await mount([ALL[1]])
    act(() => button(/File install task/)!.click())
    await flush()
    expect(document.body.textContent).toContain('The task was not filed: check constraint')
  })

  it('has stable test ids for the panel, each row, each Fix and Fix all', async () => {
    await mount(ALL)
    for (const id of ['sdk-health-panel', 'sdk-health-fix-all', 'sdk-health-problem-stale', 'sdk-health-fix-not_installed', 'sdk-health-fix-ci_secrets_missing', 'sdk-health-fix-outdated', 'sdk-health-fix-csp_blocks_api']) {
      expect(document.querySelector(`[data-testid="${id}"]`), id).toBeTruthy()
    }
    expect(document.querySelector('[data-testid="sdk-health-fix-stale"]')).toBeNull()
  })

  it('a double click files one task, and every button is disabled while a fix runs', async () => {
    let resolve: (v: unknown) => void = () => {}
    api.apiFetchMutate.mockImplementation(() => new Promise((r) => { resolve = r }))
    await mount(ALL)
    const fix = button(/File install task/)!
    act(() => {
      fix.click()
      fix.click()
    })
    await flush()
    expect(api.apiFetchMutate).toHaveBeenCalledTimes(1)
    expect(button(/File CSP task/)!.disabled).toBe(true)
    expect(button(/Fix all/)!.disabled).toBe(true)
    await act(async () => { resolve({ ok: true, data: { reportId: 'r-1', existing: false } }) })
    await flush()
    expect(button(/File CSP task/)!.disabled).toBe(false)
  })

  it('reads SDK health again after a fix, and keeps the result once its problem is gone', async () => {
    page.reload.mockImplementation(() => {
      page.data = { ...(page.data as object), problems: [ALL[0]] }
    })
    await mount([ALL[0], ALL[2]])
    act(() => button(/Write CI secrets/)!.click())
    act(() => button(/Write secrets/)!.click())
    await flush()
    expect(page.reload).toHaveBeenCalled()
    act(() => root.render(createElement(MemoryRouter, null, createElement(SdkHealthPanel, { projectId: PROJECT }))))
    await flush()
    expect(document.querySelector('[data-testid="sdk-health-problem-ci_secrets_missing"]')).toBeNull()
    const done = document.querySelector('[data-testid="sdk-health-done"]')!
    expect(done.textContent).toContain('Wrote VITE_MUSHI_API_KEY.')
    page.reload.mockReset()
  })

  it('an open upgrade PR is a link, not a second Fix', async () => {
    await mount([{ ...problem('outdated', null, 'warn'), link: { label: 'Open PR #10001', href: 'https://github.com/a/b/pull/10001' } }])
    const link = document.querySelector('[data-testid="sdk-health-link-outdated"]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://github.com/a/b/pull/10001')
    expect(document.querySelector('[data-testid="sdk-health-fix-outdated"]')).toBeNull()
  })

  it('says all good only when every check ran', async () => {
    await mount([])
    expect(document.body.textContent).toContain('No SDK problems found.')
  })

  it('no repo: Connect your GitHub repo stays in the console (no new tab)', async () => {
    await mount([{ ...problem('no_repo', null), link: { label: 'Connect your GitHub repo', href: `/connect?project=${PROJECT}#connect-github` } }])
    const link = document.querySelector('[data-testid="sdk-health-link-no_repo"]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/connect?project=${PROJECT}#connect-github`)
    expect(link.getAttribute('target')).toBeNull()
  })

  it('lists checks that could not run', async () => {
    await mount([], [{ check: 'site_csp', detail: 'No live site address is known.' }])
    const text = document.body.textContent ?? ''
    // Never "all good" while a check could not run.
    expect(text).not.toContain('No SDK problems found.')
    expect(text).toContain('0 problems')
    expect(text).toContain('1 not checked')
    // No green pass mark while a check did not run (round-2 review 2026-11-18).
    const tally = document.querySelector('[data-testid="sdk-health-tally"]')!
    expect(tally.querySelector('[data-tone="ok"]')).toBeNull()
    expect(tally.querySelector('[data-tone="off"]')).not.toBeNull()
    expect(text).not.toContain('No SDK problems found')
    // Said once, in the tally: no "Not checked" heading over the list (round-3 review).
    expect(text).not.toContain('Not checked')
    expect(text).toContain('Site security policy: No live site address is known.')
    expect(button(/Fix all/)).toBeUndefined()
  })

  // Owner, 2026-11-17: "Task filed: your fix agent picks it up and opens the
  // PR" while Autofix was off for the app and nothing was dispatched.
  describe('a filed task says what really happens next', () => {
    const preflightCheck = (key: string, ready: boolean) => ({ key, ready, label: key === 'codebase' ? 'Codebase indexed' : key, hint: '', fixHref: `/integrations/config#${key}` })
    function preflightIs(checks: Array<ReturnType<typeof preflightCheck>>) {
      api.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
        if (path.endsWith('/preflight')) return { ok: true, data: { ready: checks.every((c) => c.ready), checks } }
        if (path.endsWith('/autofix/toggle') && opts?.method === 'POST') return { ok: true, data: { autofix_enabled: true } }
        return { ok: false }
      })
    }

    it('Autofix off: says so, offers to turn it on here, and links the fix prompt', async () => {
      preflightIs([preflightCheck('github', true), preflightCheck('codebase', true), preflightCheck('agent', true), preflightCheck('autofix', false)])
      await mount([ALL[1]!])
      act(() => button(/File install task/)!.click())
      await flush()
      const text = document.body.textContent ?? ''
      expect(text).toContain('Task filed. Autofix is off for this app: turn it on, or copy the fix prompt into your editor.')
      expect(text).not.toContain('picks it up')
      const prompt = Array.from(document.querySelectorAll('a')).find((a) => a.textContent === 'Copy the fix prompt')!
      expect(prompt.getAttribute('href')).toBe('/reports/r-install#fix-prompt')
      act(() => button(/Turn on Autofix/)!.click())
      await flush()
      expect(api.apiFetch).toHaveBeenCalledWith(`/v1/admin/projects/${PROJECT}/autofix/toggle`, expect.objectContaining({ method: 'POST' }))
    })

    it('Autofix off and no GitHub: the button says to connect GitHub first', async () => {
      preflightIs([preflightCheck('github', false), preflightCheck('autofix', false)])
      await mount([ALL[1]!])
      act(() => button(/File install task/)!.click())
      await flush()
      expect(button(/Turn on Autofix/)).toBeUndefined()
      expect(Array.from(document.querySelectorAll('a')).some((a) => a.textContent === 'Connect GitHub first')).toBe(true)
    })

    it('everything ready: Mushi Mushi opens the draft PR', async () => {
      preflightIs([preflightCheck('github', true), preflightCheck('autofix', true)])
      await mount([ALL[1]!])
      act(() => button(/File install task/)!.click())
      await flush()
      expect(document.body.textContent).toContain('Task filed: Mushi Mushi starts the fix and opens it as a draft PR for you to review.')
    })

    it('Autofix on but another step missing: names it, never promises a PR', async () => {
      preflightIs([preflightCheck('github', true), preflightCheck('codebase', false), preflightCheck('autofix', true)])
      await mount([ALL[1]!])
      act(() => button(/File install task/)!.click())
      await flush()
      const text = document.body.textContent ?? ''
      expect(text).toContain("Mushi Mushi can't start the fix yet (codebase indexed is not done)")
      expect(text).not.toContain('draft PR')
    })
  })

  // Owner, 2026-11-17: the variables were written, the secret was not, and the
  // panel said only "Some names were not written: VITE_MUSHI_API_KEY".
  describe('a CI secrets write that only partly worked', () => {
    const CMDS = [
      'gh secret set VITE_MUSHI_API_KEY --body "<your-mushi-project-api-key>" --repo a/b',
      'gh variable set VITE_MUSHI_PROJECT_ID --body "p1" --repo a/b',
    ]
    beforeEach(() => {
      api.apiFetchMutate.mockResolvedValue({
        ok: true,
        data: {
          minted: { prefix: 'mushi_abc', rawKey: 'mushi_secret' },
          written: ['VITE_MUSHI_PROJECT_ID'],
          failed: [{ name: 'VITE_MUSHI_API_KEY', reason: 'GitHub returned 403 — token lacks Secrets/Variables write permission.' }],
          fallback: { commands: CMDS, envBlock: '' },
          priorKeysRevoked: [],
        },
      })
    })

    async function writePartially() {
      await mount([ALL[2]!])
      act(() => button(/Write CI secrets/)!.click())
      act(() => button(/Write secrets/)!.click())
      await flush()
    }

    it('says why, and gives only the missing command with the new key already in it', async () => {
      await writePartially()
      const box = document.querySelector('[data-testid="sdk-health-ci-manual"]')!
      expect(box.textContent).toContain('GitHub refused VITE_MUSHI_API_KEY: the Mushi Mushi GitHub App has no "Secrets: write" permission.')
      const codes = Array.from(box.querySelectorAll('code')).map((c) => c.textContent)
      expect(codes).toContain('gh secret set VITE_MUSHI_API_KEY --body "mushi_secret" --repo a/b')
      expect(codes.some((c) => c?.includes('gh variable set'))).toBe(false)
      expect(box.textContent).not.toContain('<your-mushi-project-api-key>')
    })

    it('Check again clears the warning once GitHub shows the secret set', async () => {
      await writePartially()
      page.data = { ...(page.data as object), problems: [], notes: [] }
      act(() => button(/Check again/)!.click())
      await flush()
      expect(document.querySelector('[data-testid="sdk-health-ci-manual"]')).toBeNull()
      expect(document.body.textContent).toContain('Every CI name is set in GitHub now.')
    })

    it('Check again, when the secrets cannot be read: no warning, the command kept under a fold', async () => {
      await writePartially()
      page.data = { ...(page.data as object), problems: [], notes: [{ check: 'ci_secrets', detail: 'Could not check the GitHub Actions secrets: 403' }] }
      act(() => button(/Check again/)!.click())
      await flush()
      expect(document.querySelector('[data-testid="sdk-health-ci-manual"]')).toBeNull()
      expect(document.querySelector('[data-testid="sdk-health-ci-unverifiable"]')!.textContent).toContain("can't confirm VITE_MUSHI_API_KEY")
    })

    it('never claims every name is set when the repo itself could not be read', async () => {
      await writePartially()
      page.data = { ...(page.data as object), problems: [], notes: [{ check: 'repo', detail: 'Could not read a/b: 403' }] }
      act(() => button(/Check again/)!.click())
      await flush()
      expect(document.body.textContent).not.toContain('Every CI name is set')
      expect(document.querySelector('[data-testid="sdk-health-ci-unverifiable"]')).toBeTruthy()
    })
  })
})
