/**
 * FILE: packages/server/src/__tests__/self-org-guard.test.ts
 * PURPOSE: The company funnel resolves console users to end_users under the
 *          self project's organization. end_users are org-scoped, so a second
 *          project in that org re-mixes console users with its end users.
 *
 * Why (2026-09-22): the self project shared the founder's personal org with
 * six apps until migration 20260922000018 moved it into its own org. The
 * guard logs an error the first time the org is resolved if that ever
 * regresses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error, debug: () => {}, child: () => logger }
  return { log: logger }
})

const SELF = '00000000-0000-4000-8000-000000000001'

function fakeDb(projectsInOrg: number) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'end_users') {
        return {
          upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'eu-1' }, error: null }) }) }),
        }
      }
      return {
        select: (_cols: string, opts?: { head?: boolean }) => ({
          eq: (column: string, value: string) =>
            opts?.head
              ? Promise.resolve({ count: projectsInOrg, error: null, column, value })
              : { maybeSingle: async () => ({ data: { organization_id: 'org-self' }, error: null }) },
        }),
      }
    }),
  }
}

async function loadResolver() {
  vi.resetModules()
  vi.stubGlobal('Deno', { env: { get: (key: string) => (key === 'MUSHI_SELF_PROJECT_ID' ? SELF : undefined) } })
  return (await import('../../supabase/functions/_shared/product-events.ts')).resolveSelfEndUser
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => error.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('self organization guard', () => {
  it('stays quiet when the self org holds only the self project', async () => {
    const resolveSelfEndUser = await loadResolver()
    await expect(resolveSelfEndUser(fakeDb(1) as never, 'user-1')).resolves.toBe('eu-1')
    await flush()
    expect(error).not.toHaveBeenCalled()
  })

  it('logs an error when another project shares the self org', async () => {
    const resolveSelfEndUser = await loadResolver()
    await expect(resolveSelfEndUser(fakeDb(2) as never, 'user-1')).resolves.toBe('eu-1')
    await flush()
    expect(error).toHaveBeenCalledWith('product-events: self organization holds more than one project', {
      orgId: 'org-self',
      projects: 2,
    })
  })

  it('checks once per isolate, with the org id cached', async () => {
    const resolveSelfEndUser = await loadResolver()
    const db = fakeDb(2)
    await resolveSelfEndUser(db as never, 'user-1')
    await resolveSelfEndUser(db as never, 'user-2')
    await flush()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
