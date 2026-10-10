/**
 * requireServiceRoleAuth promises one generic 401 for "env missing" and
 * "token mismatched", so a scanner cannot tell them apart. It used to answer
 * the missing-env case with SERVER_MISCONFIGURED / "No internal auth
 * configured"; that is now logged server-side instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))

import { requireServiceRoleAuth } from '../../supabase/functions/_shared/auth.ts'

function withEnv(env: Record<string, string>) {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => env[k] } }
}
const call = (token: string) => new Request('https://x.test/fn', { headers: { Authorization: `Bearer ${token}` } })

afterEach(() => vi.clearAllMocks())

describe('requireServiceRoleAuth', () => {
  it('answers a missing env exactly like a wrong token, and logs the misconfiguration', async () => {
    withEnv({})
    const missing = requireServiceRoleAuth(call('anything'))
    withEnv({ MUSHI_INTERNAL_CALLER_SECRET: 'right' })
    const wrong = requireServiceRoleAuth(call('wrong'))
    expect(missing?.status).toBe(401)
    expect(await missing!.json()).toEqual(await wrong!.json())
    expect(fakeLog.error).toHaveBeenCalledTimes(1)
  })

  it('accepts the internal secret', () => {
    withEnv({ MUSHI_INTERNAL_CALLER_SECRET: 'right' })
    expect(requireServiceRoleAuth(call('right'))).toBeNull()
  })
})
