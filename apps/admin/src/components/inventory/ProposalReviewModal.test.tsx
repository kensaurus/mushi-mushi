/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/inventory/ProposalReviewModal.test.tsx
 * PURPOSE: Discarding an AI-drafted inventory asks first (regenerating it
 *          spends LLM budget), and a YAML the validator rejects lists the
 *          issues instead of an empty banner.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch, toast } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), push: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({
    data: {
      id: 'prop1',
      status: 'draft',
      llm_model: 'm',
      observation_count: 3,
      inventory_id: null,
      created_at: '2026-10-04T00:00:00Z',
      proposed_yaml: 'schema_version: 2\n',
      proposed_parsed: { app: { name: 'Shop' }, user_stories: [], pages: [] },
      rationale_by_story: {},
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

import { ProposalReviewModal } from './ProposalReviewModal'

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

function render(onDiscarded = vi.fn()) {
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(ProposalReviewModal, {
          projectId: 'p1',
          proposalId: 'prop1',
          onClose: vi.fn(),
          onAccepted: vi.fn(),
          onDiscarded,
        }),
      ),
    ),
  )
  return onDiscarded
}

const buttons = (label: string) => [...document.body.querySelectorAll('button')].filter((b) => b.textContent === label)

describe('ProposalReviewModal', () => {
  it('asks before discarding and only posts after confirm', async () => {
    apiFetch.mockResolvedValue({ ok: true, data: {} })
    const onDiscarded = render()
    await flush()
    await act(async () => buttons('Discard')[0]!.click())
    expect(apiFetch).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Discard this draft inventory?')
    await act(async () => buttons('Discard draft')[0]!.click())
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/inventory/p1/proposals/prop1/discard', { method: 'POST', body: '{}' })
    expect(onDiscarded).toHaveBeenCalled()
  })

  it('lists validator issues when accept is rejected', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'bad', issues: [{ path: '$.schema_version', message: 'Required' }] },
    })
    render()
    await flush()
    await act(async () => buttons('Accept & ingest')[0]!.click())
    await flush()
    expect(document.body.textContent).toContain('YAML rejected by validator')
    expect(document.body.textContent).toContain('$.schema_version')
  })
})
