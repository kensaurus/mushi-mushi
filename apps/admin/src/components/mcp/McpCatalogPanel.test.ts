import { describe, expect, it } from 'vitest'
import { filterTools } from './McpCatalogPanel'

// Round-3 review (2026-11-19): 133 tool cards with nothing to narrow them.
const TOOLS = [
  { name: 'get_fix_context', title: 'Fix context', description: 'Everything an agent needs to fix one report.' },
  { name: 'query_lessons', title: 'Lessons', description: 'Search lessons learned from past fixes.' },
  { name: 'get_usage', title: 'Usage', description: 'Diagnoses used this period.' },
]

describe('filterTools', () => {
  it('keeps every tool for an empty query', () => {
    expect(filterTools(TOOLS, '  ')).toHaveLength(3)
  })

  it('matches name, title or description, every word, any case', () => {
    expect(filterTools(TOOLS, 'FIX').map((t) => t.name)).toEqual(['get_fix_context', 'query_lessons'])
    expect(filterTools(TOOLS, 'lessons past').map((t) => t.name)).toEqual(['query_lessons'])
    expect(filterTools(TOOLS, 'nothing here')).toEqual([])
  })
})
