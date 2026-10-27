/**
 * FILE: fresh-eyes-shared.test.ts
 * PURPOSE: The server's fresh-eyes rules (ADR 0051) and the synthetic account
 *          sweep: identities are random and on a mailbox-less domain, expired
 *          accounts go with the projects and organizations they alone own,
 *          a shared organization keeps its account, and nothing is deleted
 *          before its 24 h.
 */

import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  blocksRefile,
  DEFAULT_SYNTHETIC_EMAIL_DOMAIN,
  expiredSyntheticAccounts,
  freshEyesShotPath,
  orgsOwnedAlone,
  syntheticEmailDomain,
  syntheticIdentity,
} from '../../supabase/functions/_shared/fresh-eyes.ts'
import { sweepSyntheticAccounts, type CleanupDb } from '../../supabase/functions/_shared/fresh-eyes-cleanup.ts'

const NOW = new Date('2026-10-28T03:00:00.000Z')
const U = '2a000000-0000-4000-8000-000000000001'
const U2 = '2a000000-0000-4000-8000-000000000002'
const REAL = '3a000000-0000-4000-8000-000000000003'

describe('synthetic identities', () => {
  it('are random, on the synthetic domain, with a 24 h expiry', () => {
    const bytes = new Uint8Array(34).map((_, i) => (i * 37) % 256)
    const a = syntheticIdentity(bytes, DEFAULT_SYNTHETIC_EMAIL_DOMAIN, NOW)
    expect(a.email).toMatch(/^fresh-eyes-[0-9a-f]{12}@synthetic\.kensaur\.us$/)
    expect(a.password.length).toBeGreaterThanOrEqual(20)
    expect(a.expiresAt).toBe('2026-10-29T03:00:00.000Z')
    expect(syntheticIdentity(new Uint8Array(34).fill(7), DEFAULT_SYNTHETIC_EMAIL_DOMAIN, NOW).email).not.toBe(a.email)
    expect(() => syntheticIdentity(new Uint8Array(10), 'x.test', NOW)).toThrow()
  })

  it('accept only a plain domain from the setting', () => {
    expect(syntheticEmailDomain('Test.Example.org ')).toBe('test.example.org')
    expect(syntheticEmailDomain('evil.com/x?')).toBe(DEFAULT_SYNTHETIC_EMAIL_DOMAIN)
    expect(syntheticEmailDomain(undefined)).toBe(DEFAULT_SYNTHETIC_EMAIL_DOMAIN)
  })
})

