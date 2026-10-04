/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportPreviewDrawer.test.tsx
 * PURPOSE: Opening a report in the preview drawer stamps `admin_seen_at`
 *          server-side; the drawer tells the list (onSeen) so the row's
 *          reply dot clears without a refetch — and only when the load
 *          succeeded, because a failed read stamped nothing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch }))

import { ReportPreviewDrawer } from './ReportPreviewDrawer'

const REPORT_ID = 'c0e99783-a48f-43bf-9fd9-84708dec1a3c'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  apiFetch.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderDrawer(onSeen: (id: string) => void) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(ReportPreviewDrawer, { previewId: REPORT_ID, onClose: () => {}, onSeen }),
      ),
    )
  })
  // Let the fetch promise and the state updates after it settle.
  await act(async () => {
    await Promise.resolve()
  })
}

describe('ReportPreviewDrawer onSeen', () => {
  it('reports the id once the preview loaded', async () => {
    // The server's real shape: the report is flat in `data` (reports.ts
    // detail route). The old mock nested it under `report`, which hid that
    // the drawer always opened blank.
    apiFetch.mockResolvedValue({
      ok: true,
      data: {
        id: REPORT_ID,
        project_id: 'p1',
        summary: 'Checkout button does nothing',
        description: 'Tapping Pay does nothing',
        status: 'new',
        severity: 'high',
        category: 'bug',
        component: null,
        confidence: null,
        created_at: '2026-10-02T10:00:00Z',
      },
    })
    const onSeen = vi.fn()
    await renderDrawer(onSeen)
    expect(document.body.textContent).toContain('Checkout button does nothing')
    expect(apiFetch).toHaveBeenCalledWith(`/v1/admin/reports/${REPORT_ID}`, expect.objectContaining({ cache: 'no-store' }))
    expect(onSeen).toHaveBeenCalledTimes(1)
    expect(onSeen).toHaveBeenCalledWith(REPORT_ID)
  })

  it('does not report a failed load as seen', async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { message: 'Report not found' } })
    const onSeen = vi.fn()
    await renderDrawer(onSeen)
    expect(onSeen).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Report not found')
  })
})
