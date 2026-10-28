import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/embeddings.ts', () => ({
  createEmbedding: vi.fn(async () => [0.01, 0.02, 0.03]),
}))

import {
  buildCodebaseChatSystemPrompt,
  buildImportEdges,
  computeImportImpact,
  isSummaryStale,
  orderTourStops,
  retrieveCodeForQuestion,
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

describe('buildImportEdges with symbol rows', () => {
  it('derives edges from file rows only', () => {
    const edges = buildImportEdges([
      { id: 'lib', file_path: 'lib/util.ts', symbol_name: null, content_preview: 'export function util() {}' },
      { id: 'page', file_path: 'app/page.tsx', symbol_name: null, content_preview: "import '../lib/util'" },
      // A symbol chunk of page.tsx whose preview repeats the import line.
      { id: 'page#Page', file_path: 'app/page.tsx', symbol_name: 'Page', content_preview: "import '../lib/util'" },
    ])
    expect(edges.map((e) => e.source_node_id)).toEqual(['page'])
  })
})

function scopeDb(rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
    rpc,
  }
}

describe('retrieveCodeForQuestion statement timeout', () => {
  it('returns an empty rpc_timeout result on SQLSTATE 57014 and does not search the wiki', async () => {
    const calls: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = scopeDb(async (fn) => {
      calls.push(fn)
      return {
        data: null,
        error: { code: '57014', message: 'canceling statement due to statement timeout' },
      }
    })

    const result = await retrieveCodeForQuestion(db as never, '67a6453c-375d-41d7-833a-b33471159442', 'why is checkout slow', 12)

    expect(result).toEqual({ files: [], wikiChunks: [], reason: 'rpc_timeout' })
    expect(calls).toEqual(['match_codebase_files'])
    expect(warn.mock.calls.some((args) => String(args[0]).includes('match_codebase_files statement timeout'))).toBe(true)
    warn.mockRestore()
  })

  it('treats a timeout message without a code as rpc_timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = scopeDb(async () => ({
      data: null,
      error: { message: 'canceling statement due to statement timeout' },
    }))

    const result = await retrieveCodeForQuestion(db as never, '67a6453c-375d-41d7-833a-b33471159442', 'why is checkout slow')

    expect(result.reason).toBe('rpc_timeout')
    expect(result.files).toEqual([])
    warn.mockRestore()
  })

  it('keeps any other RPC failure as rpc_failed', async () => {
    const db = scopeDb(async () => ({
      data: null,
      error: { code: '42883', message: 'function match_codebase_files does not exist' },
    }))

    const result = await retrieveCodeForQuestion(db as never, '67a6453c-375d-41d7-833a-b33471159442', 'why is checkout slow')

    expect(result).toEqual({ files: [], wikiChunks: [], reason: 'rpc_failed' })
  })
})

describe('match_codebase_files limit plan', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261028100000_match_codebase_files_literal_limit.sql'),
    'utf8',
  )

  it('splices a capped integer limit and reads preview text only for the winning rows', () => {
    expect(sql).toMatch(/lim := least\(greatest\(coalesce\(match_count, 5\), 1\), 20\)/)
    expect(sql).toContain("replace($q$")
    expect(sql).toContain("'__ROW_LIMIT__', lim::text")
    expect(sql).not.toMatch(/limit match_count/i)

    const ctes = [...sql.matchAll(/with hits as materialized \(([\s\S]*?)\)\s*select/g)]
    expect(ctes).toHaveLength(2)
    for (const cte of ctes) {
      expect(cte[1]).not.toContain('content_preview')
      expect(cte[1]).toContain('limit __ROW_LIMIT__')
    }
    expect(sql).toContain('pcf.content_preview')
  })

  it('keeps the halfvec IVFFlat plan for the unfiltered branch', () => {
    expect(sql).toContain('set ivfflat.probes to \'20\'')
    expect(sql).toContain('set ivfflat.max_probes to \'60\'')
    expect(sql).toContain('set enable_seqscan to \'off\'')
    expect(sql).toContain('set plan_cache_mode to \'force_custom_plan\'')
    expect(sql).toContain('pcf.project_id::text = $2::text')
    expect(sql).toContain('embedding::halfvec(1536)')
    expect(sql).not.toMatch(/create index/i)
    expect(sql).not.toMatch(/set statement_timeout/i)
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
