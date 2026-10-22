/**
 * @vitest-environment jsdom
 *
 * Settings → Verified merge (Plan 024, ADR 0035): automatic merge is off by
 * default and says exactly when Mushi merges; a save sends only the changed
 * fields; runner labels are suggested from the /ci runners and added with a
 * click; bad input is explained inline and blocks Save; a refused save shows
 * the server's field errors; the workflow can be copied (with a select-all
 * fallback) or added by a PR; viewers see everything read-only.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ciOverviewFixture } from '../ci/__fixtures__/ciOverview'
import type { VerifySettingsResponse } from '../../lib/verifyTypes'

const state = vi.hoisted(() => ({
  settings: null as unknown,
  settingsError: null as null | { code: string; message: string },
  role: 'owner',
  reload: vi.fn(),
  apiFetch: vi.fn(),
  apiFetchMutate: vi.fn(),
  paths: [] as Array<string | null>,
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: state.apiFetch, apiFetchMutate: state.apiFetchMutate }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    const page = (data: unknown) => ({
      data,
      loading: false,
      error: null,
      errorCode: null,
      errorMessage: null,
      isValidating: false,
      lastFetchedAt: 't1',
      reload: state.reload,
    })
    if (path === '/v1/org') return page({ organizations: [{ id: 'org1', role: state.role }] })
    if (path?.endsWith('/verify-settings')) {
      const err = state.settingsError
      return err
        ? { ...page(null), error: `${err.message} (${err.code})`, errorCode: err.code, errorMessage: err.message }
        : page(state.settings)
    }
    if (path?.startsWith('/v1/admin/ci/overview')) return page(ciOverviewFixture())
    return page(null)
  },
}))
vi.mock('../../lib/activeOrg', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useActiveOrgSignal: () => 'org1',
}))
vi.mock('../../lib/crossTeamProject', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  knownProjectTeam: () => null,
}))

import { VerifiedMergeCard } from './VerifiedMergeCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SETTINGS: VerifySettingsResponse = {
  verified_auto_merge: false,
  verified_auto_merge_daily_limit: 5,
  verify_runs_on: ['ubuntu-latest'],
  verify_test_command: 'pnpm vitest run {files}',
  verify_max_files: 3,
  verify_max_lines: 150,
  verify_protected_globs: [],
  verify_second_judge: 'auto',
  verify_second_judge_model: null,
  auto_revert: 'pr',
  workflowInstalled: false,
  secondJudgeKey: { provider: 'OpenAI', label: 'team key' },
}

const YAML = 'name: Mushi verify\non: pull_request\n'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.settings = { ...SETTINGS }
  state.settingsError = null
  state.role = 'owner'
  state.paths = []
  state.reload.mockReset()
  state.apiFetch.mockReset()
  state.apiFetchMutate.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(VerifiedMergeCard, { projectId: 'p1' })))
  })
}

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const toggle = () =>
  host.querySelector('[role="switch"][aria-label="Merge proven fixes automatically"]') as HTMLButtonElement
const button = (text: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    el.click()
  })
}

async function type(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
  if (!el) throw new Error(`no field ${selector}`)
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function putBody(): unknown {
  const call = state.apiFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null
}

describe('VerifiedMergeCard', () => {
  it('is off by default, says when Mushi merges, and saves only the toggle', async () => {
    state.apiFetch.mockResolvedValue({ ok: true, data: { ...SETTINGS, verified_auto_merge: true } })
    await render()
    expect(state.paths).toContain('/v1/admin/projects/p1/verify-settings')
    expect(state.paths).toContain('/v1/admin/ci/overview?project_id=p1&days=7')
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).toContain('Off: nothing merges without you.')
    expect(host.textContent).toContain('only when every check passes on its latest commit')
    expect(button('Save changes')).toBeUndefined()

    await click(toggle())
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('On: up to 5 merges a day for this app.')
    expect(host.textContent).toContain('1 unsaved change')
    await click(button('Save changes'))

    const put = state.apiFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')!
    expect(put[0]).toBe('/v1/admin/projects/p1/verify-settings')
    expect(putBody()).toEqual({ verified_auto_merge: true })
    expect(state.reload).toHaveBeenCalled()
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('Saved.')
    expect(button('Save changes')).toBeUndefined()
  })

  it('suggests runner labels from /ci and adds one with a click', async () => {
    state.apiFetch.mockResolvedValue({ ok: true, data: null })
    await render()
    const suggested = Array.from(q('verify-label-suggestions')!.querySelectorAll('button')).map((b) =>
      b.getAttribute('data-testid'),
    )
    expect(suggested).toEqual(['verify-suggest-nuc', 'verify-suggest-nuc-glot', 'verify-suggest-aw-1', 'verify-suggest-mystery'])

    await click(q('verify-suggest-nuc'))
    expect(q('verify-label-nuc')).not.toBeNull()
    expect(q('verify-suggest-nuc')).toBeNull()

    await click(host.querySelector('[aria-label="Remove ubuntu-latest"]') as HTMLElement)
    expect(q('verify-label-ubuntu-latest')).toBeNull()

    await click(button('Save changes'))
    expect(putBody()).toEqual({ verify_runs_on: ['nuc'] })
  })

  it('adds a typed label with Enter and explains a bad one inline', async () => {
    await render()
    await type('[id="add-a-label"]', 'has space')
    await click(button('Add'))
    expect(host.textContent).toContain('"has space" is not a runner label')
    expect(q('verify-label-has space')).toBeNull()

    await type('[id="add-a-label"]', 'alienware-glot-1')
    const input = host.querySelector('[id="add-a-label"]') as HTMLInputElement
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(q('verify-label-alienware-glot-1')).not.toBeNull()
    expect(input.value).toBe('')
  })

  it('blocks Save on a command without {files} or a number out of range', async () => {
    await render()
    await type('#command', 'pnpm test')
    expect(host.textContent).toContain('Put {files} where the test files go')
    await type('#changed-lines', '5000')
    expect(host.textContent).toContain('Pick a whole number from 10 to 1000.')
    expect(button('Save changes')!.disabled).toBe(true)
    expect(host.textContent).toContain('Fix the fields marked above first.')

    await type('#command', 'pnpm vitest run {files}')
    await type('#changed-lines', '200')
    expect(button('Save changes')!.disabled).toBe(false)
    expect(host.textContent).toContain('1 unsaved change')
  })

  it("shows the server's field errors when it refuses a save", async () => {
    state.apiFetch.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid body',
        issues: [{ path: ['verify_max_files'], message: 'Must be 20 or fewer' }],
      },
    })
    await render()
    await type('#source-files', '4')
    await click(button('Save changes'))
    expect(host.textContent).toContain('Must be 20 or fewer')
    expect(host.textContent).toContain('Mushi did not save: fix the fields marked above.')
  })

  it('copies the workflow, falls back to a selected text box, and opens a PR', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    state.apiFetch.mockResolvedValue({ ok: true, data: { yaml: YAML, path: '.github/workflows/mushi-verify.yml' } })
    await render()
    expect(host.textContent).toContain('Not set up')

    await click(button('Copy workflow'))
    expect(state.apiFetch.mock.calls[0]![0]).toBe('/v1/admin/projects/p1/verify-workflow')
    expect(writeText).toHaveBeenCalledWith(YAML)
    expect(q('verify-workflow-notice')!.textContent).toContain('Copied.')

    writeText.mockRejectedValueOnce(new Error('denied'))
    await click(button('Copy workflow'))
    const box = host.querySelector('textarea[aria-label="Mushi verify workflow file"]') as HTMLTextAreaElement
    expect(box.value).toBe(YAML)
    expect(document.activeElement).toBe(box)

    state.apiFetchMutate.mockResolvedValue({ ok: true, data: { prUrl: 'https://github.com/a/b/pull/12', prNumber: 12 } })
    await click(button('Open a PR that adds it'))
    expect(state.apiFetchMutate).toHaveBeenCalledWith('/v1/admin/projects/p1/verify-workflow/pr', { method: 'POST' })
    expect(q('verify-workflow-pr')!.textContent).toContain('Pull request #12 opened.')
    expect(q('verify-workflow-pr')!.querySelector('a')!.getAttribute('href')).toBe('https://github.com/a/b/pull/12')
  })

  it('says which key the second review uses, or that none is there', async () => {
    await render()
    expect(q('verify-judge-key')!.textContent).toContain('Uses your OpenAI key “team key”.')
    act(() => root.unmount())
    root = createRoot(host)
    state.settings = { ...SETTINGS, secondJudgeKey: null }
    await render()
    expect(q('verify-judge-key')!.textContent).toContain('No OpenAI or OpenRouter key')
  })

  it('is read-only for a viewer', async () => {
    state.role = 'viewer'
    await render()
    expect(q('verified-merge-readonly')).not.toBeNull()
    expect(toggle().disabled).toBe(true)
    expect(q('verify-label-suggestions')).toBeNull()
    expect(host.querySelector('[id="add-a-label"]')).toBeNull()
    expect(host.querySelector('[aria-label="Remove ubuntu-latest"]')).toBeNull()
    expect((host.querySelector('#command') as HTMLInputElement).disabled).toBe(true)
    expect(button('Open a PR that adds it')).toBeUndefined()
    expect(button('Copy workflow')).toBeDefined()
  })

  it('waits for the server update when the route does not exist yet', async () => {
    state.settingsError = { code: 'NOT_FOUND', message: 'Not found' }
    await render()
    expect(host.textContent).toContain('Verified merge becomes available after the next server update.')
  })
})
