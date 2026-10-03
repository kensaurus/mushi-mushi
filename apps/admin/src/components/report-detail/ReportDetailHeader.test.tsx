/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/ReportDetailHeader.test.tsx
 * PURPOSE: The header says whether a merged fix runs in production
 *          (completeness gap #10): "Fixed — not live yet (prod is on <sha>)"
 *          vs "Fixed and live", from `deploy_live` on the report detail.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportDeployLive, ReportDetail } from './types'

vi.mock('../../lib/reportPresence', () => ({ useReportPresence: () => ({ others: [] }) }))

import { ReportDetailHeader } from './ReportDetailHeader'
import { deployLiveLabel } from './deployLive'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function report(overrides: Partial<ReportDetail>): ReportDetail {
  return {
    id: 'c0e99783-a48f-43bf-9fd9-84708dec1a3c',
    project_id: '11111111-2222-4333-8444-555555555555',
    project_name: 'glot.it',
    description: 'Checkout button does nothing',
    summary: 'Checkout button does nothing',
    category: 'bug',
    severity: 'high',
    status: 'fixed',
    reporter_token_hash: 'rk1_abc',
    environment: {},
    created_at: '2026-10-01T10:00:00Z',
    session_id: null,
    end_user_id: null,
    ...overrides,
  } as ReportDetail
}

const PROD = '9999999aaaaaaabbbbbbbcccccccdddddddeeeee'

function live(overrides: Partial<ReportDeployLive>): ReportDeployLive {
  return {
    state: 'live',
    merged_at: '2026-10-02T10:00:00Z',
    prod_commit: PROD,
    target_id: 'web',
    checked_at: '2026-10-03T03:34:00Z',
    reason: 'Every deploy target runs the default-branch commit that has the fix.',
    ...overrides,
  }
}

function render(r: ReportDetail): HTMLElement | null {
  act(() =>
    root.render(createElement(MemoryRouter, null, createElement(ReportDetailHeader, { report: r, reporterShort: 'abc123' }))),
  )
  return container.querySelector('[data-testid="deploy-live"]')
}

describe('ReportDetailHeader deploy chip', () => {
  it('says "Fixed — not live yet (prod is on <sha>)" with the short prod commit', () => {
    const chip = render(
      report({ deploy_live: live({ state: 'not_live', reason: 'web still runs an older commit than the default branch, which has the fix.' }) }),
    )
    expect(chip?.textContent).toBe('Fixed — not live yet (prod is on 9999999)')
    expect(chip?.parentElement?.getAttribute('title')).toContain('web still runs an older commit')
    expect(chip?.parentElement?.getAttribute('title')).toContain('Target: web.')
  })

  it('says "Fixed and live" once production runs the fix', () => {
    expect(render(report({ deploy_live: live({}) }))?.textContent).toBe('Fixed and live')
  })

  it('does not claim live when the deploy state is unknown', () => {
    const chip = render(report({ deploy_live: live({ state: 'unknown', prod_commit: null, target_id: null, reason: 'Deploys have not been checked since this fix merged.' }) }))
    expect(chip?.textContent).toBe('Fixed — live status unknown')
    expect(chip?.parentElement?.getAttribute('title')).toBe('Deploys have not been checked since this fix merged.')
  })

  it('renders no chip when no fix merged', () => {
    expect(render(report({ deploy_live: null, status: 'classified' }))).toBeNull()
    expect(render(report({ status: 'classified' }))).toBeNull()
  })
})

describe('deployLiveLabel', () => {
  it('omits the sha when no observation named one', () => {
    expect(deployLiveLabel(live({ state: 'not_live', prod_commit: null }))).toBe('Fixed — not live yet')
  })
})
