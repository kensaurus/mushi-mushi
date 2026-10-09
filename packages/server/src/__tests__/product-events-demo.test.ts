/**
 * FILE: packages/server/src/__tests__/product-events-demo.test.ts
 * PURPOSE: /connect demo traffic must not be attributed to a person.
 *
 * Why (2026-09-22): the demo runs on one shared read-only key with no
 * account. The hosted MCP emits report_opened / fix_context_pulled with the
 * key owner's user id, so a stranger trying the demo would have counted
 * toward that owner's habit in the company funnel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SELF = '00000000-0000-4000-8000-000000000001'
const DEMO = '11111111-1111-4111-8111-111111111111'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/background.ts', () => ({
  keepAlive: <T,>(p: Promise<T>) => p,
}))

type Row = Record<string, unknown>

function fakeDb(rows: Row[]) {
  return {
    from: (table: string) => {
      if (table === 'mushi_runtime_config') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: DEMO }, error: null }) }) }),
        }
      }
      if (table === 'end_users') {
        return {
          upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'eu-1' }, error: null }) }) }),
        }
      }
      if (table === 'projects') {
        return {
          select: () => ({
            eq: (_c: string, _v: string) => ({
              maybeSingle: async () => ({ data: { organization_id: 'org-self' }, error: null }),
            }),
          }),
        }
      }
      return {
        insert: async (row: Row) => {
          rows.push(row)
          return { error: null }
        },
      }
    },
  }
}

async function load() {
  vi.resetModules()
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'MUSHI_SELF_PROJECT_ID' ? SELF : undefined) } })
  return (await import('../../supabase/functions/_shared/product-events.ts')).emitProductEvent
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('demo traffic is recorded but never attributed', () => {
  it('drops the person and tags the row when the event is about the demo project', async () => {
    const rows: Row[] = []
    const emit = await load()
    await emit(fakeDb(rows) as never, {
      userId: 'demo-owner',
      anonId: 'anon-1',
      eventName: 'report_opened',
      surface: 'mcp',
      properties: { report_id: 'r1', project_id: DEMO },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].end_user_id).toBeNull()
    expect(rows[0].anon_id).toBeNull()
    expect(rows[0].properties).toMatchObject({ demo: true, project_id: DEMO })
  })

  it('still attributes a real customer project to the console user', async () => {
    const rows: Row[] = []
    const emit = await load()
    await emit(fakeDb(rows) as never, {
      userId: 'real-user',
      eventName: 'report_opened',
      surface: 'mcp',
      properties: { report_id: 'r2', project_id: '22222222-2222-4222-8222-222222222222' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].end_user_id).toBe('eu-1')
    expect(rows[0].properties).not.toHaveProperty('demo')
  })
})
