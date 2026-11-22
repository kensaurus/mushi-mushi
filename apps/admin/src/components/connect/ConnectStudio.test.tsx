/**
 * @vitest-environment jsdom
 *
 * Once an editor is connected, Connect folds the eleven-client picker to
 * "Connected ✓ · add another", expandable (owner, 2026-11-18). With no editor
 * the picker shows as before.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mushi-mushi/marketing-ui', () => ({
  ConnectLanePicker: () => createElement('div', { 'data-testid': 'lane-picker' }, 'picker'),
  useConnectSelection: () => ({ clients: [], selectedId: 'cursor', activeLane: 'mcp', setActiveLane: () => {}, selectClient: () => {} }),
  renderConnectClientIcon: () => null,
}))
vi.mock('../ClientConnectButton', () => ({ ClientConnectButton: () => null }))

import { ConnectStudio } from './ConnectStudio'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (connectedEditor: { lastSeenAt: string | null } | null) =>
  act(() => root.render(createElement(MemoryRouter, null, createElement(ConnectStudio, { projectId: 'p1', projectName: 'App', connectedEditor }))))

describe('ConnectStudio', () => {
  it('shows the picker when no editor is connected', () => {
    render(null)
    expect(host.querySelector('[data-testid="lane-picker"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="connect-editor-connected"]')).toBeNull()
  })

  it('folds the picker to a connected pill with an expandable "add another"', () => {
    render({ lastSeenAt: new Date().toISOString() })
    const row = host.querySelector('[data-testid="connect-editor-connected"]')!
    // The fold leads with the passed status pill (2026-11-18), not words plus a ✓.
    const pill = row.querySelector('[data-testid="status-pill"]')
    expect([pill?.getAttribute('data-status'), pill?.textContent]).toEqual(['passed', 'Editor connected'])
    expect(host.querySelector('[data-testid="lane-picker"]')).toBeNull()
    const toggle = row.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe('Add another editor')
    act(() => toggle.click())
    expect(host.querySelector('[data-testid="lane-picker"]')).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})
