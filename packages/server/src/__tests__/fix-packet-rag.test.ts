/**
 * FILE: fix-packet-rag.test.ts
 * PURPOSE: The report detail page must be able to skip the code-index
 *          embedding. That lookup retries for up to ~15s and it used to
 *          hold the whole GET /v1/admin/reports/:id response. fix-context
 *          still includes it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const { getRelevantCode } = vi.hoisted(() => ({
  getRelevantCode: vi.fn(async () => [] as Array<{ filePath: string; preview: string; similarity: number }>),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/rag.ts', () => ({ getRelevantCode }))
vi.mock('../../supabase/functions/_shared/knowledge-graph.ts', () => ({ getBlastRadius: async () => [] }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  canAccessReportProject: async () => true,
  dbError: () => new Response(),
  parseUuidParam: () => ({ ok: false }),
}))

const ROW = {
  id: 'be0ecaf0-cfee-4929-a4b4-d4a15d135acf',
  project_id: '11111111-2222-4333-8444-555555555555',
  summary: 'Checkout button does nothing',
  severity: 'high',
  category: 'visual',
  component: 'ReportDetailHeader',
  confidence: 0.8,
  stage2_analysis: { rootCause: 'The heading is a filled accent box.' },
}

let buildReportFixPacket: (
  db: unknown,
  row: Record<string, unknown>,
  anchor: null,
  options?: { includeRag?: boolean },
) => Promise<{ fixPacket: string | null; ragFiles: unknown[] }>

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (name: string) => string | undefined } } }).Deno = {
    env: { get: () => undefined },
  }
  const mod = await import('../../supabase/functions/api/routes/report-agent-context.ts')
  buildReportFixPacket = mod.buildReportFixPacket
})

describe('buildReportFixPacket RAG', () => {
  it('does not call the embedding lookup when includeRag is false', async () => {
    getRelevantCode.mockImplementation(() => new Promise(() => {}))
    const outcome = await Promise.race([
      buildReportFixPacket({}, ROW, null, { includeRag: false }).then((result) => result.fixPacket),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 200)),
    ])
    expect(outcome).not.toBe('hung')
    expect(getRelevantCode).not.toHaveBeenCalled()
    expect(outcome).toContain('Checkout button does nothing')
    expect(outcome).not.toContain('### `')
  })

  it('quotes code-index files when RAG is left on', async () => {
    getRelevantCode.mockResolvedValue([
      { filePath: 'apps/admin/src/components/report-detail/ReportDetailHeader.tsx', preview: 'export function ReportDetailHeader', similarity: 0.9 },
    ])
    const result = await buildReportFixPacket({}, ROW, null)
    expect(getRelevantCode).toHaveBeenCalledOnce()
    expect(result.fixPacket).toContain('ReportDetailHeader.tsx')
    expect(result.ragFiles).toHaveLength(1)
  })

  it('still returns the packet when the embedding lookup throws', async () => {
    getRelevantCode.mockRejectedValue(new Error('embed failed'))
    const result = await buildReportFixPacket({}, ROW, null, { includeRag: true })
    expect(result.fixPacket).toContain('The heading is a filled accent box.')
    expect(result.ragFiles).toEqual([])
  })

  it('the detail route skips RAG only for rag=0; fix-context still includes it', () => {
    const routesDir = resolve(__dirname, '../../supabase/functions/api/routes')
    const reports = readFileSync(resolve(routesDir, 'reports.ts'), 'utf8')
    const context = readFileSync(resolve(routesDir, 'report-agent-context.ts'), 'utf8')
    expect(reports).toContain("c.req.query('rag') !== '0'")
    expect(reports).toContain('includeRag')
    expect(context).toContain('const { fixPacket, ragFiles } = await buildReportFixPacket(db, row, anchor)')
    expect(context).toContain('fix_prompt: fixPacket')
  })
})
