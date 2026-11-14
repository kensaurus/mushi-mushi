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
import { getMcpClient } from '@mushi-mushi/mcp/clients'
import { RESOLVED_MCP_HTTP_URL } from '../lib/env'

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

describe('ClientConnectButton for Claude Code', () => {
  const HOSTED = 'https://kensaur.us/mushi-mushi/hosted-mcp/'
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mint.getOrMintMcpKey.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (mcpOAuthUrl: string) =>
    act(() => {
      root.render(
        createElement(ClientConnectButton, {
          client: getMcpClient('claude-code'),
          projectId: 'p1',
          projectName: 'Acme',
          endpoint: 'https://api.example',
          mcpHttpUrl: RESOLVED_MCP_HTTP_URL,
          mcpOAuthUrl,
        }),
      )
    })
  const press = (label: RegExp) =>
    act(() => {
      ;(Array.from(container.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement).click()
    })

  it('shows the keyless OAuth command first and mints nothing', async () => {
    render(HOSTED)
    press(/Show Claude Code command/)
    await flush()
    const text = container.textContent ?? ''
    // New installs carry the vibe preset (ADR 0063); the URL is quoted for zsh.
    expect(text).toContain(`claude mcp add --transport http mushi "${HOSTED}?features=vibe"`)
    expect(text).not.toMatch(/--header|Authorization|Bearer/)
    expect(text).toContain('No key is created or copied')
    expect(mint.getOrMintMcpKey).not.toHaveBeenCalled()
  })

  it('offers the key command as a second action that says a key is created', async () => {
    mint.getOrMintMcpKey.mockResolvedValue('mushi_ci_key')
    render(HOSTED)
    press(/Show Claude Code command/)
    await flush()
    expect(container.textContent).toContain('For CI or headless use')
    press(/Create a key and show the command with it/)
    await flush()
    expect(mint.getOrMintMcpKey).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('--header "Authorization: Bearer mushi_ci_key"')
    expect(container.textContent).toContain('A key was created for this command')
  })

  it('keeps the key command where the hosted URL has no sign-in (self-hosted)', async () => {
    mint.getOrMintMcpKey.mockResolvedValue('mushi_self')
    render(RESOLVED_MCP_HTTP_URL)
    press(/Show Claude Code command/)
    await flush()
    expect(mint.getOrMintMcpKey).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Authorization: Bearer mushi_self')
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
