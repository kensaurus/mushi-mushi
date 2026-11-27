/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/releases/SecurityProofPanel.test.tsx
 * PURPOSE: A release's Security proof reads honestly: a proven release shows
 *          its lanes and a drill-down to findings (with why one has no report
 *          of its own), a release with no commit offers to pin it (one PUT),
 *          and an unapplied migration is a calm notice, never an error.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => api)

import { SecurityProofPanel } from './SecurityProofPanel'

const PID = '11111111-1111-4111-8111-111111111111'
const RID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-11-27T10:00:00Z'

const counts = (over: Record<string, number> = {}) => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0, ...over })
const run = (lane: string) => ({ id: `r-${lane}`, lane, tool: 'osv-scanner', commit_sha: 'abc1234', ref: 'main', event: 'pull_request', status: 'passed', skip_reason: null, counts: {}, run_url: 'https://github.com/o/r/actions/runs/1', target_url: null, finished_at: NOW })

function proof(over: Record<string, unknown> = {}) {
  return {
    state: 'proven',
    headline: 'Security proof: scans green for abc1234.',
    commitSha: 'abc1234',
    workflowPath: '.github/workflows/mushi-security.yml',
    release: { id: RID, version: '1.2.0', commitSha: 'abc1234' },
    lanes: [
      { lane: 'dependencies', label: 'Dependencies', required: true, state: 'findings', tone: 'warn', detail: '1 finding.', run: run('dependencies'), counts: counts({ medium: 1, total: 1 }), runs: [run('dependencies')] },
      { lane: 'secrets', label: 'Secrets', required: true, state: 'passed', tone: 'ok', detail: 'Clean.', run: run('secrets'), counts: counts(), runs: [run('secrets')] },
      { lane: 'ai_review', label: 'AI review', required: false, state: 'off', tone: 'neutral', detail: 'Off.', run: null, counts: counts(), runs: [] },
      { lane: 'dast', label: 'Live site (DAST)', required: false, state: 'off', tone: 'neutral', detail: 'Not set up.', run: null, counts: counts(), runs: [] },
    ],
    findings: [
      { id: 'f1', lane: 'dependencies', severity: 'medium', title: 'lodash 4.17.20: prototype pollution', rule_id: 'GHSA-xxxx-xxxx-xxxx', location: { file: 'pnpm-lock.yaml' }, report_id: '33333333-3333-4333-8333-333333333333', deduped_by: 'vuln_watch' },
    ],
    ...over,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SecurityProofPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetchMutate.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(canEdit = true) {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SecurityProofPanel, { projectId: PID, releaseId: RID, canEdit })))
      await flush()
    })
  }

  it('shows the lanes of a proven release and drills into a lane\'s findings', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: proof() })
    await render()
    expect(api.apiFetch).toHaveBeenCalledWith(`/v1/admin/projects/${PID}/security-proof?release=${RID}`, { cache: 'no-store' })
    expect(container.textContent).toContain('Proven')
    expect(container.querySelectorAll('[data-testid^="lane-"]')).toHaveLength(4)
    expect(container.querySelector('[data-testid="lane-dependencies"]')!.textContent).toContain('1 medium')
    expect(container.querySelector('[data-testid="lane-ai_review"]')!.textContent).toContain('Off')
    expect(container.querySelector('[data-testid="lane-detail"]')).toBeNull()

    const details = [...container.querySelector('[data-testid="lane-dependencies"]')!.querySelectorAll('button')].find((b) => b.textContent === 'Details')!
    expect(details.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      details.click()
      await flush()
    })
    const detail = container.querySelector('[data-testid="lane-detail"]')!
    expect(detail.textContent).toContain('lodash 4.17.20')
    expect(detail.textContent).toContain('Already tracked by Known holes')
    expect(detail.querySelector('a[href="/reports/33333333-3333-4333-8333-333333333333"]')).not.toBeNull()
    expect(container.textContent).toContain('gh workflow run mushi-security.yml -f sha=abc1234')
  })

  it('offers to pin a release that names no commit, with one PUT', async () => {
    api.apiFetch.mockResolvedValue({
      ok: true,
      data: proof({ state: 'not_pinned', commitSha: null, headline: 'Not pinned to a commit.', findings: [], release: { id: RID, version: '1.2.0', commitSha: null } }),
    })
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
    await render()
    expect(container.textContent).toContain('Not pinned')
    const input = container.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      setInput(input, '4D193533')
      await flush()
    })
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await flush()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledWith(`/v1/admin/projects/${PID}/releases/${RID}/commit`, { method: 'PUT', body: JSON.stringify({ commit_sha: '4d193533' }) })
    // Re-read after pinning.
    expect(api.apiFetch).toHaveBeenCalledTimes(2)
  })

  it('reads an unapplied migration as a calm notice', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { code: 'MIGRATION_PENDING', message: 'not applied' } })
    await render()
    expect(container.textContent).toContain('not switched on for this server yet')
    expect(container.textContent).not.toContain('Proven')
  })
})
