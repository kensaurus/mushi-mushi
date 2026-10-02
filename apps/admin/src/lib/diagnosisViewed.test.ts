/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/diagnosisViewed.test.ts
 * PURPOSE: `recordDiagnosisViewed` is the single "a diagnosis became visible"
 *          emit: the product event once per report per session, the
 *          setup-funnel step only for sample reports, once per project.
 *
 * Why (2026-10-02): production had 0 `diagnosis_viewed` rows. Only the
 * onboarding screen emitted it, while most "Send test report" buttons toast
 * and send people to the report detail page, which emitted nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DiagnosisViewedModule from './diagnosisViewed'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const tracking = vi.hoisted(() => ({ trackSelf: vi.fn() }))

vi.mock('./supabase', () => api)
vi.mock('./track', () => tracking)

type Recorder = typeof DiagnosisViewedModule

/** A fresh module = a fresh page load; sessionStorage survives it. */
async function loadPage(): Promise<Recorder> {
  vi.resetModules()
  return import('./diagnosisViewed')
}

const PROJECT = '11111111-1111-4111-8111-111111111111'
const REPORT = '22222222-2222-4222-8222-222222222222'
const OTHER_REPORT = '33333333-3333-4333-8333-333333333333'

function funnelPosts(): unknown[][] {
  return api.apiFetch.mock.calls.filter(([path]) => String(path).endsWith('/setup-funnel/diagnosis-viewed'))
}

function views(): unknown[][] {
  return tracking.trackSelf.mock.calls.filter(([name]) => name === 'diagnosis_viewed')
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

beforeEach(() => {
  window.sessionStorage.clear()
  api.apiFetch.mockReset()
  api.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } })
  tracking.trackSelf.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recordDiagnosisViewed', () => {
  it('emits the taxonomy event with surface and sample', async () => {
    const { recordDiagnosisViewed } = await loadPage()
    recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'report_detail', sample: true })
    expect(views()).toEqual([
      ['diagnosis_viewed', { report_id: REPORT, project_id: PROJECT, surface: 'report_detail', sample: true }],
    ])
  })

  it('fires once per report per session, across page loads', async () => {
    const first = await loadPage()
    first.recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'overview', sample: true })
    first.recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'report_detail', sample: true })
    const second = await loadPage()
    second.recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'report_detail', sample: true })
    expect(views()).toHaveLength(1)

    second.recordDiagnosisViewed({ projectId: PROJECT, reportId: OTHER_REPORT, surface: 'report_detail', sample: false })
    expect(views()).toHaveLength(2)
  })

  it('still dedups within a page load when sessionStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { recordDiagnosisViewed } = await loadPage()
    recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'reports', sample: true })
    recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'reports', sample: true })
    expect(views()).toHaveLength(1)
  })

  it('writes the setup-funnel step for a sample report, once per project', async () => {
    const { recordDiagnosisViewed } = await loadPage()
    recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'report_detail', sample: true })
    recordDiagnosisViewed({ projectId: PROJECT, reportId: OTHER_REPORT, surface: 'report_detail', sample: true })
    await settle()
    expect(funnelPosts()).toHaveLength(1)
    const [path, init] = funnelPosts()[0] as [string, { method: string; body: string }]
    expect(path).toBe(`/v1/admin/projects/${PROJECT}/setup-funnel/diagnosis-viewed`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ reportId: REPORT })
  })

  it('never writes the setup-funnel step for a real report', async () => {
    const { recordDiagnosisViewed } = await loadPage()
    recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'report_detail', sample: false })
    await settle()
    expect(funnelPosts()).toHaveLength(0)
    expect(views()).toHaveLength(1)
  })

  it('retries the setup-funnel step after a failed post, without re-emitting the view', async () => {
    api.apiFetch.mockResolvedValueOnce({ ok: false, error: { code: 'X' } })
    const { recordDiagnosisViewed } = await loadPage()
    recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'onboarding', sample: true })
    await settle()
    recordDiagnosisViewed({ projectId: PROJECT, reportId: REPORT, surface: 'onboarding', sample: true })
    await settle()
    expect(funnelPosts()).toHaveLength(2)
    expect(views()).toHaveLength(1)
  })

  it('ignores a call without ids', async () => {
    const { recordDiagnosisViewed } = await loadPage()
    recordDiagnosisViewed({ projectId: '', reportId: REPORT, surface: 'reports', sample: true })
    expect(views()).toHaveLength(0)
    expect(api.apiFetch).not.toHaveBeenCalled()
  })
})

describe('isSampleReport', () => {
  it('matches the server NON_REAL_REPORT_SOURCES', async () => {
    const { isSampleReport } = await loadPage()
    expect(isSampleReport({ source: 'admin_test_report' })).toBe(true)
    expect(isSampleReport({ source: 'mushi-marketing-seed' })).toBe(true)
    expect(isSampleReport({ source: 'sdk' })).toBe(false)
    expect(isSampleReport({})).toBe(false)
    expect(isSampleReport(null)).toBe(false)
    expect(isSampleReport(undefined)).toBe(false)
  })
})
