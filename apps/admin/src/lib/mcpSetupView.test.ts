import { describe, expect, it } from 'vitest'
import { accountKeyForProject, mcpJsonDraftCheck, mcpKeyStep } from './mcpSetupView'

// Round-2 review (2026-11-18), Editor agents page.
describe('mcpJsonDraftCheck', () => {
  it('gives no verdict while nothing is pasted (it used to warn about the placeholder key)', () => {
    expect(mcpJsonDraftCheck('')).toBeNull()
    expect(mcpJsonDraftCheck('   \n')).toBeNull()
  })

  it('checks what was pasted', () => {
    expect(mcpJsonDraftCheck('{ not json')?.title).toBe('Invalid JSON syntax.')
  })
})

describe('accountKeyForProject', () => {
  const key = (over: Partial<{ id: string; label: string | null; scopes: string[]; all_projects: boolean; projects: Array<{ id: string }> }>) => ({
    id: 'k1',
    label: 'cursor-mcp-org',
    scopes: ['mcp:read', 'mcp:write'],
    all_projects: false,
    projects: [] as Array<{ id: string }>,
    ...over,
  })

  it('finds an all-projects MCP key, or one that picked this app', () => {
    expect(accountKeyForProject([key({ all_projects: true })], 'p1')?.id).toBe('k1')
    expect(accountKeyForProject([key({ projects: [{ id: 'p1' }] })], 'p1')?.id).toBe('k1')
  })

  it('ignores keys for other apps, keys without MCP scope, and no app', () => {
    expect(accountKeyForProject([key({ projects: [{ id: 'p2' }] })], 'p1')).toBeNull()
    expect(accountKeyForProject([key({ all_projects: true, scopes: ['report:write'] })], 'p1')).toBeNull()
    expect(accountKeyForProject([key({ all_projects: true })], null)).toBeNull()
    expect(accountKeyForProject(undefined, 'p1')).toBeNull()
  })
})

describe('mcpSnapshotMetrics', () => {
  it('drops a tile that would read 0 ("0 Keys idle")', async () => {
    const { mcpSnapshotMetrics } = await import('../components/mcp/McpSnapshotStrip')
    const tools = { label: 'Tools', value: 133 }
    expect(mcpSnapshotMetrics(null, null, tools)).toEqual([tools])
    expect(mcpSnapshotMetrics(null, { label: 'Keys idle', value: 2 }, tools)).toHaveLength(2)
  })
})

// Round-3 review (2026-11-19): a green tick over "0 MCP keys on kensaur.us".
describe('mcpKeyStep', () => {
  it('names the account key when the app has no key of its own', () => {
    expect(mcpKeyStep(0, 'cursor-mcp-org')).toEqual({ done: true, text: 'Your account key cursor-mcp-org reaches this app.' })
  })

  it('counts the app keys when there are some', () => {
    expect(mcpKeyStep(2, 'cursor-mcp-org')).toEqual({ done: true, text: '2 MCP keys on this app.' })
  })

  it('stays open with no key at all', () => {
    expect(mcpKeyStep(0, null)).toEqual({ done: false, text: null })
  })
})
