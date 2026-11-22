/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportRowView.test.tsx
 * PURPOSE: Row actions on /reports (2026-10-04 console audit, group B):
 *   #76 "Open in new tab" keeps the deploy base path (a bare /reports/<id>
 *       404s on kensaur.us, where the console lives under /mushi-mushi/admin/);
 *   #18 Dismiss (in the row's More menu since 2026-11-22) only asks the page to
 *       dismiss — no request leaves the row.
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

/** The row's actions live in its More menu (console polish 2026-11-22); open it and pick one. */
async function menuItem(text: string): Promise<HTMLElement | undefined> {
  const more = container.querySelector<HTMLButtonElement>('[data-testid="report-row-more"]')
  expect(more).not.toBeNull()
  await act(async () => more!.click())
  return Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="report-row-more-menu"] [role="menuitem"]')).find(
    (el) => el.textContent?.trim() === text,
  )
}

describe('ReportRowView row actions', () => {
  it('opens the report in a new tab under the deploy base path', async () => {
    await render()
    const link = (await menuItem('Open in new tab')) as HTMLAnchorElement | undefined
    expect(link?.tagName).toBe('A')
    expect(link!.getAttribute('href')).toContain(`/mushi-mushi/admin/reports/${ROW.id}`)
    expect(link!.getAttribute('target')).toBe('_blank')
  })

  it('Dismiss hands the dismiss to the page and sends nothing itself', async () => {
    const { onDismiss } = await render()
    const dismiss = await menuItem('Dismiss')
    expect(dismiss).toBeDefined()
    await act(async () => dismiss!.click())
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('ReportRowView dispatch gate', () => {
  it('a feature request cannot be queued from the row', async () => {
    const row = { ...ROW, status: 'classified', dispatch_block: 'The reporter filed this as a feature request.' } as ReportRow
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement('table', null, createElement('tbody', null,
            createElement(ReportRowView, {
              row,
              index: 0,
              isSelected: false,
              isCursor: false,
              onToggleSelect: vi.fn(),
              onFocus: vi.fn(),
              onOpen: vi.fn(),
              onCopyLink: vi.fn(),
              onDismiss: vi.fn(),
              onDispatchFix: vi.fn(),
            }),
          )),
        ),
      )
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
    await act(async () => trigger?.click())
    const queue = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cannot dispatch yet')
    expect(queue?.disabled).toBe(true)
    expect(queue?.title).toBe('The reporter filed this as a feature request.')
  })

  it('a bug in another app explains that, and does not show the pinned checklist', async () => {
    const row = { ...ROW, status: 'classified', project_id: '542b34e0-019e-41fe-b900-7b637717bb86', project_name: 'yen-yen' } as ReportRow
    const preflight = {
      loading: false,
      ready: false,
      checks: [],
      failing: [{ key: 'github', ready: false, label: 'GitHub connected', hint: '', fixHref: '/connect' }],
      error: null,
      reload: () => {},
      repoUrl: 'https://github.com/acme/pinned',
    }
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement('table', null, createElement('tbody', null,
            createElement(ReportRowView, {
              row,
              index: 0,
              isSelected: false,
              isCursor: false,
              onToggleSelect: vi.fn(),
              onFocus: vi.fn(),
              onOpen: vi.fn(),
              onCopyLink: vi.fn(),
              onDismiss: vi.fn(),
              onDispatchFix: vi.fn(),
              preflight: preflight as never,
              dispatchScopeNote: 'This bug is in yen-yen. Open it to dispatch a fix for that app.',
            }),
          )),
        ),
      )
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
    await act(async () => trigger?.click())
    const reason = document.body.querySelector('[data-testid="dispatch-block-reason"]')
    expect(reason?.textContent).toContain('yen-yen')
    expect(document.body.textContent).not.toContain('GitHub connected')
  })
})

describe('ReportRowView sample reports', () => {
  const renderRow = async (row: ReportRow) => {
    await act(async () => {
      root.render(
        createElement(MemoryRouter, null, createElement('table', null, createElement('tbody', null,
          createElement(ReportRowView, {
            row,
            index: 0,
            isSelected: false,
            isCursor: false,
            onToggleSelect: vi.fn(),
            onFocus: vi.fn(),
            onOpen: vi.fn(),
            onCopyLink: vi.fn(),
            onDismiss: vi.fn(),
            onDispatchFix: vi.fn(),
          }),
        ))),
      )
    })
  }

  const tag = () => container.querySelector('[data-testid="report-source-tag"]') as HTMLElement | null

  it('labels a "Send a test report" sample so it is not mistaken for a user bug', async () => {
    await renderRow({ ...ROW, metadata_source: 'admin_test_report' } as ReportRow)
    expect(tag()?.dataset.sourceKind).toBe('test')
    expect(tag()?.textContent).toContain('Test')
  })

  it('tags a real user report as one', async () => {
    await renderRow(ROW)
    expect(tag()?.dataset.sourceKind).toBe('user')
    expect(tag()?.textContent).toContain('User report')
  })

  // Owner's walkthrough, 2026-11-17: alarms and setup tasks read as user bugs.
  it('tags an AWS alarm and a setup task, each with its own glyph', async () => {
    await renderRow({ ...ROW, source: 'cloudwatch' } as ReportRow)
    expect(tag()?.textContent).toBe('▲Alarm')
    await renderRow({ ...ROW, source: 'sdk_health' } as ReportRow)
    expect(tag()?.textContent).toBe('☐Setup task')
  })
})
