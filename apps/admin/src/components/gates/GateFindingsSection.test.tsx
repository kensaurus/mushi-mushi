/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/gates/GateFindingsSection.test.tsx
 * PURPOSE: The findings list (every plan, ADR 0018) shows the newest run per
 *          gate with plain-English gate names, says "not checked yet" when
 *          nothing ran, and a `spend_cap_unset` finding applies its suggested
 *          caps through PATCH /v1/admin/settings only after confirmation.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch, apiFetchMutate, toast } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchMutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), push: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ apiFetch, apiFetchMutate }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { GateFindingsSection } from './GateFindingsSection'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

function render(gate?: 'radar') {
  act(() =>
    root.render(
      createElement(MemoryRouter, null, createElement(GateFindingsSection, { projectId: 'p1', gate, neverRunText: 'Never ran.' })),
    ),
  )
}

const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

const payload = {
  runs: [
    { id: 'radar-new', gate: 'radar', status: 'warn', started_at: '2026-10-02T00:00:00Z' },
    { id: 'radar-old', gate: 'radar', status: 'warn', started_at: '2026-10-01T00:00:00Z' },
    { id: 'design-1', gate: 'design_drift', status: 'fail', started_at: '2026-10-02T00:00:00Z' },
  ],
  findings: [
    {
      id: 'f-cap', gate_run_id: 'radar-new', severity: 'warn', rule_id: 'spend_cap_unset', message: 'No monthly AI budget is set.',
      file_path: null, line: null, allowlisted: false,
      suggested_fix: { kind: 'console', method: 'PATCH', endpoint: '/v1/admin/settings', values: { monthly_llm_budget_usd: 25, autofix_max_spend_usd: 2 } },
    },
    { id: 'f-old', gate_run_id: 'radar-old', severity: 'warn', rule_id: 'spend_cap_unset', message: 'stale', file_path: null, allowlisted: false },
    { id: 'f-design', gate_run_id: 'design-1', severity: 'error', rule_id: 'off_token_color', message: 'Hex colour off the palette', file_path: 'src/Button.tsx', line: 12, allowlisted: false },
    { id: 'f-allow', gate_run_id: 'design-1', severity: 'error', rule_id: 'off_token_color', message: 'accepted', file_path: 'src/X.tsx', line: 1, allowlisted: true },
  ],
}

describe('GateFindingsSection', () => {
  it('lists the newest open findings with file, line and a plain-English gate name', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: payload })
    render()
    await flush()
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/admin/inventory/p1/findings')
    const text = container.textContent ?? ''
    expect(text).toContain('Code off the design tokens')
    expect(text).toContain('src/Button.tsx:12')
    expect(text).toContain('No monthly AI budget is set.')
    expect(text).not.toContain('stale')
    expect(text).not.toContain('accepted')
  })

  it('says not checked yet, never a pass, when no run finished', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { runs: [{ id: 'r', gate: 'radar', status: 'running' }], findings: [] } })
    render('radar')
    await flush()
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/admin/inventory/p1/findings?gate=radar')
    expect(container.textContent).toContain('Never ran. This is not a pass.')
  })

  it('applies the suggested caps only after confirming, to the finding’s project', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: payload })
    apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
    render()
    await flush()

    act(() => button('Apply suggested caps')!.click())
    expect(apiFetchMutate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Monthly AI budget: $25.')
    expect(document.body.textContent).toContain('Caps that are already set are not changed.')

    await act(async () => {
      button('Apply caps')!.click()
    })
    await flush()
    expect(apiFetchMutate).toHaveBeenCalledWith('/v1/admin/settings?project_id=p1', {
      method: 'PATCH',
      body: JSON.stringify({ monthly_llm_budget_usd: 25, autofix_max_spend_usd: 2 }),
    })
    expect(toast.success).toHaveBeenCalled()
    expect(container.textContent).toContain('Applied. This check clears on its next daily run.')
  })

  it('keeps the button when the save is refused', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: payload })
    apiFetchMutate.mockResolvedValue({ ok: false, error: { message: 'Only project admins can change settings' } })
    render()
    await flush()
    act(() => button('Apply suggested caps')!.click())
    await act(async () => {
      button('Apply caps')!.click()
    })
    await flush()
    expect(toast.error).toHaveBeenCalledWith('Could not apply the suggested caps', 'Only project admins can change settings')
    expect(button('Apply suggested caps')).toBeDefined()
  })
})
