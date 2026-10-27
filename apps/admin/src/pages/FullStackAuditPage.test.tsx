/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27, Full-stack audit: the page said "At least 9
 * errors, 9 warnings in 4 checks" with nothing to act on. It now leads with
 * one sentence from the server's exact counts, offers "Copy fix prompt" for
 * the top finding and for every finding in the list, and only says "at
 * least" when it has no exact count, with the reason.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FullstackAuditStats } from '../components/fullstack-audit/FullstackAuditStatsTypes'

const mocks = vi.hoisted(() => ({
  stats: null as FullstackAuditStats | null,
  findings: null as unknown,
}))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(), invalidateApiCache: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null, errorCode: null }
    if (path?.startsWith('/v1/admin/fullstack-audit/stats')) return { ...base, data: mocks.stats }
    if (path?.startsWith('/v1/admin/inventory/p1/findings')) return { ...base, data: mocks.findings }
    return { ...base, data: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ children }: { children?: unknown }) => createElement('header', null, children as never),
}))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: { guide: 1 } }))

import { FullStackAuditPage, auditStatus } from './FullStackAuditPage'
import { findingFixPrompt } from '../components/gates/CopyFixPromptButton'
import { EMPTY_FULLSTACK_AUDIT_STATS } from '../components/fullstack-audit/FullstackAuditStatsTypes'

const STATS: FullstackAuditStats = {
  ...EMPTY_FULLSTACK_AUDIT_STATS,
  hasAnyProject: true,
  projectId: 'p1',
  errorCount: 9,
  warnCount: 9,
  topPriority: 'failures',
}

const now = new Date().toISOString()
const FINDINGS = {
  runs: [{ id: 'r1', gate: 'api_contract', status: 'fail', started_at: now, completed_at: now }],
  findings: [
    { id: 'f1', gate_run_id: 'r1', severity: 'warn', message: 'Response has no total', file_path: 'src/a.ts', line: 3, rule_id: null },
    { id: 'f2', gate_run_id: 'r1', severity: 'error', message: 'POST /orders body does not match', file_path: 'src/orders.ts', line: 41, rule_id: null },
  ],
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(FullStackAuditPage)))
  })
}

describe('auditStatus', () => {
  it('states exact counts, never "at least"', () => {
    const s = auditStatus(STATS)
    expect(s.tone).toBe('danger')
    expect(s.sentence).toContain('9 errors and 9 warnings are open')
    expect(s.sentence).not.toMatch(/at least/i)
  })

  it('never calls a failed read healthy', () => {
    expect(auditStatus({ ...STATS, topPriority: 'unknown', readError: 'timeout' })).toEqual({
      tone: 'warn',
      sentence: 'Mushi could not count the open findings: timeout. The list below may still load.',
    })
  })

  it('says a check that could not finish is unknown, not a pass', () => {
    const s = auditStatus({ ...STATS, errorCount: 0, warnCount: 0, failedGateCount: 1, topPriority: 'failures' })
    expect(s.tone).toBe('warn')
    expect(s.sentence).toContain('1 check could not finish')
  })
})

describe('findingFixPrompt', () => {
  it('names the check, the file and line, and what to do', () => {
    const text = findingFixPrompt({ gate: 'api_contract', message: 'POST /orders body does not match', file_path: 'src/orders.ts', line: 41 })
    expect(text).toContain('"API contract" check found a problem in src/orders.ts (line 41): POST /orders body does not match.')
    expect(text).toContain('run the tests')
  })
})

describe('FullStackAuditPage', () => {
  it('leads with the status sentence and copies a fix prompt for the worst finding', async () => {
    mocks.stats = STATS
    mocks.findings = FINDINGS
    await render()
    const status = host.querySelector('[data-testid="audit-status"]')!
    expect(status.textContent).toContain('9 errors and 9 warnings are open')
    const copy = status.querySelector<HTMLButtonElement>('[data-testid="copy-fix-prompt"]')!
    await act(async () => copy.click())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('src/orders.ts (line 41)'))
    // The list totals use the same exact counts.
    expect(host.querySelector('[data-testid="gate-findings-totals"]')?.textContent).toBe('9 errors · 9 warnings open in 1 check')
    // Every finding in the list can be copied too.
    expect(host.querySelectorAll('[data-testid="copy-fix-prompt"]').length).toBe(3)
  })

  it('lists dependency holes once: the check row points to the Known holes card instead of repeating them', async () => {
    mocks.stats = STATS
    mocks.findings = {
      runs: [...FINDINGS.runs, { id: 'r2', gate: 'portfolio_radar_vulns', status: 'fail', started_at: now, completed_at: now }],
      findings: [
        ...FINDINGS.findings,
        { id: 'v1', gate_run_id: 'r2', severity: 'error', message: 'next 16.3.8 has 3 known security holes', file_path: 'pnpm-lock.yaml', line: null, rule_id: 'known_vulnerable_dependency' },
      ],
    }
    await render()
    const row = host.querySelector('[data-testid="gate-shown-elsewhere"]')!
    expect(row.textContent).toContain('1 open')
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/#dependency-holes')
    // The hole itself is not listed as a finding card a second time.
    expect(host.textContent).not.toContain('next 16.3.8 has 3 known security holes')
  })
})
