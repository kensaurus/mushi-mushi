import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  apiFetch: vi.fn(),
  supabase: { auth: { onAuthStateChange: vi.fn() } },
}))
vi.mock('./authBroadcast', () => ({ subscribeAuthBroadcast: vi.fn() }))

import { MCP_PIN_SPEC } from '@mushi-mushi/mcp/clients'
import {
  getOrMintMcpKey,
  mcpKeyLabel,
  mcpPinSpecFrom,
  resetMcpConnectCacheForTests,
  scopesForAccess,
} from './mcpConnect'

afterEach(() => resetMcpConnectCacheForTests())

// REPORT A7 (2026-10-04): each "Add to Cursor" / "Show command" click minted a
// new key (glot.it had 13), always mcp:read, while the fix prompt needs mcp:write.
describe('getOrMintMcpKey', () => {
  const opts = { projectId: 'p1', clientId: 'cursor', clientLabel: 'Cursor', scopes: scopesForAccess('read_write') }

  it('mints once per project, client and scopes, and reuses the key after', async () => {
    const mint = vi.fn().mockResolvedValue('mushi_key_1')
    const [a, b] = await Promise.all([getOrMintMcpKey(opts, mint), getOrMintMcpKey(opts, mint)])
    const c = await getOrMintMcpKey(opts, mint)
    expect([a, b, c]).toEqual(['mushi_key_1', 'mushi_key_1', 'mushi_key_1'])
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('a different client or access level is a different key', async () => {
    const mint = vi.fn().mockResolvedValueOnce('k1').mockResolvedValueOnce('k2').mockResolvedValueOnce('k3')
    await getOrMintMcpKey(opts, mint)
    await getOrMintMcpKey({ ...opts, clientId: 'vscode', clientLabel: 'VS Code' }, mint)
    await getOrMintMcpKey({ ...opts, scopes: scopesForAccess('read_only') }, mint)
    expect(mint).toHaveBeenCalledTimes(3)
  })

  it('requests read + write with a clear label by default', async () => {
    const mint = vi.fn().mockResolvedValue('k')
    await getOrMintMcpKey(opts, mint)
    const [projectId, scopes, label] = mint.mock.calls[0]!
    expect(projectId).toBe('p1')
    expect(scopes).toEqual(['mcp:read', 'mcp:write'])
    expect(label).toMatch(/^MCP · Cursor · \d{4}-\d{2}-\d{2} · read\+write$/)
  })

  it('forgets a failed mint so the next click retries, and passes the real reason on (QA bug 125)', async () => {
    const mint = vi
      .fn()
      .mockRejectedValueOnce(new Error('Owner or admin access required'))
      .mockRejectedValueOnce('not an Error')
      .mockResolvedValueOnce('k')
    await expect(getOrMintMcpKey(opts, mint)).rejects.toThrow('Owner or admin access required')
    await expect(getOrMintMcpKey(opts, mint)).rejects.toThrow('Could not create an MCP key')
    expect(await getOrMintMcpKey(opts, mint)).toBe('k')
    expect(mint).toHaveBeenCalledTimes(3)
  })
})

describe('mcpKeyLabel', () => {
  it('names the client, date and access, within the 64-char cap', () => {
    const at = new Date('2026-10-04T09:00:00Z')
    expect(mcpKeyLabel('Cursor', ['mcp:read', 'mcp:write'], at)).toBe('MCP · Cursor · 2026-10-04 · read+write')
    expect(mcpKeyLabel('Claude Code', ['mcp:read'], at)).toBe('MCP · Claude Code · 2026-10-04 · read-only')
    expect(mcpKeyLabel('x'.repeat(100), ['mcp:read'], at).length).toBeLessThanOrEqual(64)
  })
})

describe('mcpPinSpecFrom', () => {
  it('follows the published catalog version', () => {
    expect(mcpPinSpecFrom('0.24.2', '@mushi-mushi/mcp@0.24.1')).toBe('@mushi-mushi/mcp@0.24.2')
  })

  it('prefers the catalog even when the build pin is ahead (unpublished = npx 404)', () => {
    expect(mcpPinSpecFrom('0.24.2', '@mushi-mushi/mcp@0.25.0')).toBe('@mushi-mushi/mcp@0.24.2')
  })

  it('falls back to the build pin for a missing or malformed version', () => {
    for (const bad of [null, undefined, '', 'latest', '1.0', '1.0.0; rm -rf /', 42]) {
      expect(mcpPinSpecFrom(bad)).toBe(MCP_PIN_SPEC)
    }
  })
})
