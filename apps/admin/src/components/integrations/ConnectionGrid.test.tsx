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
import type { GridTile, GridToolId } from './connectionGridModel'

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

function Harness(props: {
  history: HealthRow[]
  onOpen: (id: GridToolId) => void
  onConnect: (id: GridToolId) => void
  onCheck?: (tile: GridTile) => void
  checkingId?: GridToolId | null
  routing?: Array<{ integration_type: string; is_active: boolean }>
  alertEventsOn?: number | null
}) {
  const tiles = useConnectionTiles({
    platform,
    history: props.history,
    slack: { configured: false, canPost: false, channelId: null },
    linearConnected: false,
    routing: props.routing,
  })
  return createElement(ConnectionGrid, {
    tiles,
    groups: GROUPS,
    onOpen: props.onOpen,
    onConnect: props.onConnect,
    onCheck: props.onCheck,
    checkingId: props.checkingId,
    alertEventsOn: props.alertEventsOn,
  })
}

function render(
  history: HealthRow[],
  extra: { routing?: Array<{ integration_type: string; is_active: boolean }>; checkingId?: GridToolId | null; alertEventsOn?: number | null } = {},
) {
  const onOpen = vi.fn()
  const onConnect = vi.fn()
  const onCheck = vi.fn()
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(Harness, { history, onOpen, onConnect, onCheck, ...extra })))
  })
  return { onOpen, onConnect, onCheck }
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
    // States are status marks: broken is failed, not set up is idle.
    expect(host.querySelector('[data-testid="integration-tile-github"] [data-testid="status-mark"]')?.getAttribute('data-status')).toBe('failed')
    expect(host.querySelector('[data-testid="integration-tile-slack"] [data-status]')?.getAttribute('data-status')).toBe('idle')
    // 2026-11-19: no hollow ○ before a tool that is not set up (it read as a radio button); Connect says it.
    expect(host.querySelector('[data-testid="integration-tile-slack"] [data-testid="status-mark"]')).toBeNull()
  })

  // Owner, 2026-11-18: a connected repo nobody had checked read "Not tested
  // yet · Nothing yet" with a blue dot.
  // Round-2 review 2026-11-18: a green check beside "NOT CHECKED" claimed a pass nobody ran.
  it('a connected tool nobody has checked reads not checked with a hollow mark and a Check now beside it', () => {
    const { onCheck, onOpen } = render([])
    const tile = host.querySelector('[data-testid="integration-tile-github"]')!
    // The short word shows (the long one truncated to "CONNECTED · NOT …"); the full one is the tooltip.
    expect(tile.textContent).toContain('Not checked')
    expect(tile.querySelector('[data-state]')?.getAttribute('aria-label')).toContain('Connected · not checked yet')
    expect(tile.textContent).not.toContain('Nothing yet')
    // Nothing broken: the status is the counts as marks, not a sentence.
    expect(host.querySelector('[data-testid="integrations-tally"]')?.textContent).toContain('1 not checked')
    expect(tile.querySelector('[data-testid="status-mark"]')?.getAttribute('data-status')).toBe('idle')
    // The tally does not draw a second dot beside the status row's own one.
    expect(host.querySelector('[data-testid="integrations-tally"] [data-tone="ok"]')).toBeNull()
    const check = host.querySelector<HTMLButtonElement>('[data-testid="integration-check-github"]')!
    expect(check.textContent).toBe('Check now')
    expect(check.closest('[data-state]')).toBeNull()
    act(() => check.click())
    expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'github', checkKind: 'github' }))
    expect(onOpen).not.toHaveBeenCalled()
    // A checked tool has no Check now.
    render(history)
    expect(host.querySelector('[data-testid="integration-check-github"]')).toBeNull()
  })

  it('shows the running mark while the check runs', () => {
    render([], { checkingId: 'github' })
    const tile = host.querySelector('[data-testid="integration-tile-github"]')!
    expect(tile.querySelector('[data-testid="status-mark"]')?.getAttribute('data-status')).toBe('running')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="integration-check-github"]')!.disabled).toBe(true)
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

  it('puts the tools not set up in one compact row per group, apart from the connected tiles', () => {
    render(history)
    const alerts = host.querySelectorAll('[data-testid="integrations-group"]')[1]
    const row = alerts.querySelector('ul[aria-label^="Not connected"]')!
    expect(row.getAttribute('aria-label')).toBe('Not connected: Slack, Discord, Teams')
    expect(row.querySelectorAll('li')).toHaveLength(3)
    for (const li of Array.from(row.querySelectorAll('li'))) expect(li.className).toContain('whitespace-nowrap')
    // GitHub is connected: a tile, not a chip.
    expect(host.querySelector('[data-testid="integration-tile-github"]')?.closest('ul[aria-label^="Not connected"]')).toBeNull()
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

  // Round-2 review 2026-11-18: eight alert events ON with Slack, Discord and
  // Teams all unconnected read as "1 working". The gap leads the page.
  it('leads with "No alert channel" and a Connect Slack button when events are on and no channel is connected', () => {
    const { onConnect } = render([], { alertEventsOn: 8 })
    const status = host.querySelector('[aria-label="Connection status"]')!
    expect(status.querySelector('[data-testid="integrations-channel-gap"]')?.textContent).toBe('No alert channel: 8 alert events go nowhere')
    expect(host.querySelector('[data-testid="integrations-tally"]')).toBeNull()
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="integrations-channel-gap-connect"]')!.click())
    expect(onConnect).toHaveBeenCalledWith('slack')
  })

  it('has no gap while the prefs load or when every event is off', () => {
    render([], { alertEventsOn: null })
    expect(host.querySelector('[data-testid="integrations-channel-gap"]')).toBeNull()
    render([], { alertEventsOn: 0 })
    expect(host.querySelector('[data-testid="integrations-channel-gap"]')).toBeNull()
  })

  it('gives the gap its own card when a broken tool leads the status row', () => {
    render(history, { alertEventsOn: 3 })
    expect(host.querySelector('[aria-label="Connection status"]')?.textContent).toMatch(/GitHub needs you/)
    expect(host.querySelector('[data-testid="integrations-alert-alert-channel-gap"]')?.textContent).toContain('No alert channel: 3 alert events go nowhere')
  })
})
