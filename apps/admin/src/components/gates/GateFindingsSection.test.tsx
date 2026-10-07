/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/gates/GateFindingsSection.test.tsx
 * PURPOSE: The findings list (every plan, ADR 0018) shows the newest run per
 *          gate with plain-English gate names, says "not checked yet" when
 *          nothing ran, and a `spend_cap_unset` finding applies its suggested
 *          caps through PATCH /v1/admin/settings only after confirmation, and
 *          never overwrites a cap that is set by then.
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
    { id: 'design-1', gate: 'design_drift', status: 'fail', summary: { phase: 'scan' }, started_at: '2026-10-02T00:00:00Z' },
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

  it('never says nothing is open when the route returned its 50-run cap', async () => {
    const runs = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, gate: 'code_health', status: 'pass' }))
    apiFetch.mockResolvedValue({ ok: true, data: { runs, findings: [] } })
    render()
    await flush()
    expect(container.textContent).toContain('Only the newest 50 runs were read')
    expect(container.textContent).not.toContain('found nothing open')
  })

  /** Route the section's findings read and the button's settings reads. */
  function serve(settings: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { message: string } }>) {
    let n = 0
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/admin/settings')) return settings[Math.min(n++, settings.length - 1)]
      return { ok: true, data: payload }
    })
  }
  const unset = { ok: true, data: { monthly_llm_budget_usd: null, autofix_max_spend_usd: null } }

  it('applies the suggested caps only after confirming, to the finding’s project', async () => {
    serve([unset])
    apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
    render()
    await flush()

    await act(async () => {
      button('Apply suggested caps')!.click()
    })
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/settings?project_id=p1', { cache: 'no-store' })
    expect(apiFetchMutate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Monthly AI budget: $25.')
    expect(document.body.textContent).not.toContain('left as they are')

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

  it('never overwrites a cap set after the daily check ran', async () => {
    serve([{ ok: true, data: { monthly_llm_budget_usd: 80, autofix_max_spend_usd: null } }])
    apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
    render()
    await flush()
    await act(async () => {
      button('Apply suggested caps')!.click()
    })
    await flush()
    expect(document.body.textContent).not.toContain('Monthly AI budget: $25.')
    expect(document.body.textContent).toContain('Already set since the check ran, left as they are: Monthly AI budget.')
    await act(async () => {
      button('Apply caps')!.click()
    })
    await flush()
    expect(apiFetchMutate).toHaveBeenCalledWith('/v1/admin/settings?project_id=p1', {
      method: 'PATCH',
      body: JSON.stringify({ autofix_max_spend_usd: 2 }),
    })
  })

  it('re-reads at confirm time and drops a cap set while the dialog was open', async () => {
    serve([unset, { ok: true, data: { monthly_llm_budget_usd: null, autofix_max_spend_usd: 9 } }])
    apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
    render()
    await flush()
    await act(async () => {
      button('Apply suggested caps')!.click()
    })
    await flush()
    await act(async () => {
      button('Apply caps')!.click()
    })
    await flush()
    expect(apiFetchMutate).toHaveBeenCalledWith('/v1/admin/settings?project_id=p1', {
      method: 'PATCH',
      body: JSON.stringify({ monthly_llm_budget_usd: 25 }),
    })
    expect(toast.success.mock.calls[0][1]).toContain('Left as they were: Auto-fix spend limit.')
  })

  it('says the caps are already set and sends nothing when every suggested cap exists', async () => {
    serve([{ ok: true, data: { monthly_llm_budget_usd: 80, autofix_max_spend_usd: 4 } }])
    render()
    await flush()
    await act(async () => {
      button('Apply suggested caps')!.click()
    })
    await flush()
    expect(apiFetchMutate).not.toHaveBeenCalled()
    expect(button('Apply caps')).toBeUndefined()
    expect(container.textContent).toContain('These caps are already set. This check clears on its next daily run.')
  })

  it('sends nothing when the current caps cannot be read', async () => {
    serve([{ ok: false, error: { message: 'Database error' } }])
    render()
    await flush()
    await act(async () => {
      button('Apply suggested caps')!.click()
    })
    await flush()
    expect(apiFetchMutate).not.toHaveBeenCalled()
    expect(button('Apply caps')).toBeUndefined()
    expect(toast.error).toHaveBeenCalledWith('Could not check the current spend caps', 'Database error')
    expect(button('Apply suggested caps')).toBeDefined()
  })

  it('keeps the button when the save is refused', async () => {
    serve([unset])
    apiFetchMutate.mockResolvedValue({ ok: false, error: { message: 'Only project admins can change settings' } })
    render()
    await flush()
    await act(async () => {
      button('Apply suggested caps')!.click()
    })
    await flush()
    await act(async () => {
      button('Apply caps')!.click()
    })
    await flush()
    expect(toast.error).toHaveBeenCalledWith('Could not apply the suggested caps', 'Only project admins can change settings')
    expect(button('Apply suggested caps')).toBeDefined()
  })

  it('explains a 403 without mentioning credentials', async () => {
    serve([unset])
    apiFetchMutate.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only organization owners and admins can change credentials.' },
    })
    render()
    await flush()
    await act(async () => {
      button('Apply suggested caps')!.click()
    })
    await flush()
    await act(async () => {
      button('Apply caps')!.click()
    })
    await flush()
    expect(toast.error).toHaveBeenCalledWith(
      'Could not apply the suggested caps',
      'Only team owners and admins can change spend caps. Ask one of them to apply these.',
    )
  })

  it('shows members and viewers the next step instead of the button', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/v1/org') return { ok: true, data: { organizations: [{ id: 'o1', role: 'viewer' }] } }
      return { ok: true, data: payload }
    })
    render()
    await flush()
    expect(button('Apply suggested caps')).toBeUndefined()
    expect(container.textContent).toContain('Only team owners and admins can set spend caps')
    // Viewers are read-only on the server: no Dismiss either.
    expect(button('Dismiss')).toBeUndefined()
  })
})

