/**
 * Report fe489587: Set up → Diagnose told a never-installed app its SDK went
 * "Cold, removed from a deploy, 17 d ago". The 17-day-old call came from the
 * demo's read-only MCP key (called by curl); the app's report:write key had
 * never been used. Only SDK keys count, as on the server (isSdkKey).
 */

import { describe, expect, it } from 'vitest'
import { activeSdkKeys, summarizeCardStatus, type SdkHealthApiKey } from './SdkHealthSummary'

const NOW = Date.now()
const DAYS = 24 * 60 * 60 * 1000

function key(over: Partial<SdkHealthApiKey>): SdkHealthApiKey {
  return { id: 'k', key_prefix: 'mushi_ab', is_active: true, created_at: new Date(NOW - 30 * DAYS).toISOString(), ...over }
}

describe('SDK health counts only SDK keys', () => {
  const mcpKeySeen17dAgo = key({ id: 'mcp', scopes: ['mcp:read'], last_seen_at: new Date(NOW - 17 * DAYS).toISOString() })
  const unusedSdkKey = key({ id: 'sdk', scopes: ['report:write'], last_seen_at: null })

  it('an MCP key seen 17 days ago plus an unused SDK key reads "not connected yet", not Cold', () => {
    expect(summarizeCardStatus([mcpKeySeen17dAgo, unusedSdkKey], null)).toBe('never')
  })

  it('a CLI key with report:write and an MCP scope is not the app SDK either', () => {
    const cliKey = key({ id: 'cli', scopes: ['report:write', 'mcp:read', 'mcp:write'], last_seen_at: new Date(NOW - 60_000).toISOString() })
    expect(summarizeCardStatus([cliKey, unusedSdkKey], null)).toBe('never')
    expect(activeSdkKeys([cliKey, unusedSdkKey]).map((k) => k.id)).toEqual(['sdk'])
  })

  it('a fresh SDK heartbeat is healthy, and a project with only tool keys has no SDK key', () => {
    expect(summarizeCardStatus([key({ scopes: ['report:write'], last_seen_at: new Date(NOW - 60_000).toISOString() })], null)).toBe('healthy')
    expect(summarizeCardStatus([mcpKeySeen17dAgo], null)).toBe('no-key')
  })

  it('rows from an older API without scopes still count', () => {
    expect(activeSdkKeys([key({ id: 'old', scopes: undefined }), key({ id: 'off', is_active: false })]).map((k) => k.id)).toEqual(['old'])
  })
})
