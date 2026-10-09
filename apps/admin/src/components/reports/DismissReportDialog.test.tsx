/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/DismissReportDialog.test.tsx
 * PURPOSE: The /reports row "Dismiss" asks first and sends nothing until the
 *          user confirms (2026-10-04 console audit, group B #18).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch, toast } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(), push: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { DismissReportDialog } from './DismissReportDialog'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  apiFetch.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}

async function render(onClose = vi.fn(), onDismissed = vi.fn()) {
  await act(async () => {
    root.render(createElement(DismissReportDialog, { report: { id: 'r1' }, onClose, onDismissed }))
  })
  return { onClose, onDismissed }
}

describe('DismissReportDialog', () => {
  it('explains the reporter is told and sends nothing before confirm', async () => {
    await render()
    expect(document.body.textContent).toContain('The reporter gets the message below, and it cannot be taken back.')
    expect(document.body.textContent).toContain('The reporter sees “Closed.”')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  // 2026-10-09: the row × closed with no reason; only the report page could give one.
  it('sends the reason picked in the dialog and shows the reporter message', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: null })
    await render()
    const select = document.body.querySelector('select') as HTMLSelectElement
    await act(async () => {
      select.value = 'not_reproducible'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(document.body.textContent).toContain("The reporter sees “We couldn't reproduce it. Reply if it happens again.”")
    await act(async () => button('Dismiss')?.click())
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/admin/reports/r1',
      expect.objectContaining({ body: JSON.stringify({ status: 'dismissed', closed_reason: 'not_reproducible' }) }),
    )
  })

  it('Keep / Cancel closes without a request', async () => {
    const { onClose } = await render()
    await act(async () => button('Cancel')?.click())
    expect(onClose).toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('Dismiss sends one PATCH and reloads the list', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: null })
    const { onDismissed } = await render()
    await act(async () => button('Dismiss')?.click())
    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/reports/r1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }))
    expect(onDismissed).toHaveBeenCalledTimes(1)
  })

  it('a failed dismiss says so in plain English and does not reload', async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: 'DB_ERROR', message: 'boom' } })
    const { onDismissed } = await render()
    await act(async () => button('Dismiss')?.click())
    expect(onDismissed).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not dismiss the report', expect.not.stringContaining('DB_ERROR'))
  })
})
