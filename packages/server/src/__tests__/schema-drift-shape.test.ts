/**
 * backend-drift-scanner compares schema shapes, not raw reads: glot.it's 201
 * unchanged tables were reported as changed on every daily scan because the
 * previous read came back from jsonb with reordered keys and the row-count
 * estimate moved (2026-10-07).
 */
import { describe, expect, it } from 'vitest'
import { diffSchemaShapes, hashSchema, schemaShape, type TableInfo } from '../../supabase/functions/_shared/supabase-mcp-client.ts'

const table = (over: Partial<TableInfo> = {}): TableInfo => ({
  name: 'glot_tts_generation_budget',
  schema: 'public',
  rls_enabled: true,
  columns: [
    { name: 'day', type: 'date', nullable: false },
    { name: 'chars', type: 'integer', nullable: false },
  ],
  row_count_estimate: 2,
  ...over,
})

/** The same table as jsonb hands it back: keys reordered. */
const fromJsonb = (t: TableInfo): TableInfo =>
  JSON.parse(JSON.stringify({ name: t.name, schema: t.schema, columns: t.columns.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable })), rls_enabled: t.rls_enabled, row_count_estimate: t.row_count_estimate }))

describe('schema drift by shape', () => {
  it('reports nothing when only key order and row counts moved', async () => {
    const prev = [fromJsonb(table())]
    const curr = [table({ row_count_estimate: 9000 })]
    expect(diffSchemaShapes(prev, curr)).toEqual({ added: [], removed: [], modified: [] })
    expect(await hashSchema(schemaShape(prev))).toBe(await hashSchema(schemaShape(curr)))
  })

  it('still reports a changed column, RLS, an added and a removed table', () => {
    const prev = [table(), table({ name: 'gone' })]
    const curr = [
      table({ columns: [{ name: 'day', type: 'date', nullable: true }, { name: 'chars', type: 'integer', nullable: false }] }),
      table({ name: 'fresh', rls_enabled: false }),
    ]
    expect(diffSchemaShapes(prev, curr)).toEqual({ added: ['fresh'], removed: ['gone'], modified: ['glot_tts_generation_budget'] })
    expect(diffSchemaShapes([table()], [table({ rls_enabled: false })]).modified).toEqual(['glot_tts_generation_budget'])
  })

  it('ignores column order, which carries no meaning', () => {
    const reordered = table({ columns: [...table().columns].reverse() })
    expect(diffSchemaShapes([table()], [reordered]).modified).toEqual([])
  })
})
