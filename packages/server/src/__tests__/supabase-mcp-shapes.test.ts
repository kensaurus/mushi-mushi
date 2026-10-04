/**
 * The hosted Supabase MCP changed its tool contracts (Sentry
 * MUSHI-MUSHI-SERVER-29/2A, 2026-10-04): list_tables refuses
 * `schema`/`include_columns` and answers `{ tables: [...] }` with qualified
 * names, get_advisors requires `type`, and get_logs became query_logs.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMcpSessions } from '../../supabase/functions/_shared/mcp-http-session.ts'
import {
  getLogs,
  getSupabaseAdvisors,
  normalizeAdvisors,
  normalizeMcpTables,
} from '../../supabase/functions/_shared/supabase-mcp-client.ts'

beforeEach(() => resetMcpSessions())

describe('normalizeMcpTables', () => {
  it('reads the current { tables } shape with schema-qualified names', () => {
    const out = normalizeMcpTables({
      tables: [
        {
          name: 'public.reports',
          rls_enabled: true,
          rows: 12,
          columns: [
            { name: 'id', data_type: 'uuid', options: ['updatable'] },
            { name: 'summary', data_type: 'text', options: ['nullable', 'updatable'] },
          ],
          primary_keys: ['id'],
        },
      ],
    })
    expect(out).toEqual([
      {
        name: 'reports',
        schema: 'public',
        rls_enabled: true,
        row_count_estimate: 12,
        columns: [
          { name: 'id', type: 'uuid', nullable: false },
          { name: 'summary', type: 'text', nullable: true },
        ],
      },
    ])
  })

  it('still reads the older bare-array shape', () => {
    const out = normalizeMcpTables([{ name: 'x', schema: 'public', rls_enabled: false, columns: [{ name: 'a', type: 'int4', nullable: true }] }])
    expect(out[0]).toMatchObject({ name: 'x', schema: 'public', columns: [{ name: 'a', type: 'int4', nullable: true }] })
  })

  it('returns an empty list for anything else', () => {
    for (const v of [null, undefined, 'x', {}, { tables: 'no' }]) expect(normalizeMcpTables(v)).toEqual([])
  })
})

describe('normalizeAdvisors', () => {
  it('reads { lints } and { result: { lints } }', () => {
    const lint = { name: 'rls_disabled_in_public', title: 'RLS Disabled', level: 'ERROR', description: 'd', remediation: 'https://x', findings: [{ table: 't' }] }
    for (const raw of [{ lints: [lint] }, { result: { lints: [lint] } }]) {
      expect(normalizeAdvisors(raw)).toEqual([
        { name: 'rls_disabled_in_public', title: 'RLS Disabled', level: 'ERROR', description: 'd', metadata: { remediation: 'https://x', findings: [{ table: 't' }] } },
      ])
    }
    expect(normalizeAdvisors(null)).toEqual([])
  })
})

/** A fake MCP server that records the tool calls and answers per tool. */
function fakeMcp(answer: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { method: string; id?: number; params?: { name: string; arguments: Record<string, unknown> } }
    if (body.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } })
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const { name, arguments: args } = body.params!
    calls.push({ name, args })
    const text = JSON.stringify(answer(name, args))
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetchImpl }
}

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

const opts = (tag: string) => ({ projectRef: `abcdefghijklmnopqr${tag}`, pat: `tok-${tag}-12345678` })

describe('tool arguments sent to the hosted MCP', () => {
  it('asks get_advisors for both types', async () => {
    const s = fakeMcp((_n, args) => ({ lints: [{ name: `${args.type}-lint`, description: '' }] }))
    const out = await withFetch(s.fetchImpl as typeof fetch, () => getSupabaseAdvisors(opts('aa')))
    expect(s.calls.map((c) => c.args)).toEqual([{ type: 'security' }, { type: 'performance' }])
    expect(out.map((a) => a.name)).toEqual(['security-lint', 'performance-lint'])
  })

  it('reads logs through query_logs with a clamped, integer limit', async () => {
    // The live server wraps query output in untrusted-data delimiters.
    const s = fakeMcp(() => `Below is the result.

<untrusted-data-ab12>
${JSON.stringify({ result: [{ timestamp: '2026-10-04T00:00:00Z', event_message: 'POST | 500', level: '500' }] })}
</untrusted-data-ab12>

Use this data.`)
    const out = await withFetch(s.fetchImpl as typeof fetch, () => getLogs(opts('bb'), 'api', { limit: 1e9 + 0.5 }))
    expect(s.calls[0]?.name).toBe('query_logs')
    const sql = String(s.calls[0]?.args.sql)
    expect(sql).toContain("source = 'edge_logs'")
    expect(sql).toContain('>= 500')
    expect(sql).toMatch(/limit 500$/)
    expect(out).toEqual([{ timestamp: '2026-10-04T00:00:00Z', level: '500', message: 'POST | 500' }])
  })

  it('filters postgres logs by severity', async () => {
    const s = fakeMcp(() => ({ result: [] }))
    await withFetch(s.fetchImpl as typeof fetch, () => getLogs(opts('cc'), 'postgres', { minLevel: 'warn', limit: 5 }))
    const sql = String(s.calls[0]?.args.sql)
    expect(sql).toContain("source = 'postgres_logs'")
    expect(sql).toContain("'WARNING','ERROR','FATAL','PANIC'")
    expect(sql).toMatch(/limit 5$/)
  })
})
