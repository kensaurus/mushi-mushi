/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 125: a failed mint always said "check your plan limits" (the real
 * reason was dropped), and after a deeplink the "Open again" block could
 * never render. Also QA bug 266: MCP test failures showed raw text.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const mint = vi.hoisted(() => ({ getOrMintMcpKey: vi.fn() }))
vi.mock('../lib/toast', () => ({ useToast: () => toast }))
vi.mock('../lib/mcpConnect', () => ({
  getOrMintMcpKey: mint.getOrMintMcpKey,
  getPublishedMcpPinSpec: () => Promise.resolve('@mushi-mushi/mcp@1.0.0'),
  scopesForAccess: (a: string) => (a === 'read_only' ? ['mcp:read'] : ['mcp:read', 'mcp:write']),
}))
vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { ClientConnectButton } from './ClientConnectButton'
import { mcpTestFailureMessage } from '../lib/mcpPageHelpers'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEEPLINK_CLIENT = {
  id: 'cursor',
  label: 'Cursor',
  method: 'deeplink',
  build: () => ({ kind: 'deeplink', url: 'cursor://install' }),
} as never

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

describe('ClientConnectButton', () => {
  let container: HTMLDivElement
  let root: Root
  let open: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    toast.error.mockReset()
    mint.getOrMintMcpKey.mockReset()
    open = vi.spyOn(window, 'open').mockReturnValue(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        createElement(ClientConnectButton, {
          client: DEEPLINK_CLIENT,
          projectId: 'p1',
          projectName: 'Acme',
          endpoint: 'https://api.example',
          mcpHttpUrl: 'https://mcp.example',
        }),
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    open.mockRestore()
  })

  const click = (label: RegExp) =>
    act(() => {
      ;(Array.from(container.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement).click()
    })

  it('shows the server’s reason when the key cannot be created', async () => {
    mint.getOrMintMcpKey.mockRejectedValue(new Error('Owner or admin access required'))
    click(/Add to Cursor/)
    await flush()
    expect(toast.error).toHaveBeenCalledWith('Could not create a key', 'Owner or admin access required')
    expect(JSON.stringify(toast.error.mock.calls)).not.toMatch(/plan limits/)
  })

  it('after the deeplink opens, offers "Open again" with the same link', async () => {
    mint.getOrMintMcpKey.mockResolvedValue('mushi_k')
    click(/Add to Cursor/)
    await flush()
    expect(open).toHaveBeenCalledWith('cursor://install', '_self')
    click(/Open again/)
    expect(open).toHaveBeenCalledTimes(2)
  })
})

describe('mcpTestFailureMessage', () => {
  it('maps by error code, not by searching the message', () => {
    expect(mcpTestFailureMessage({ code: 'MCP_PROBE_FAILED', message: 'HTTP 401 from hosted MCP' })).toMatch(
      /did not answer the test/,
    )
    expect(mcpTestFailureMessage({ code: 'NO_PROJECT', message: 'Select a project first.' })).toBe('Select a project first.')
    expect(mcpTestFailureMessage({ code: 'NETWORK_ERROR', message: 'Failed to fetch' })).toMatch(/Could not reach/)
  })
})
