/**
 * @vitest-environment jsdom
 *
 * SDK-only keys are normal (they send bug reports), so the banner is a plain
 * ○ line, not a coloured problem banner.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpStatusBanner } from './McpStatusBanner'
import { EMPTY_MCP_STATS } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('McpStatusBanner', () => {
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

  it('shows SDK-only keys as a neutral line with a ○ mark', () => {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(McpStatusBanner, {
            stats: { ...EMPTY_MCP_STATS, hasAnyProject: true, topPriority: 'report_only_keys', reportOnlyKeyCount: 4, projectId: 'p1' },
          }),
        ),
      )
    })
    const line = host.querySelector('[data-testid="mcp-sdk-keys-line"]')!
    expect(line.textContent).toContain('4 SDK keys send bug reports.')
    expect(line.querySelector('svg[data-tone="off"]')).not.toBeNull()
    expect(line.className).not.toMatch(/danger|brand|border/)
    expect(line.querySelector('p')!.outerHTML).not.toMatch(/danger|brand/)
  })

  // Round-2 review (2026-11-18): "Mint MCP key" while cursor-mcp-org already reached every project.
  it('with an account key that reaches the app, offers the snippet, not another key', () => {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(McpStatusBanner, {
            stats: { ...EMPTY_MCP_STATS, hasAnyProject: true, topPriority: 'report_only_keys', reportOnlyKeyCount: 4, projectId: 'p1' },
            accountKey: { label: 'cursor-mcp-org' },
            onTab: () => {},
          }),
        ),
      )
    })
    expect(host.querySelector('[data-testid="mcp-sdk-keys-line"]')).toBeNull()
    const line = host.querySelector('[data-testid="mcp-account-key-line"]')!
    expect(line.textContent).toContain('cursor-mcp-org')
    expect(host.textContent).not.toContain('Mint MCP key')
  })
})
