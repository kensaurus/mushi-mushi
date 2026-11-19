import { describe, expect, it } from 'vitest'
import { mcpManualRedirectTarget } from './mcpManualRedirect'
import { resolveMcpTab } from './mcpPageHelpers'

describe('mcpManualRedirectTarget', () => {
  it('opens the Setup tab', () => {
    const target = mcpManualRedirectTarget('')
    expect(target).toBe('/mcp?tab=setup')
    expect(resolveMcpTab(new URLSearchParams(target.split('?')[1]).get('tab'))).toBe('setup')
  })

  it('keeps the rest of the query', () => {
    expect(mcpManualRedirectTarget('?project=p1')).toBe('/mcp?project=p1&tab=setup')
  })

  it('keeps a tab the link already asked for', () => {
    expect(mcpManualRedirectTarget('?tab=catalog')).toBe('/mcp?tab=catalog')
  })
})
