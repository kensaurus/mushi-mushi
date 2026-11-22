import { describe, expect, it } from 'vitest'
import { splitToolDescription, toolCardChips } from './McpToolCard'

// Round-2 review (2026-11-18): 133 cards each repeated their section's chips and
// carried the raw API text in a nested grey box.
describe('toolCardChips', () => {
  it('a plain read tool carries no chips: the Read section already says it', () => {
    expect(toolCardChips({ scope: 'mcp:read', hints: { readOnly: true, idempotent: true } } as never)).toEqual([])
  })

  it('keeps the chips that differ from the section', () => {
    expect(toolCardChips({ scope: 'mcp:read', hints: { readOnly: false } } as never).map((c) => c.label)).toEqual(['writes'])
    expect(toolCardChips({ scope: 'mcp:write', hints: { destructive: true, idempotent: true } } as never).map((c) => c.label)).toEqual([
      'destructive',
      'safe to retry',
    ])
  })
})

describe('splitToolDescription', () => {
  it('leads with the first sentence and folds the API detail', () => {
    expect(splitToolDescription('List recent bug reports. Returns { reports }.')).toEqual({
      lead: 'List recent bug reports.',
      more: 'Returns { reports }.',
    })
    expect(splitToolDescription('One sentence only')).toEqual({ lead: 'One sentence only', more: null })
  })
})
