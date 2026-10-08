/**
 * The hosted Supabase MCP answers `list_edge_functions` with
 * `{ functions: [...] }` now, a bare array before. The connector called
 * `.map` on the object and every Supabase radar rule ended in
 * "fns.map is not a function" (glot.it, 2026-10-05). Both shapes are read;
 * anything without a list is "could not list" (null), never "no functions".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mcpCallTool } = vi.hoisted(() => ({ mcpCallTool: vi.fn() }))
vi.mock('../../supabase/functions/_shared/mcp-http-session.ts', () => ({ mcpCallTool }))

import { normalizeMcpEdgeFunctions } from '../../supabase/functions/_shared/supabase-mcp-client.ts'
import { supabaseConnector, supabaseRadarResults } from '../../supabase/functions/_shared/connectors/supabase.ts'

const FN = { slug: 'glot-ai-chat', verify_jwt: false }

describe('normalizeMcpEdgeFunctions', () => {
  it('reads a bare array and the { functions } object', () => {
    expect(normalizeMcpEdgeFunctions([FN])).toEqual([FN])
    expect(normalizeMcpEdgeFunctions({ functions: [FN] })).toEqual([FN])
  })

  it('unwraps untrusted-data delimiters', () => {
    const text = `Below is the result.\n<untrusted-data-abc-123>\n${JSON.stringify({ functions: [FN] })}\n</untrusted-data-abc-123>`
    expect(normalizeMcpEdgeFunctions(text)).toEqual([FN])
  })

  it('is null, never [], when there is no list', () => {
    expect(normalizeMcpEdgeFunctions({ error: 'nope' })).toBeNull()
    expect(normalizeMcpEdgeFunctions({ functions: 'x' })).toBeNull()
    expect(normalizeMcpEdgeFunctions(null)).toBeNull()
    expect(normalizeMcpEdgeFunctions('not json')).toBeNull()
  })
})

describe('supabaseConnector.snapshot with the { functions } shape', () => {
  const reply = (value: unknown) => ({ status: 200, error: null, result: { content: [{ text: JSON.stringify(value) }], isError: false } })

  beforeEach(() => {
    mcpCallTool.mockReset()
    mcpCallTool.mockImplementation(async (_opts: unknown, name: string) => {
      if (name === 'list_tables') return reply({ tables: [{ name: 'public.profiles', rls_enabled: true, columns: [] }] })
      if (name === 'list_edge_functions') return reply({ functions: [FN, { slug: 'healthz', verify_jwt: true }] })
      if (name === 'get_advisors') return reply({ lints: [] })
      return reply([])
    })
  })

  it('lists the functions and the radar rules evaluate instead of throwing', async () => {
    const snap = await supabaseConnector.snapshot!({
      db: null as never,
      organizationId: 'o1',
      projectId: 'p1',
      readCredential: 'sbp_test',
      writeCredential: null,
      config: { projectRef: 'abcdefghijklmnopqrst' },
      fetch: async () => new Response('{}'),
      now: () => new Date('2026-10-07T00:00:00Z'),
    })
    const facts = snap.facts as Record<string, unknown>
    expect(facts.functions).toEqual([
      { slug: 'glot-ai-chat', verifyJwt: false, source: null },
      { slug: 'healthz', verifyJwt: true, source: null },
    ])
    const fnRule = supabaseRadarResults(facts).find((r) => r.ruleId === 'edge_fn_unauthenticated_paid')
    // An open function whose source was not read is unknown, not an error.
    expect(fnRule?.state).toBe('unknown')
    expect(fnRule?.reason).not.toMatch(/Could not list/)
  })

  it('a reply with no list leaves the functions unknown', async () => {
    mcpCallTool.mockImplementation(async (_opts: unknown, name: string) => {
      if (name === 'list_tables') return reply({ tables: [] })
      if (name === 'list_edge_functions') return reply({ message: 'unexpected' })
      return reply([])
    })
    const snap = await supabaseConnector.snapshot!({
      db: null as never,
      organizationId: 'o1',
      projectId: 'p1',
      readCredential: 'sbp_test',
      writeCredential: null,
      config: { projectRef: 'abcdefghijklmnopqrst' },
      fetch: async () => new Response('{}'),
      now: () => new Date('2026-10-07T00:00:00Z'),
    })
    expect((snap.facts as Record<string, unknown>).functions).toBeNull()
  })
})
