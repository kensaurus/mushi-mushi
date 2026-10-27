/**
 * @vitest-environment jsdom
 *
 * Editor agents → Overview opens on the editors that call Mushi (name and
 * last call), then prompts to paste, then key health in one line instead of
 * six key-scope tiles.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real helpers import the built @mushi-mushi/mcp package; the panel only reads the prompt list.
vi.mock('../../lib/mcpPageHelpers', () => ({
  MCP_USE_CASES: Array.from({ length: 7 }, (_, i) => ({ title: `Use ${i}`, ask: `Question ${i}?`, calls: ['tool'] })),
}))
vi.mock('./McpEndpointReadout', () => ({ McpEndpointReadout: () => null }))

import { McpOverviewPanel } from './McpOverviewPanel'
import { connectedEditors, keyHealthLine } from './connectedEditors'
import { EMPTY_MCP_STATS, type McpKeyRow } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const key = (over: Partial<McpKeyRow>): McpKeyRow => ({
  id: 'k',
  key_prefix: 'mushi_ab',
  created_at: '2026-10-01T00:00:00Z',
  is_active: true,
  revoked: false,
  scopes: ['mcp:read'],
  label: null,
  last_seen_at: null,
  ...over,
})

const KEYS = [
  key({ id: 'a', label: 'Cursor', scopes: ['mcp:read', 'mcp:write'], last_seen_at: '2026-10-26T10:00:00Z' }),
  key({ id: 'b', label: 'Claude Code', last_seen_at: '2026-10-27T01:00:00Z' }),
  key({ id: 'c', label: 'SDK', scopes: ['report:write'], last_seen_at: '2026-10-27T02:00:00Z' }),
  key({ id: 'd', label: 'Never used' }),
  key({ id: 'e', label: 'Revoked', revoked: true, last_seen_at: '2026-10-27T03:00:00Z' }),
]

describe('connectedEditors', () => {
  it('lists live editor keys that called, newest first, never an SDK key', () => {
    expect(connectedEditors(KEYS).map((e) => [e.name, e.canWrite])).toEqual([
      ['Claude Code', false],
      ['Cursor', true],
    ])
  })
})

describe('keyHealthLine', () => {
  it('says the key mix in one sentence', () => {
    expect(
      keyHealthLine({ activeKeyCount: 8, mcpReadKeyCount: 5, mcpWriteKeyCount: 3, reportOnlyKeyCount: 3, neverConnectedCount: 3 }),
    ).toBe("8 keys: 5 for editors (3 of them can also start fixes), 3 only send bug reports from your app. 3 haven't been used yet.")
    expect(keyHealthLine({ activeKeyCount: 0, mcpReadKeyCount: 0, mcpWriteKeyCount: 0, reportOnlyKeyCount: 0, neverConnectedCount: 0 })).toMatch(/^No keys yet/)
  })
})

describe('McpOverviewPanel', () => {
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

  const render = (keys: McpKeyRow[] | null) =>
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(McpOverviewPanel, {
            stats: { ...EMPTY_MCP_STATS, activeKeyCount: 5, mcpReadKeyCount: 3, mcpWriteKeyCount: 1, reportOnlyKeyCount: 1 },
            keys,
            lastFetchedAt: null,
            isValidating: false,
            onOpenExamples: () => {},
            onOpenSetup: () => {},
          }),
        ),
      )
    })

  it('puts connected editors first, then copyable prompts, then one key line', () => {
    render(KEYS)
    const editors = Array.from(host.querySelectorAll('[aria-label="Connected editors"] li')).map((li) => li.textContent)
    expect(editors[0]).toContain('Claude Code')
    expect(editors[0]).toContain('Last call')
    expect(host.querySelectorAll('[aria-label="Example prompts"] li')).toHaveLength(5)
    expect(host.querySelector('[data-testid="mcp-key-health"]')!.textContent).toContain('5 keys: 3 for editors')
  })

  it('offers Connect an editor when none has called', () => {
    render([key({ id: 'x' })])
    expect(host.textContent).toContain('No editor has called Mushi from this app yet.')
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.textContent === 'Connect an editor')).toBe(true)
  })
})
