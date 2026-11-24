/**
 * @vitest-environment jsdom
 *
 * Once an editor is connected, Connect folds the eleven-client picker to
 * "Connected ✓ · add another", expandable (owner, 2026-11-18). With no editor
 * the picker shows as before. The picker leads with three common editors and
 * the MCP one-click; the rest and the CLI / Skills lanes are one click away
 * (ADR 0069).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'

const CLIENT_IDS = vi.hoisted(() => ['cursor', 'vscode', 'vscode-insiders', 'windsurf', 'cline', 'claude-code', 'claude-desktop', 'zed', 'any', 'lovable'])

vi.mock('@mushi-mushi/marketing-ui', () => ({
  // Renders what the real shell would: the chips it is given, the slot after them, and the lane body.
  ConnectLanePicker: (p: {
    clients: Array<{ id: string }>
    afterClients?: ReactNode
    lanes?: string[]
    activeLane: string
    renderLane: (lane: string, client: { id: string; label: string }) => ReactNode
  }) =>
    createElement(
      'div',
      { 'data-testid': 'lane-picker', 'data-lanes': (p.lanes ?? ['mcp', 'cli', 'skills']).join(',') },
      createElement('ul', null, ...p.clients.map((c) => createElement('li', { key: c.id, 'data-client': c.id }, c.id))),
      p.afterClients,
      createElement('div', { 'data-testid': 'lane-body', 'data-lane': p.activeLane }),
    ),
  useConnectSelection: () => {
    const [activeLane, setActiveLane] = useState('mcp')
    return {
      clients: CLIENT_IDS.map((id) => ({ id, label: id, description: id, method: 'deeplink' })),
      selectedId: 'cursor',
      activeLane,
      setActiveLane,
      selectClient: () => {},
    }
  },
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

  it('leads with Cursor, Claude Code and VS Code, the rest behind "Other editors"', () => {
    render(null)
    const shown = () => Array.from(host.querySelectorAll('[data-client]')).map((li) => li.getAttribute('data-client'))
    expect(shown()).toEqual(['cursor', 'vscode', 'claude-code'])
    const other = host.querySelector<HTMLButtonElement>('[data-testid="connect-other-editors"]')!
    expect(other.textContent).toBe('Other editors (7) ▾')
    act(() => other.click())
    expect(shown()).toEqual(CLIENT_IDS)
  })

  it('offers only the MCP lane up front; CLI and Skills open from one toggle', () => {
    render(null)
    expect(host.querySelector('[data-testid="lane-picker"]')!.getAttribute('data-lanes')).toBe('mcp')
    expect(host.querySelector('#connect-alt-lanes')).toBeNull()
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="connect-alt-lanes-toggle"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    const alt = host.querySelector('#connect-alt-lanes')!
    expect(alt.textContent).toContain('mushi login')
    const skills = Array.from(alt.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent === 'Skills')!
    act(() => skills.click())
    expect(alt.textContent).toContain('npx skills add kensaurus/mushi-mushi')
    // The picker itself stays on the MCP one-click.
    expect(host.querySelector('[data-testid="lane-body"]')!.getAttribute('data-lane')).toBe('mcp')
  })
})
