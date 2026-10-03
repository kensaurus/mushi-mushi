/**
 * Gap #7: every gate the live `gate_runs_gate_check` allows can be filtered on
 * both MCP transports and has a console label.
 *
 * The live list is rebuilt from the migrations that define it:
 *   20261002130100_recipe_gate_types       restates the full list (+ 4 drift gates)
 *   20261002140100_failopen_radar_and_index_schema  appends 'radar'
 *   20261002180000_radar_gates_and_digest  appends v_add (portfolio_radar …)
 * and compared with the stdio `GATE_IDS`, the hosted
 * `LIST_GATE_FINDINGS_GATES`, the hosted tools/list schema generated into
 * `mcp-discovery-tools.json`, and the console `GATE_IDS` / `GATE_LABELS`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const quoted = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

function liveGates(): string[] {
  const base = read('packages/server/supabase/migrations/20261002130100_recipe_gate_types.sql')
  const check = /check \(gate in \(([\s\S]*?)\)\);/i.exec(base)
  if (!check) throw new Error('recipe gate migration no longer restates the list')
  const radar = read('packages/server/supabase/migrations/20261002140100_failopen_radar_and_index_schema.sql')
  if (!/unnest\(v_vals \|\| 'radar'::text\)/.test(radar)) throw new Error('radar migration no longer appends radar')
  const digest = read('packages/server/supabase/migrations/20261002180000_radar_gates_and_digest.sql')
  const add = /v_add\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/.exec(digest)
  if (!add) throw new Error('digest migration no longer declares v_add')
  return [...new Set([...quoted(check[1]), 'radar', ...quoted(add[1])])].sort()
}

function constList(rel: string, name: string): string[] {
  const m = new RegExp(`const ${name}(?::[^=]+)? = \\[([\\s\\S]*?)\\] as const`).exec(read(rel))
  if (!m) throw new Error(`${name} not found in ${rel}`)
  return quoted(m[1]).sort()
}

describe('gate ids', () => {
  const live = liveGates()

  it('the live constraint includes radar and the hole-check gates', () => {
    expect(live).toEqual(expect.arrayContaining(['radar', 'portfolio_radar', 'portfolio_radar_ci', 'store_review', 'code_health', 'design_drift']))
    expect(live).toHaveLength(18)
  })

  it('stdio list_gate_findings accepts exactly the live gates', () => {
    expect(constList('packages/mcp/src/server.ts', 'GATE_IDS')).toEqual(live)
  })

  it('hosted list_gate_findings accepts exactly the live gates', () => {
    expect(constList('packages/server/supabase/functions/mcp/index.ts', 'LIST_GATE_FINDINGS_GATES')).toEqual(live)
  })

  it('the hosted tools/list schema (generated mcp-discovery-tools.json) offers exactly the live gates', () => {
    // The hosted server advertises this inputSchema (withCatalogMetadata); a client that
    // validates against it cannot send a gate missing from this enum.
    const manifest = JSON.parse(read('packages/server/supabase/functions/_shared/mcp-discovery-tools.json')) as {
      tools: Record<string, { description: string; inputSchema: { properties: { gate: { enum: string[] } } } }>
    }
    const tool = manifest.tools.list_gate_findings
    expect([...tool.inputSchema.properties.gate.enum].sort()).toEqual(live)
    const catalog = read('packages/mcp/src/catalog.ts')
    const filter = /name: 'list_gate_findings',[\s\S]*?Filter by gate \(([^)]*)\)/.exec(catalog)![1]
    expect(tool.description).toContain(`Filter by gate (${filter})`)
    expect(tool.description).toContain('Available on every plan.')
  })

  it('the console labels every live gate in plain English', () => {
    expect(constList('apps/admin/src/lib/gateLabels.ts', 'GATE_IDS')).toEqual(live)
    const labels = read('apps/admin/src/lib/gateLabels.ts')
    for (const gate of live) expect(labels, gate).toMatch(new RegExp(`\\n  ${gate}: '[^']+',`))
  })

  it('the catalog description names every live gate', () => {
    const catalog = read('packages/mcp/src/catalog.ts')
    const entry = /name: 'list_gate_findings',[\s\S]*?Filter by gate \(([^)]*)\)/.exec(catalog)
    expect(entry).not.toBeNull()
    expect(entry![1].split('|').map((s) => s.trim()).sort()).toEqual(live)
  })
})
