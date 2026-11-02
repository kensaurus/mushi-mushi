/**
 * FILE: report-rejection-counter.test.ts
 * PURPOSE: Every rejected report also adds 1 to the app's daily
 *          `report_ingest_rejections` row (count_report_ingest_rejection),
 *          so the console's pipeline view shows what reporters lost. The
 *          reason is the first issue as `path:code`, the SDK package only one
 *          of ours. The counter is fire-and-forget: a failed RPC, a missing
 *          function or a throwing client never reaches ingest, and warns once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// helpers.ts reads Deno.env at import time; vi.hoisted runs before the imports.
vi.hoisted(() => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
})

const state = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpc: (_fn: string, _args: Record<string, unknown>): Promise<unknown> => Promise.resolve({ data: null, error: null }),
  throwClient: false,
  background: [] as Promise<unknown>[],
  warns: [] as Array<{ msg: string; meta: unknown }>,
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.warn = (msg: string, meta: unknown) => state.warns.push({ msg, meta })
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    if (state.throwClient) throw new Error('SUPABASE_URL missing')
    return {
      rpc: (fn: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ fn, args })
        return state.rpc(fn, args)
      },
    }
  },
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: () => {}, reportMessage: () => {} }))
vi.mock('../../supabase/functions/_shared/background.ts', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  runInBackground: (task: Promise<unknown>) => {
    state.background.push(task)
  },
}))

import { logReportRejected } from '../../supabase/functions/api/helpers.ts'
import { rejectionReason, rejectionSdkPackage } from '../../supabase/functions/_shared/report-rejection.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const settle = () => Promise.all(state.background)
const counterWarns = () => state.warns.filter((w) => w.msg === 'report rejection counter failed')

beforeEach(() => {
  state.rpcCalls = []
  state.rpc = () => Promise.resolve({ data: null, error: null })
  state.throwClient = false
  state.background = []
  state.warns = []
})

describe('rejection counter helpers', () => {
  it('reason is the first issue as path:code, safe for host keys', () => {
    expect(rejectionReason([{ path: ['fingerprintHash'], code: 'invalid_string' }, { path: ['category'], code: 'invalid_enum_value' }])).toBe('fingerprintHash:invalid_string')
    expect(rejectionReason([{ path: ['breadcrumbs', 3, 'level'], code: 'invalid_enum_value' }])).toBe('breadcrumbs.#.level:invalid_enum_value')
    expect(rejectionReason([{ path: ['metadata', 'someone@example.com'], code: 'custom' }])).toBe('metadata.*:custom')
    expect(rejectionReason([])).toBe('(root):unknown')
  })

  it('SDK package only when it is one of ours', () => {
    expect(rejectionSdkPackage({ sdkPackage: '@mushi-mushi/react-native' })).toBe('@mushi-mushi/react-native')
    expect(rejectionSdkPackage({ sdkPackage: 'someone@example.com' })).toBe('')
    expect(rejectionSdkPackage({ sdkPackage: '@mushi-mushi/../x' })).toBe('')
    expect(rejectionSdkPackage(null)).toBe('')
    expect(rejectionSdkPackage(undefined)).toBe('')
  })
})

describe('logReportRejected counts the rejection', () => {
  it('calls count_report_ingest_rejection with the stage, reason and package', async () => {
    logReportRejected(P, 'submission', [{ path: ['fingerprintHash'], code: 'invalid_string' }], { sdkPackage: '@mushi-mushi/react-native' })
    await settle()
    expect(state.rpcCalls).toEqual([
      {
        fn: 'count_report_ingest_rejection',
        args: { p_project_id: P, p_stage: 'submission', p_reason: 'fingerprintHash:invalid_string', p_sdk_package: '@mushi-mushi/react-native' },
      },
    ])
    expect(state.warns.some((w) => w.msg === 'report rejected')).toBe(true)
  })

  it('a batch rejection with no body counts with an empty package', async () => {
    logReportRejected(P, 'batch', [{ path: ['reports'], code: 'too_small' }])
    await settle()
    expect(state.rpcCalls[0].args).toMatchObject({ p_stage: 'batch', p_reason: 'reports:too_small', p_sdk_package: '' })
  })

  it('never throws and warns once when the RPC errors, rejects or the client throws', async () => {
    state.rpc = () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'function not found' } })
    expect(() => logReportRejected(P, 'body', [{ path: ['description'], code: 'too_small' }])).not.toThrow()
    state.rpc = () => Promise.reject(new Error('network'))
    expect(() => logReportRejected(P, 'body', [{ path: ['description'], code: 'too_small' }])).not.toThrow()
    state.throwClient = true
    expect(() => logReportRejected(P, 'body', [{ path: ['description'], code: 'too_small' }])).not.toThrow()
    await settle()
    expect(counterWarns()).toHaveLength(1)
  })
})
