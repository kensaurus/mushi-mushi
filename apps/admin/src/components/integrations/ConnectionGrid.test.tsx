/**
 * @vitest-environment jsdom
 *
 * The Integrations grid is the page (owner, 2026-11-18): a tile per tool with
 * its state as a shape and a word, grouped; a tile opens its settings; a tile
 * not set up has a Connect button beside it; one primary "Fix <tool>" for one
 * broken connection, an alert card each when more are broken.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthRow, PlatformResponse } from './types'

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { deliveries: [] }, loading: false, error: null, isValidating: false, reload: vi.fn(), lastFetchedAt: null }),
}))

import { ConnectionGrid, useConnectionTiles, type ConnectionGroup } from './ConnectionGrid'
import type { GridToolId } from './connectionGridModel'

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

const recent = new Date(Date.now() - 5 * 60_000).toISOString()
const platform: PlatformResponse = {
  platform: { github: { github_repo_url: 'https://github.com/acme/app', github_installation_token_ref: 'ref' } },
}
const history: HealthRow[] = [
  { id: 'g', kind: 'github', status: 'down', latency_ms: 30, message: 'HTTP 401 Bad credentials', source: 'cron', checked_at: recent },
]

const GROUPS: ConnectionGroup[] = [
  { heading: createElement('p', null, 'Your code'), tools: ['github'] },
  { heading: createElement('p', null, 'Alerts'), tools: ['slack', 'discord', 'teams'] },
  { heading: createElement('p', null, 'Fix agent'), tools: ['cursor_cloud', 'claude_code_agent'] },
  { id: 'integrations-routing', heading: createElement('p', null, 'Issue trackers'), tools: ['linear', 'jira', 'github_issues', 'pagerduty'] },
  { heading: createElement('p', null, 'Errors you already catch (optional)'), tools: ['sentry', 'langfuse'] },
]

function Harness(props: { history: HealthRow[]; onOpen: (id: GridToolId) => void; onConnect: (id: GridToolId) => void; routing?: Array<{ integration_type: string; is_active: boolean }> }) {
  const tiles = useConnectionTiles({
    platform,
    history: props.history,
    slack: { configured: false, canPost: false, channelId: null },
    linearConnected: false,
    routing: props.routing,
  })
  return createElement(ConnectionGrid, { tiles, groups: GROUPS, onOpen: props.onOpen, onConnect: props.onConnect })
}

function render(history: HealthRow[], extra: { routing?: Array<{ integration_type: string; is_active: boolean }> } = {}) {
  const onOpen = vi.fn()
  const onConnect = vi.fn()
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(Harness, { history, onOpen, onConnect, ...extra })))
  })
  return { onOpen, onConnect }
}

describe('ConnectionGrid', () => {
  it('shows every tool in its group, the broken one first in the sentence, and one Fix button', () => {
    render(history)
    const tiles = host.querySelectorAll('[data-state]')
    expect(tiles).toHaveLength(12)
    expect(host.querySelectorAll('[data-testid="integrations-group"]')).toHaveLength(5)
    expect(host.querySelector('#integrations-routing')?.textContent).toContain('Issue trackers')
    expect(host.querySelector('[data-state="attention"]')?.getAttribute('aria-label')).toBe('GitHub: Needs you. Open its settings.')
    // One broken connection: its reason is in the sentence, with no alert
    // cards saying it again (console sweep 2026-10-28).
    expect(host.querySelector('[aria-label="Connection status"]')?.textContent).toMatch(/GitHub needs you: .+/)
    const fixButtons = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === 'Fix GitHub')
    expect(fixButtons).toHaveLength(1)
    expect(host.querySelector('[data-testid="integrations-alerts"]')).toBeNull()
    // Never the old "Set it up below" pointer.
    expect(host.textContent).not.toContain('Set it up below')
  })

  it('opens the settings when a tile or Fix is pressed', () => {
    const { onOpen } = render(history)
    act(() => (host.querySelector('[data-state="attention"]') as HTMLButtonElement).click())
    expect(onOpen).toHaveBeenLastCalledWith('github')
    act(() => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Fix GitHub')!.click())
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('gives a tile that is not set up its own Connect button, beside (not inside) the tile', () => {
    const { onConnect, onOpen } = render(history)
    const connect = host.querySelector<HTMLButtonElement>('button[aria-label="Connect Slack"]')!
    expect(connect).not.toBeNull()
    expect(connect.closest('[data-state]')).toBeNull()
    act(() => connect.click())
    expect(onConnect).toHaveBeenCalledWith('slack')
    expect(onOpen).not.toHaveBeenCalled()
    // A tile that is connected has no Connect.
    expect(host.querySelector('button[aria-label="Connect GitHub"]')).toBeNull()
  })

  it('puts an alert card per broken connection when more than one needs you', () => {
    const { onOpen } = render(history, { routing: [{ integration_type: 'pagerduty', is_active: false }] })
    const cards = host.querySelectorAll('[data-testid^="integrations-alert-"]')
    expect(cards).toHaveLength(2)
    expect(host.querySelector('[data-testid="integrations-alert-pagerduty"]')?.textContent).toContain('PagerDuty needs you')
    // The sentence names them; the cards carry each Fix.
    expect(Array.from(host.querySelectorAll('[aria-label="Connection status"] button'))).toHaveLength(0)
    act(() => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Fix PagerDuty')!.click())
    expect(onOpen).toHaveBeenCalledWith('pagerduty')
  })
})
