/**
 * byok_keys.vault_secret_id and every vault://<id> ref hold the Vault UUID
 * that vault_store_secret returns, and vault_get_secret is a thin alias over
 * vault_lookup. Until 20261010130000 the repo's vault_lookup matched `name`
 * only, so self-host and Helm installs could not dereference those refs
 * (the hosted project had the by-id fallback outside the migration history).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261010130000_vault_lookup_by_id.sql'),
  'utf8',
)
const body = sql.replace(/^--.*$/gm, '')

describe('20261010130000_vault_lookup_by_id', () => {
  it('matches by name first, then by id when the input is a UUID', () => {
    const byName = body.indexOf('where name = secret_name')
    const byId = body.indexOf('where id = secret_name::uuid')
    expect(byName).toBeGreaterThanOrEqual(0)
    expect(byId).toBeGreaterThan(byName)
    expect(body).toMatch(/if v is null and secret_name ~\* '\^\[0-9a-f\]\{8\}-/)
  })

  it('stays a service-role-only security definer that fails soft', () => {
    expect(body).toMatch(/security definer\s+set search_path = vault, public/)
    expect(body).toMatch(/exception when others then\s+return null;/)
    expect(body).toMatch(/revoke all on function public\.vault_lookup\(text\) from public, anon, authenticated;/)
    expect(body).toMatch(/grant execute on function public\.vault_lookup\(text\) to service_role;/)
  })
})
