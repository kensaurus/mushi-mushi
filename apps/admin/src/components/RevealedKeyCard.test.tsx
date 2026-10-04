/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 138: a freshly minted report:write SDK key opened on ".env.local (MCP)"
 * and offered .cursor/mcp.json, MCP configs that cannot list a single tool.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { RevealedKeyCard, defaultModeFor, isMcpCapableKey } from './RevealedKeyCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('RevealedKeyCard paste targets', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function mount(scopes: string[]) {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(RevealedKeyCard, {
            projectId: 'p1',
            projectName: 'Acme',
            projectSlug: 'acme',
            apiKey: 'mushi_secret',
            scopes,
            onDismiss: () => {},
          }),
        ),
      )
    })
  }

  const tabIds = () =>
    Array.from(container.querySelectorAll('[data-testid^="revealed-key-mode-"]')).map((el) =>
      el.getAttribute('data-testid')!.replace('revealed-key-mode-', ''),
    )

  it('an SDK key opens on the SDK env block and offers no MCP config', () => {
    mount(['report:write'])
    expect(tabIds()).not.toContain('cursor')
    expect(tabIds()).not.toContain('env')
    const payload = container.querySelector('[data-testid="revealed-key-payload-sdk"]')!.textContent ?? ''
    expect(payload).toContain('NEXT_PUBLIC_MUSHI_API_KEY=mushi_secret')
  })

  it('an MCP key keeps the MCP targets', () => {
    mount(['mcp:read', 'mcp:write'])
    expect(tabIds()).toEqual(expect.arrayContaining(['env', 'cursor', 'raw']))
    expect(tabIds()).not.toContain('sdk')
  })

  it('helpers', () => {
    expect(isMcpCapableKey(['report:write'])).toBe(false)
    expect(isMcpCapableKey(['mcp:write'])).toBe(true)
    expect(defaultModeFor('acme', ['report:write'])).toBe('sdk')
    expect(defaultModeFor('acme', ['mcp:read'])).toBe('env')
  })
})