describe('Dismiss a finding', () => {
  const DISMISS_PATH = '/v1/admin/projects/p1/gate-findings/f-design/dismiss'
  /** The Dismiss button on the card whose message is the design finding's. */
  const designDismiss = (): HTMLButtonElement | undefined => {
    let el: HTMLElement | null = [...document.body.querySelectorAll('p')].find((p) => p.textContent === 'Hex colour off the palette') ?? null
    while (el) {
      const btn = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Dismiss')
      if (btn) return btn
      el = el.parentElement
    }
    return undefined
  }

  async function type(value: string) {
    const input = document.body.querySelector('input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('needs a reason, then posts it to the finding’s project and drops the finding from the list', async () => {
    let dismissed = false
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/v1/admin/inventory/p1/findings') {
        return {
          ok: true,
          data: { ...payload, findings: payload.findings.map((f) => (f.id === 'f-design' && dismissed ? { ...f, allowlisted: true } : f)) },
        }
      }
      return { ok: true, data: { organizations: [] } }
    })
    apiFetchMutate.mockImplementation(async () => {
      dismissed = true
      return { ok: true, data: { id: 'f-design', alreadyDismissed: false } }
    })
    render()
    await flush()
    expect(container.textContent).toContain('Hex colour off the palette')

    await act(async () => {
      designDismiss()!.click()
    })
    await flush()
    expect(document.body.textContent).toContain('Why is this not a problem?')

    // Too short: refused in the dialog, nothing sent.
    await type('ab')
    await act(async () => {
      button('Dismiss finding')!.click()
    })
    await flush()
    expect(apiFetchMutate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('at least 3 characters')

    await type('Brand colour, allowed on purpose')
    await act(async () => {
      button('Dismiss finding')!.click()
    })
    await flush()
    expect(apiFetchMutate).toHaveBeenCalledTimes(1)
    expect(apiFetchMutate).toHaveBeenCalledWith(DISMISS_PATH, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Brand colour, allowed on purpose' }),
    })
    expect(toast.success).toHaveBeenCalled()
    expect(container.textContent).not.toContain('Hex colour off the palette')
    expect(button('Dismiss finding')).toBeUndefined()
  })

  it('keeps the finding and says why when the server refuses', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === '/v1/admin/inventory/p1/findings' ? { ok: true, data: payload } : { ok: true, data: { organizations: [] } },
    )
    apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers have read-only access.' } })
    render()
    await flush()
    await act(async () => {
      designDismiss()!.click()
    })
    await flush()
    await type('Not a problem here')
    await act(async () => {
      button('Dismiss finding')!.click()
    })
    await flush()
    expect(toast.error).toHaveBeenCalled()
    expect(toast.error.mock.calls[0][0]).toBe('Could not dismiss the finding')
    expect(container.textContent).toContain('Hex colour off the palette')
  })
})
