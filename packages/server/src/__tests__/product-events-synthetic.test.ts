/**
 * FILE: packages/server/src/__tests__/product-events-synthetic.test.ts
 * PURPOSE: A synthetic fresh-eyes account (ADR 0051) never writes a server
 *          product event: not for its own user id, not about a project it
 *          owns. A failed check records the event and warns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SELF = '00000000-0000-4000-8000-000000000001'
const SYNTH_USER = '33333333-3333-4333-8333-333333333333'
const SYNTH_PROJECT = '44444444-4444-4444-8444-444444444444'
const REAL_PROJECT = '22222222-2222-4222-8222-222222222222'

const warn = vi.fn()
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: (...a: unknown[]) => warn(...a), error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/background.ts', () => ({ keepAlive: <T,>(p: Promise<T>) => p }))

type Row = Record<string, unknown>

function fakeDb(rows: Row[], rpc: (args: { p_user_id: string | null; p_project_id: string | null }) => Promise<{ data: unknown; error: { message: string } | null }>) {
  return {
    rpc: (_name: string, args: { p_user_id: string | null; p_project_id: string | null }) => rpc(args),
    from: (table: string) => {
      if (table === 'mushi_runtime_config') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      if (table === 'end_users') return { upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'eu-1' }, error: null }) }) }) }
      if (table === 'projects') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: 'org-self' }, error: null }) }) }) }
      return {
        insert: async (row: Row) => {
          rows.push(row)
          return { error: null }
        },
      }
    },
  }
}

const synthetic = async (a: { p_user_id: string | null; p_project_id: string | null }) => ({ data: a.p_user_id === SYNTH_USER || a.p_project_id === SYNTH_PROJECT, error: null })

async function load() {
  vi.resetModules()
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'MUSHI_SELF_PROJECT_ID' ? SELF : undefined) } })
  return (await import('../../supabase/functions/_shared/product-events.ts')).emitProductEvent
}

beforeEach(() => warn.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('synthetic accounts write no product events', () => {
  it('skips an event for a synthetic console user', async () => {
    const rows: Row[] = []
    const emit = await load()
    expect(await emit(fakeDb(rows, synthetic) as never, { userId: SYNTH_USER, eventName: 'project_created', surface: 'server', properties: { project_id: REAL_PROJECT } })).toBe(false)
    expect(rows).toHaveLength(0)
  })

  it('skips an event about a project a synthetic account owns, with no user id', async () => {
    const rows: Row[] = []
    const emit = await load()
    expect(await emit(fakeDb(rows, synthetic) as never, { eventName: 'first_report_received', surface: 'server', properties: { project_id: SYNTH_PROJECT } })).toBe(false)
    expect(rows).toHaveLength(0)
  })

  it('records a real user', async () => {
    const rows: Row[] = []
    const emit = await load()
    expect(await emit(fakeDb(rows, synthetic) as never, { userId: '55555555-5555-4555-8555-555555555555', eventName: 'project_created', surface: 'server', properties: { project_id: REAL_PROJECT } })).toBe(true)
    expect(rows).toHaveLength(1)
  })

  it('records the event and warns when the check fails', async () => {
    const rows: Row[] = []
    const emit = await load()
    await emit(fakeDb(rows, async () => ({ data: null, error: { message: 'function is_synthetic_subject does not exist' } })) as never, {
      userId: SYNTH_USER,
      eventName: 'project_created',
      surface: 'server',
      properties: { project_id: REAL_PROJECT },
    })
    expect(rows).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('product-events: synthetic check failed, event recorded', expect.anything())
  })
})
