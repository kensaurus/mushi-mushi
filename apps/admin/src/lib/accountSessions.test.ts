/**
 * FILE: apps/admin/src/lib/accountSessions.test.ts
 * PURPOSE: Switching to a stored account reloads INTO the console (QA #14:
 *          it used to land on the domain root `/dashboard` in production),
 *          and a dead stored session never switches.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setSession: vi.fn(),
  hardNavigate: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { auth: { setSession: mocks.setSession, getSession: vi.fn() } },
  invalidateApiCache: vi.fn(),
}))
vi.mock('./appPath', () => ({ hardNavigate: mocks.hardNavigate }))
vi.mock('./authBroadcast', () => ({ notifyAccountSwitched: vi.fn() }))

import { getAccountsSnapshot, switchToAccount, upsertAccount } from './accountSessions'

function fakeSession(userId: string, email: string) {
  return {
    access_token: `access-${userId}`,
    refresh_token: `refresh-${userId}`,
    expires_at: 9_999_999_999,
    user: { id: userId, email, user_metadata: {}, app_metadata: {} },
  } as unknown as Parameters<typeof upsertAccount>[0]
}

describe('switchToAccount', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mocks.setSession.mockReset()
    mocks.hardNavigate.mockReset()
    upsertAccount(fakeSession('user-a', 'a@example.com'), true)
    upsertAccount(fakeSession('user-b', 'b@example.com'), false)
  })

  it('reloads the dashboard through the base-path-aware helper', async () => {
    const next = fakeSession('user-b', 'b@example.com')
    mocks.setSession.mockResolvedValue({ data: { session: next }, error: null })

    const result = await switchToAccount('user-b')

    expect(result).toEqual({})
    expect(mocks.hardNavigate).toHaveBeenCalledWith('/dashboard')
    expect(getAccountsSnapshot().activeUserId).toBe('user-b')
  })

  it('does not navigate when the stored session is dead', async () => {
    mocks.setSession.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid Refresh Token' } })

    const result = await switchToAccount('user-b')

    expect(result.error).toBe('Invalid Refresh Token')
    expect(mocks.hardNavigate).not.toHaveBeenCalled()
    expect(getAccountsSnapshot().accounts.find((a) => a.userId === 'user-b')?.needsReauth).toBe(true)
  })
})
