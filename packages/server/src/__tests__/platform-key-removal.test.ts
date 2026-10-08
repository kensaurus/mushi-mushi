/**
 * FILE: packages/server/src/__tests__/platform-key-removal.test.ts
 * PURPOSE: "Remove key" on an integration card clears the project's stored
 *          secrets and deletes only the Vault secrets that are provably its
 *          own (exact per-project name, not shared with another project).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  removePlatformKeys,
  type PlatformKeyStore,
} from '../../supabase/functions/_shared/platform-key-removal.ts'

const P = 'proj-1'
const own = (field: string, kind = 'sentry', project = P) => `vault://mushi/integration/${project}/${kind}/${field}`

function fakeStore(row: Record<string, unknown> | null, opts: { shared?: string[]; clearError?: string; deleteError?: string } = {}) {
  const log: string[] = []
  const store: PlatformKeyStore = {
    readFields: async () => ({ row, error: null }),
    clearFields: async (fields) => {
      log.push(`clear:${fields.join(',')}`)
      return opts.clearError ?? null
    },
    refUsedElsewhere: async (_field, ref) => (opts.shared ?? []).includes(ref),
    deleteVaultSecret: async (name) => {
      log.push(`delete:${name}`)
      return opts.deleteError ?? null
    },
  }
  return { store, log }
}

const FIELDS = ['sentry_auth_token_ref', 'sentry_webhook_secret']

describe('removePlatformKeys', () => {
  it('clears the row first, then deletes the project-owned Vault secrets', async () => {
    const { store, log } = fakeStore({
      sentry_auth_token_ref: own('sentry_auth_token_ref'),
      sentry_webhook_secret: own('sentry_webhook_secret'),
    })
    const res = await removePlatformKeys(store, { projectId: P, kind: 'sentry', fields: FIELDS })
    expect(res.error).toBeNull()
    expect(res.cleared).toEqual(FIELDS)
    expect(log[0]).toBe('clear:sentry_auth_token_ref,sentry_webhook_secret')
    expect(res.deletedSecrets).toEqual([
      'mushi/integration/proj-1/sentry/sentry_auth_token_ref',
      'mushi/integration/proj-1/sentry/sentry_webhook_secret',
    ])
  })

  it('never deletes a Vault secret named for another project', async () => {
    // Bulk apply can copy another project's ref verbatim.
    const { store, log } = fakeStore({ sentry_auth_token_ref: own('sentry_auth_token_ref', 'sentry', 'proj-2') })
    const res = await removePlatformKeys(store, { projectId: P, kind: 'sentry', fields: FIELDS })
    expect(res.cleared).toEqual(['sentry_auth_token_ref'])
    expect(res.deletedSecrets).toEqual([])
    expect(log.some((l) => l.startsWith('delete:'))).toBe(false)
  })

  it('keeps an own secret that another project still points at', async () => {
    const ref = own('sentry_auth_token_ref')
    const { store, log } = fakeStore({ sentry_auth_token_ref: ref }, { shared: [ref] })
    const res = await removePlatformKeys(store, { projectId: P, kind: 'sentry', fields: FIELDS })
    expect(res.keptSecrets).toEqual(['mushi/integration/proj-1/sentry/sentry_auth_token_ref'])
    expect(log.some((l) => l.startsWith('delete:'))).toBe(false)
  })

  it('clears a raw (non-vault) value without touching Vault', async () => {
    const { store, log } = fakeStore({ sentry_webhook_secret: 'plain-legacy-secret' })
    const res = await removePlatformKeys(store, { projectId: P, kind: 'sentry', fields: FIELDS })
    expect(res.cleared).toEqual(['sentry_webhook_secret'])
    expect(log).toEqual(['clear:sentry_webhook_secret'])
  })

  it('touches Vault not at all when the row update fails', async () => {
    const { store, log } = fakeStore({ sentry_auth_token_ref: own('sentry_auth_token_ref') }, { clearError: 'denied' })
    const res = await removePlatformKeys(store, { projectId: P, kind: 'sentry', fields: FIELDS })
    expect(res.error).toBe('denied')
    expect(res.cleared).toEqual([])
    expect(log.some((l) => l.startsWith('delete:'))).toBe(false)
  })

  it('reports a failed Vault delete as kept, not as an error', async () => {
    const { store } = fakeStore({ sentry_auth_token_ref: own('sentry_auth_token_ref') }, { deleteError: 'vault down' })
    const res = await removePlatformKeys(store, { projectId: P, kind: 'sentry', fields: FIELDS })
    expect(res.error).toBeNull()
    expect(res.keptSecrets).toHaveLength(1)
  })

  it('is a no-op when nothing is stored', async () => {
    const { store, log } = fakeStore(null)
    const res = await removePlatformKeys(store, { projectId: P, kind: 'sentry', fields: FIELDS })
    expect(res).toEqual({ cleared: [], deletedSecrets: [], keptSecrets: [], error: null })
    expect(log).toEqual([])
  })
})

describe('DELETE /v1/admin/integrations/platform/:kind/key', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/integrations.ts'), 'utf8')
  const start = src.indexOf("app.delete('/v1/admin/integrations/platform/:kind/key'")
  const body = src.slice(start, src.indexOf('\n  // -----', start))

  it('is console-only (jwtAuth) with the same owner/admin gate as Save', () => {
    expect(start).toBeGreaterThan(0)
    expect(body).toMatch(/jwtAuth, async/)
    expect(body).toMatch(/requireProjectAdmin\(c, project\)/)
  })

  it('is audited', () => {
    expect(body).toMatch(/logAudit\(db, projectId, userId, 'settings\.deleted', 'integration_platform'/)
  })

  it('treats an unreadable sharing check as shared (never deletes on doubt)', () => {
    expect(body).toMatch(/return Boolean\(error\) \|\| \(data \?\? \[\]\)\.length > 0/)
  })
})