describe('rules', () => {
  it('screenshots stay inside the run folder', () => {
    expect(freshEyesShotPath('p', 'r', 's1-step07.png')).toBe('p/r/fresh-eyes/s1-step07.png')
    expect(freshEyesShotPath('p', 'r', '../s1-step07.png')).toBeNull()
    expect(freshEyesShotPath('p', 'r', 's11-step07.png')).toBeNull()
  })

  it('an open or dismissed report holds a finding; a fixed one does not', () => {
    expect(blocksRefile('new')).toBe(true)
    expect(blocksRefile('dismissed')).toBe(true)
    expect(blocksRefile('fixed')).toBe(false)
    expect(blocksRefile(null)).toBe(false)
  })

  it('expiry and sole ownership', () => {
    expect(expiredSyntheticAccounts([{ user_id: U, expires_at: '2026-10-28T02:59:59.000Z' }, { user_id: U2, expires_at: '2026-10-28T03:00:01.000Z' }], NOW).map((r) => r.user_id)).toEqual([U])
    expect(orgsOwnedAlone([{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], [{ organization_id: 'o1', user_id: U }, { organization_id: 'o2', user_id: REAL }], [{ organization_id: 'o3', owner_id: REAL }], U)).toEqual(['o1'])
  })
})

function cleanupDb(seed: Record<string, Array<Record<string, unknown>>>) {
  const db = makeFakeDb({ synthetic_accounts: [], projects: [], organizations: [], organization_members: [], end_users: [], product_events: [], ...seed })
  const deleted: string[] = []
  ;(db as unknown as { auth: CleanupDb['auth'] }).auth = {
    admin: {
      deleteUser: async (id: string) => {
        deleted.push(id)
        db.tables.synthetic_accounts = db.tables.synthetic_accounts!.filter((r) => r.user_id !== id)
        return { error: null }
      },
    },
  }
  return { db, deleted }
}

describe('sweepSyntheticAccounts', () => {
  it('deletes an expired account with its projects, its own organization, its person rows and its events', async () => {
    const { db, deleted } = cleanupDb({
      synthetic_accounts: [
        { user_id: U, expires_at: '2026-10-28T01:00:00.000Z' },
        { user_id: U2, expires_at: '2026-10-28T20:00:00.000Z' },
      ],
      projects: [
        { id: 'p1', owner_id: U, organization_id: 'o1' },
        { id: 'p-real', owner_id: REAL, organization_id: 'o-real' },
      ],
      organizations: [{ id: 'o1', owner_id: U }, { id: 'o-real', owner_id: REAL }],
      organization_members: [{ organization_id: 'o1', user_id: U }],
      end_users: [{ id: 'eu1', external_user_id: U }, { id: 'eu-real', external_user_id: REAL }],
      product_events: [
        { id: 1, end_user_id: 'eu1', properties: {} },
        { id: 2, end_user_id: null, properties: { project_id: 'p1' } },
        { id: 3, end_user_id: 'eu-real', properties: { project_id: 'p-real' } },
      ],
    })
    const stats = await sweepSyntheticAccounts(db as unknown as CleanupDb, NOW)
    expect(stats).toEqual({ accounts_deleted: 1, projects_deleted: 1, orgs_deleted: 1, failed: 0 })
    expect(deleted).toEqual([U])
    expect(db.tables.projects!.map((p) => p.id)).toEqual(['p-real'])
    expect(db.tables.organizations!.map((o) => o.id)).toEqual(['o-real'])
    expect(db.tables.end_users!.map((e) => e.id)).toEqual(['eu-real'])
    expect(db.tables.product_events!.map((e) => e.id)).toEqual([3])
    // Not yet expired: untouched.
    expect(db.tables.synthetic_accounts!.map((s) => s.user_id)).toEqual([U2])
  })

  it('keeps an account whose organization someone else joined, and says so', async () => {
    const warnings: string[] = []
    const { db, deleted } = cleanupDb({
      synthetic_accounts: [{ user_id: U, expires_at: '2026-10-28T01:00:00.000Z' }],
      organizations: [{ id: 'o1', owner_id: U }],
      organization_members: [{ organization_id: 'o1', user_id: U }, { organization_id: 'o1', user_id: REAL }],
    })
    const stats = await sweepSyntheticAccounts(db as unknown as CleanupDb, NOW, (m, ctx) => warnings.push(`${m}:${String(ctx.step)}`))
    expect(stats.accounts_deleted).toBe(0)
    expect(stats.failed).toBe(1)
    expect(deleted).toEqual([])
    expect(db.tables.organizations).toHaveLength(1)
    expect(warnings).toEqual(['synthetic_account_cleanup_failed:organizations_shared'])
  })

  it('does nothing when the table is not there yet', async () => {
    const db = makeFakeDb({}, { failRead: (t) => (t === 'synthetic_accounts' ? 'relation "synthetic_accounts" does not exist' : null) })
    ;(db as unknown as { auth: CleanupDb['auth'] }).auth = { admin: { deleteUser: async () => ({ error: null }) } }
    const warnings: string[] = []
    const stats = await sweepSyntheticAccounts(db as unknown as CleanupDb, NOW, (m) => warnings.push(m))
    expect(stats.accounts_deleted).toBe(0)
    expect(warnings).toEqual(['synthetic_accounts_select_failed'])
  })
})
