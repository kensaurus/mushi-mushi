import { describe, it, expect } from 'vitest'
import {
  buildCodebaseChatSystemPrompt,
  buildImportEdges,
  computeImportImpact,
  isSummaryStale,
  orderTourStops,
  type ExploreGraphNode,
} from '../../supabase/functions/_shared/codebase-understand.ts'

describe('isSummaryStale', () => {
  it('returns true when hashes differ', () => {
    expect(isSummaryStale('abc', 'def')).toBe(true)
  })

  it('returns false when hashes match', () => {
    expect(isSummaryStale('abc', 'abc')).toBe(false)
  })

  it('returns true when either hash is missing', () => {
    expect(isSummaryStale(null, 'abc')).toBe(true)
    expect(isSummaryStale('abc', null)).toBe(true)
  })
})

describe('orderTourStops', () => {
  const nodes: ExploreGraphNode[] = [
    {
      id: 'a',
      label: 'config.ts',
      node_type: 'code_file',
      metadata: { file_path: 'config.ts', symbol_name: null, layer: 'config', content_preview: null },
    },
    {
      id: 'b',
      label: 'lib.ts',
      node_type: 'code_file',
      metadata: { file_path: 'lib/util.ts', symbol_name: null, layer: 'lib', content_preview: null },
    },
    {
      id: 'c',
      label: 'page.tsx',
      node_type: 'code_file',
      metadata: { file_path: 'app/page.tsx', symbol_name: null, layer: 'ui', content_preview: null },
    },
  ]

  it('orders config before ui layers', () => {
    const stops = orderTourStops(nodes, [], 10)
    expect(stops[0]?.layer).toBe('config')
    expect(stops.some((s) => s.layer === 'ui')).toBe(true)
  })

  it('respects maxStops cap', () => {
    const stops = orderTourStops(nodes, [], 2)
    expect(stops.length).toBeLessThanOrEqual(2)
  })
})

describe('computeImportImpact', () => {
  const nodes: ExploreGraphNode[] = [
    {
      id: 'lib',
      label: 'lib.ts',
      node_type: 'code_file',
      metadata: { file_path: 'lib/util.ts', symbol_name: null, layer: 'lib', content_preview: null },
    },
    {
      id: 'page',
      label: 'page.tsx',
      node_type: 'code_file',
      metadata: { file_path: 'app/page.tsx', symbol_name: null, layer: 'ui', content_preview: "import './lib/util'" },
    },
  ]

  const edges = buildImportEdges([
    {
      id: 'lib',
      file_path: 'lib/util.ts',
      symbol_name: null,
      content_preview: 'export function util() {}',
    },
    {
      id: 'page',
      file_path: 'app/page.tsx',
      symbol_name: null,
      content_preview: "import '../lib/util'",
    },
  ])

  it('finds importers of changed files', () => {
    const impact = computeImportImpact(['lib/util.ts'], nodes, edges)
    expect(impact.affected_file_paths).toContain('app/page.tsx')
    expect(impact.affected_file_paths).toContain('lib/util.ts')
  })
})

describe('buildCodebaseChatSystemPrompt', () => {
  it('includes project name and citations', () => {
    const prompt = buildCodebaseChatSystemPrompt({
      projectName: 'glot-it',
      codeContext: 'export const x = 1',
      citations: [{ file_path: 'lib/x.ts', line_start: 1, line_end: 5, symbol_name: null }],
    })
    expect(prompt).toContain('glot-it')
    expect(prompt).toContain('lib/x.ts:1')
  })
})
