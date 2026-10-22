/**
 * @vitest-environment jsdom
 *
 * /ci "Where CI runs" (ADR 0037): the agreement banner (or the import link),
 * GitHub-hosted greyed out on a private repo with the agreement's reason,
 * standby labels never offered, an external controller's repo read-only, a
 * preview that changes nothing, a request, and the owner/admin approve →
 * run → revert steps; members can ask but not decide; "All apps" asks for
 * one app.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placementFixture, previewFixture, PROJECT } from './__fixtures__/ciPlacement'
import type { PlacementRequestRow } from '../../lib/ciPlacementTypes'

const state = vi.hoisted(() => ({ data: null as unknown, paths: [] as Array<string | null>, reload: vi.fn(), apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: state.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: path ? state.data : null, loading: false, error: null, isValidating: false, reload: state.reload, lastFetchedAt: null }
  },
}))

import { CiPlacementSection } from './CiPlacementSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = placementFixture()
  state.paths = []
  state.reload.mockReset()
  state.apiFetch.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(scope: 'project' | 'all' = 'project') {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CiPlacementSection, { projectId: PROJECT, scope })))
  })
}

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement
const button = (text: string, within: ParentNode = host) => Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
const radio = (text: string, within: ParentNode) => Array.from(within.querySelectorAll('label')).find((l) => l.textContent?.includes(text))?.querySelector('input') as HTMLInputElement
async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    el.click()
  })
}

const req = (over: Partial<PlacementRequestRow>): PlacementRequestRow => ({
  id: 'r1',
  project_id: PROJECT,
  action: 'set_actions_variable',
  payload: previewFixture().payload!,
  payload_sha256: 'abcdef0123456789'.repeat(4),
  reason: null,
  status: 'pending_approval',
  requested_by: 'user:u1',
  requested_at: '2026-10-22T12:00:00Z',
  approved_by: null,
  approved_at: null,
  expires_at: null,
  executed_at: null,
  result: null,
  error: null,
  ...over,
})

describe('CiPlacementSection', () => {
  it('asks for one app under All apps', async () => {
    await render('all')
    expect(host.textContent).toContain('Pick one app')
  })

  it('shows the agreement, greys out GitHub-hosted on a private repo with the reason, and hides standby labels', async () => {
    await render()
    expect(state.paths[0]).toBe(`/v1/admin/ci/placement?project_id=${PROJECT}`)
    expect(host.textContent).toContain('No paid GitHub-hosted minutes on private repos (except AtPeak-Co-Ltd/pck, kensaurus/mushi-mushi)')
    const card = q('ci-placement-repo-kensaurus/yen-yen')
    expect(card.textContent).toContain('Now: GitHub-hosted (ubuntu-24.04): no variable set')
    expect(radio('GitHub-hosted', card).disabled).toBe(true)
    expect(card.textContent).toContain('Your CI agreement says no paid GitHub-hosted minutes on private repos (CI-AGREEMENT.md, 2026-10-22).')
    expect(card.textContent).toContain('kensaurus-local')
    expect(card.textContent).not.toContain('kensaurus-local-yen-yen-1')
  })

  it('shows an external controller\'s repo read-only, with no controls', async () => {
    await render()
    const card = q('ci-placement-repo-kensaurus/tsumagoi')
    expect(card.textContent).toContain('Managed by kci dispatcher (sbc-visual)')
    expect(card.querySelectorAll('input').length).toBe(0)
  })

  it('previews (nothing changes), then asks for the change', async () => {
    state.apiFetch.mockImplementation(async (path: string) => (path.endsWith('/preview') ? { ok: true, data: previewFixture() } : { ok: true, data: { id: 'r9' } }))
    await render()
    const card = q('ci-placement-repo-kensaurus/yen-yen')
    await click(radio('Self-hosted: kensaurus-local', card))
    await click(button('Preview', card))
    const [path, init] = state.apiFetch.mock.calls[0]!
    expect(path).toBe('/v1/admin/ci/placement/preview')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ projectId: PROJECT, repo: 'kensaurus/yen-yen', variable: 'LINUX_RUNNER', value: 'kensaurus-local' })
    const preview = q('ci-placement-preview').textContent!
    expect(preview).toContain('GitHub-hosted (ubuntu-24.04) → Self-hosted: kensaurus-local')
    expect(preview).toContain('Moves (1)')
    expect(preview).toContain('main and Dependabot runs stay on GitHub')
    expect(preview).toContain('Visual — Pinned to GitHub: pixel baselines')
    expect(preview).toContain('−$4.20')
    expect(preview).toContain('(estimated)')
    await click(button('Ask for this change', card))
    expect(state.apiFetch.mock.calls[1]![0]).toBe('/v1/admin/ci/placement/requests')
    expect(state.reload).toHaveBeenCalled()
    expect(card.textContent).toContain('Requested. Approve it below, then run it.')
  })

  it('a blocked preview shows why and offers no request', async () => {
    state.apiFetch.mockResolvedValue({ ok: true, data: previewFixture({ blocked: { code: 'POLICY_STANDBY_TARGET', message: '“x” is a standby runner.' }, payload: null }) })
    await render()
    const card = q('ci-placement-repo-kensaurus/yen-yen')
    await click(radio('Another label', card))
    const input = card.querySelector('input[type="text"], input:not([type])') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'x')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Preview', card))
    expect(card.querySelector('[role="alert"]')!.textContent).toContain('is a standby runner')
    expect(button('Ask for this change', card)).toBeUndefined()
  })

  it('owners approve the exact payload, run it, and can ask to revert', async () => {
    state.apiFetch.mockResolvedValue({ ok: true, data: {} })
    state.data = placementFixture({ requests: [req({})] })
    await render()
    const open = q('ci-placement-open')
    expect(open.textContent).toContain('Waiting for approval')
    expect(open.textContent).toContain('hash abcdef012345')
    await click(button('Approve', open))
    expect(state.apiFetch.mock.calls[0]![0]).toBe('/v1/admin/ci/placement/requests/r1/approve')
    expect(JSON.parse(String((state.apiFetch.mock.calls[0]![1] as RequestInit).body))).toEqual({ payloadSha256: 'abcdef0123456789'.repeat(4) })

    state.data = placementFixture({ requests: [req({ status: 'approved', expires_at: new Date(Date.now() + 40 * 60_000).toISOString() })] })
    await render()
    expect(q('ci-placement-open').textContent).toMatch(/expires in (39|40) min/)
    await click(button('Run it now'))
    expect(state.apiFetch.mock.calls.at(-1)![0]).toBe('/v1/admin/ci/placement/requests/r1/execute')

    state.data = placementFixture({ requests: [req({ status: 'executed' })], watches: [{ id: 'w1', action_id: 'r1', repo: 'kensaurus/yen-yen', variable: 'LINUX_RUNNER', previous_value: null, new_value: 'kensaurus-local', status: 'alert', jobs_seen: 2, unexpected: 1, slow: 0, started_at: '2026-10-22T12:00:00Z', revert_action_id: null }] })
    await render()
    expect(q('ci-placement-watches').textContent).toContain('A job landed elsewhere or waited long')
    expect(q('ci-placement-watches').textContent).toContain('1 on another runner')
    await click(button('Ask to revert'))
    expect(state.apiFetch.mock.calls.at(-1)![0]).toBe('/v1/admin/ci/placement/requests/r1/revert')
  })

  it('shows a refused run with the server\'s reason', async () => {
    state.apiFetch.mockResolvedValue({ ok: false, error: { code: 'VARIABLE_MOVED', message: 'LINUX_RUNNER changed after the preview.' } })
    state.data = placementFixture({ requests: [req({ status: 'approved', expires_at: new Date(Date.now() + 40 * 60_000).toISOString() })] })
    await render()
    await click(button('Run it now'))
    expect(q('ci-placement-open').querySelector('[role="alert"]')!.textContent).toContain('changed after the preview')
  })

  it('members can ask but not decide; viewers cannot ask', async () => {
    state.data = placementFixture({ canDecide: false, requests: [req({})] })
    await render()
    expect(button('Approve')).toBeUndefined()
    expect(q('ci-placement-repo-kensaurus/yen-yen').querySelector('fieldset')).not.toBeNull()
    state.data = placementFixture({ canDecide: false, canRequest: false })
    await render()
    expect(q('ci-placement-repo-kensaurus/yen-yen').querySelector('fieldset')).toBeNull()
  })

  it('offers the import link without an agreement, and warns without a token', async () => {
    state.data = placementFixture({ policy: null, tokenStored: false })
    await render()
    const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent?.includes('Import from your CI agreement'))!
    expect(link.getAttribute('href')).toBe('/settings?tab=ci-policy')
    expect(host.textContent).toContain('No GitHub token is stored')
    expect(radio('GitHub-hosted', q('ci-placement-repo-kensaurus/yen-yen')).disabled).toBe(false)
  })
})
