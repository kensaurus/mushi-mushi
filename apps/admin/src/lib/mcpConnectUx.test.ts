import { describe, expect, it } from 'vitest'
import {
  mcpConnectStripDetail,
  mcpUnusedKeysBadgeLabel,
  resolveMcpConnectUx,
} from './mcpConnectUx'

describe('resolveMcpConnectUx', () => {
  it('treats IDE connect as setup complete even when unused keys remain', () => {
    const ux = resolveMcpConnectUx({
      connectedKeyCount: 1,
      neverConnectedCount: 2,
      mcpReadKeyCount: 3,
    })
    expect(ux.stripDone).toBe(true)
    expect(ux.hasUnusedKeys).toBe(true)
    expect(ux.unusedKeyCount).toBe(2)
  })

  it('strip detail surfaces unused key housekeeping', () => {
    const ux = resolveMcpConnectUx({
      connectedKeyCount: 1,
      neverConnectedCount: 2,
      mcpReadKeyCount: 3,
    })
    expect(mcpConnectStripDetail(ux)).toBe('2 unused MCP keys')
  })

  it('nav badge copy matches connect strip detail', () => {
    expect(mcpUnusedKeysBadgeLabel(2)).toBe('2 unused MCP keys — add to IDE or revoke')
  })
})
