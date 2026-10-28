/**
 * @vitest-environment jsdom
 *
 * The Integrations grid: a tile per tool with its state, a "needs you" line
 * per broken connection, and one primary "Fix <tool>" button.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthRow, PlatformResponse } from './types'

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { deliveries: [] }, loading: false, error: null, isValidating: false, reload: vi.fn(), lastFetchedAt: null }),
}))

import { ConnectionGrid } from './ConnectionGrid'

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

describe('ConnectionGrid', () => {
  it('shows six tiles, the broken one first in the sentence, and one Fix button', () => {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ConnectionGrid, {
            platform,
            history,
            slack: { configured: false, canPost: false, channelId: null },
            linearConnected: false,
          }),
        ),
      )
    })
    const tiles = host.querySelectorAll('[data-state]')
    expect(tiles).toHaveLength(6)
    expect(host.querySelector('[data-state="attention"]')?.getAttribute('aria-label')).toBe('GitHub: Needs you. Open its card.')
    // One broken connection: its reason is in the sentence, with no second
    // "needs you" list saying it again (console sweep 2026-10-28).
    expect(host.querySelector('[aria-label="Connection status"]')?.textContent).toMatch(/GitHub needs you: .+/)
    const fixButtons = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === 'Fix GitHub')
    expect(fixButtons).toHaveLength(1)
    expect(host.querySelector('[aria-label="Connections that need you"]')).toBeNull()
  })

  it('jumps to the card when a tile is pressed', () => {
    const card = document.createElement('div')
    card.id = 'platform-card-github'
    card.scrollIntoView = vi.fn()
    document.body.appendChild(card)
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ConnectionGrid, {
            platform,
            history,
            slack: { configured: false, canPost: false, channelId: null },
            linearConnected: false,
          }),
        ),
      )
    })
    act(() => (host.querySelector('[data-state="attention"]') as HTMLButtonElement).click())
    expect(card.scrollIntoView).toHaveBeenCalled()
    card.remove()
  })
})
