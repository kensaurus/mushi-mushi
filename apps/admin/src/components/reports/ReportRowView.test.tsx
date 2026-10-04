/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportRowView.test.tsx
 * PURPOSE: Row actions on /reports (2026-10-04 console audit, group B):
 *   #76 "Open in new tab" keeps the deploy base path (a bare /reports/<id>
 *       404s on kensaur.us, where the console lives under /mushi-mushi/admin/);
 *   #18 the × only asks the page to dismiss — no request leaves the row.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch }))
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => '11111111-1111-4111-8111-111111111111' }))

import { ReportRowView } from './ReportRowView'
import type { ReportRow } from './types'

const ROW = {
  id: 'c0e99783-a48f-43bf-9fd9-84708dec1a3c',
  project_id: '11111111-1111-4111-8111-111111111111',
  description: 'Checkout button does nothing',
  category: 'bug',
  severity: 'high',
  summary: 'Pay button dead',
  status: 'new',
  created_at: '2026-10-02T10:00:00Z',
  user_category: 'bug',
  confidence: 0.9,
  component: null,
} as ReportRow

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubEnv('BASE_URL', '/mushi-mushi/admin/')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  apiFetch.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllEnvs()
})

async function render(onDismiss = vi.fn()) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          'table',
          null,
          createElement(
            'tbody',
            null,
            createElement(ReportRowView, {
              row: ROW,
              index: 0,
              isSelected: false,
              isCursor: false,
              onToggleSelect: vi.fn(),
              onFocus: vi.fn(),
              onOpen: vi.fn(),
              onCopyLink: vi.fn(),
              onDismiss,
              onDispatchFix: vi.fn(),
            }),
          ),
        ),
      ),
    )
  })
  return { onDismiss }
}

describe('ReportRowView row actions', () => {
  it('opens the report in a new tab under the deploy base path', async () => {
    await render()
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Open in new tab"]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toContain(`/mushi-mushi/admin/reports/${ROW.id}`)
    expect(link!.getAttribute('target')).toBe('_blank')
  })

  it('the × hands the dismiss to the page and sends nothing itself', async () => {
    const { onDismiss } = await render()
    const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
    await act(async () => dismiss?.click())
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
