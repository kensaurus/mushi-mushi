/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/GenerateTestButton.test.tsx
 * PURPOSE: "Generate test" (2026-10-04 console audit, group B #85): asks
 *          before spending LLM budget and opening a PR, links the PR it
 *          opened, and explains failures instead of "Request failed".
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

import { GenerateTestButton, testGenErrorText } from './GenerateTestButton'
import type { ReportDetail } from './types'

const REPORT = { id: 'r1', project_id: 'p1' } as ReportDetail

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

async function clickThrough() {
  await act(async () => {
    root.render(createElement(GenerateTestButton, { report: REPORT }))
  })
  await act(async () => button('Generate test')?.click())
}

describe('GenerateTestButton', () => {
  it('asks first and sends nothing until confirmed', async () => {
    await clickThrough()
    expect(document.body.textContent).toContain('opens a draft PR')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('links the PR the worker opened', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: { prUrl: 'https://github.com/acme/app/pull/7', prNumber: 7, branch: 'b', path: 'e2e/pay.spec.ts' },
    })
    await clickThrough()
    const confirm = Array.from(document.body.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')).find(
      (b) => b.textContent?.trim() === 'Generate test',
    ) as HTMLButtonElement | undefined
    await act(async () => confirm?.click())
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(
      'Regression test opened as a draft PR',
      'PR #7 adds e2e/pay.spec.ts. Review it on GitHub.',
      expect.objectContaining({ label: 'Open PR' }),
    )
  })

  it('explains a failure by its cause', () => {
    expect(testGenErrorText({ code: 'NO_GITHUB_TOKEN', message: 'GitHub token not configured' })).toMatch(/Connect it in Integrations/)
    expect(testGenErrorText(undefined)).toBe('The test could not be generated. Try again in a moment.')
  })
})
