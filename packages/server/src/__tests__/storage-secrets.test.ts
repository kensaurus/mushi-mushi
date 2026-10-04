/**
 * FILE: packages/server/src/__tests__/storage-secrets.test.ts
 * PURPOSE: BYO storage keys can be saved from the console.
 *
 * Why (2026-10-04, QA entry 147): the /storage form asked for "Vault refs"
 * the server never accepted (only names under mushi/storage/<projectId>/,
 * which nothing in the console could create). The PUT now takes the raw key,
 * stores it in Vault under that prefix and keeps only the name, which the
 * storage reader (vault-ref.ts) accepts.
 */
import { describe, expect, it, vi } from 'vitest'
import { storeStorageSecrets } from '../../supabase/functions/_shared/storage-secrets.ts'
import { isProjectStorageSecretRef } from '../../supabase/functions/_shared/vault-ref.ts'

const PID = '11111111-1111-4111-8111-111111111111'

describe('storeStorageSecrets', () => {
  it('stores each raw key under the project prefix and returns names the reader accepts', async () => {
    const rpc = vi.fn(async () => ({ data: 'uuid', error: null }))
    const r = await storeStorageSecrets({ rpc }, PID, { access_key: ' AKIA123 ', secret_key: 'shh', bucket: 'b' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.refs).toEqual({
      access_key_vault_ref: `mushi/storage/${PID}/access_key`,
      secret_key_vault_ref: `mushi/storage/${PID}/secret_key`,
    })
    for (const ref of Object.values(r.refs)) expect(isProjectStorageSecretRef(ref, PID)).toBe(true)
    // No p_project_id: it would demand a different (mushi_<pid>_) prefix.
    expect(rpc).toHaveBeenCalledWith('vault_store_secret', { secret_name: `mushi/storage/${PID}/access_key`, secret_value: 'AKIA123' })
  })

  it('skips blank fields so the saved key stays', async () => {
    const rpc = vi.fn()
    const r = await storeStorageSecrets({ rpc }, PID, { access_key: '', secret_key: null })
    expect(r).toEqual({ ok: true, refs: {} })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails the save, never storing a raw key in the row, when Vault refuses', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'denied' } }))
    const r = await storeStorageSecrets({ rpc }, PID, { service_account_json: '{"type":"service_account"}' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(500)
    expect(r.message).not.toMatch(/denied/)
  })

  it('rejects a non-string key', async () => {
    const r = await storeStorageSecrets({ rpc: vi.fn() }, PID, { access_key: 42 })
    expect(r.ok).toBe(false)
  })
})
