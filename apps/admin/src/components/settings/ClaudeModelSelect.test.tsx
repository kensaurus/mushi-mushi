/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/ClaudeModelSelect.test.tsx
 * PURPOSE: The model pickers showed the first option when the saved model was
 *          not in their hard-coded list (2026-10-22: eight apps diagnosing on
 *          Opus 5.5 read "Sonnet 5.5"). The picker must show the saved model,
 *          list the current lineup, and its two buttons must write the
 *          recommended model and the default.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ live: null as unknown }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: state.live, loading: false, error: null, reload: () => {} }),
}))

import { ClaudeModelSelect } from './ClaudeModelSelect'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.live = { source: 'none', models: [] }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(props: Parameters<typeof ClaudeModelSelect>[0]) {
  act(() => root.render(createElement(ClaudeModelSelect, props)))
}

const select = () => host.querySelector('select') as HTMLSelectElement
const optionIds = () => Array.from(select().querySelectorAll('option')).map((o) => o.value)

describe('ClaudeModelSelect', () => {
  it('shows a saved Opus 5.5 as Opus 5.5, not the first option', () => {
    render({ role: 'diagnosis', value: 'claude-opus-5-5', onChange: () => {} })
    expect(select().value).toBe('claude-opus-5-5')
    expect(optionIds()).toEqual(expect.arrayContaining(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']))
  })

  it('keeps an unknown saved model selected as "(saved)"', () => {
    render({ role: 'fix', value: 'claude-mystery-9', onChange: () => {} })
    expect(select().value).toBe('claude-mystery-9')
    expect(select().selectedOptions[0]?.textContent).toContain('(saved)')
  })

  it('shows the effective default for an empty or retired value', () => {
    render({ role: 'fix', value: 'claude-opus-4-1', onChange: () => {} })
    expect(select().value).toBe('claude-sonnet-5-5')
  })

  it('writes the recommended model and the default from its buttons', () => {
    const onChange = vi.fn()
    render({ role: 'quick_check', value: 'claude-haiku-4-5-20251001', onChange })
    act(() => (host.querySelector('[data-testid="model-use-recommended-quick_check"]') as HTMLButtonElement).click())
    expect(onChange).toHaveBeenLastCalledWith('claude-haiku-5-5')
    render({ role: 'quick_check', value: 'claude-haiku-5-5', onChange })
    act(() => (host.querySelector('[data-testid="model-reset-quick_check"]') as HTMLButtonElement).click())
    expect(onChange).toHaveBeenLastCalledWith('claude-haiku-4-5')
  })

  it('lists a model the app key reports that the built-in list lacks', () => {
    state.live = {
      source: 'live',
      models: [
        { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', createdAt: '2026-09-22T00:00:00Z', line: 'opus' },
        { id: 'claude-opus-6', displayName: 'Claude Opus 6', createdAt: '2027-01-10T00:00:00Z', line: 'opus' },
      ],
    }
    render({ role: 'diagnosis', value: 'claude-opus-5-5', onChange: () => {} })
    expect(optionIds()).toContain('claude-opus-6')
    expect(host.textContent).toContain('Model list read from your Anthropic key')
  })
})
