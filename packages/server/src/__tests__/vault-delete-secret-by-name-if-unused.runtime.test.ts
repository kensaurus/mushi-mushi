/**
 * FILE: vault-delete-secret-by-name-if-unused.runtime.test.ts
 * PURPOSE: Execute migration 20261116090000's RPC on Postgres.
 *
 * OVERVIEW:
 * - A byok_keys row that still holds the Vault id keeps the secret.
 * - After that last pooled reference is gone, the same RPC deletes it.
 * - Covers the name the legacy column stores and the bare uuid form.
 *
 * DEPENDENCIES:
 * - @electric-sql/pglite
 * - migrations 20261021051628 (in-use check and vault_delete_secret_if_unused)
 *   and 20261116090000 (vault_delete_secret_by_name_if_unused)
 *
 * USAGE:
 * - Route tests in byok-legacy-routes.test.ts only record the call.
 * - This file is the regression for shared-secret preservation.
 *
 * NOTES:
 * - PGlite has no supabase_vault, so vault.secrets is a table with the id
 *   and name columns those functions read and delete.
 * - The byok_keys delete trigger from 20261021051628 is not installed.
 *   Dropping a key row only removes the reference; this RPC deletes the secret.
 * - No real key: the secret value is an obvious fake.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const PRIOR = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261021051628_byok_keys_universal_scope.sql'),
  'utf8',
)
const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261116090000_vault_delete_secret_by_name_if_unused.sql'),
  'utf8',
)

const SECRET_ID = '4000000a-0000-4000-8000-0000000000aa'
const SECRET_NAME = 'mushi/byok/1000000a-0000-4000-8000-000000000000/anthropic'
const UUID_SECRET_ID = '4000000a-0000-4000-8000-0000000000bb'
const UUID_SECRET_NAME = 'mushi/byok/1000000a-0000-4000-8000-000000000000/openai'
const KEY_A = '3000000a-0000-4000-8000-0000000000a1'
const KEY_B = '3000000a-0000-4000-8000-0000000000a2'
const PROJECT_A = '1000000a-0000-4000-8000-0000000000a1'
const PROJECT_B = '1000000a-0000-4000-8000-0000000000a2'

let db: PGlite

/** The two functions the new RPC calls, copied out of the earlier migration. */
function dependencySql(sql: string): string {
  const start = sql.indexOf('create or replace function private.vault_secret_in_use(')
  const end = sql.indexOf('create or replace function private.byok_keys_delete_vault_secret(')
  if (start < 0 || end <= start) {
    throw new Error('could not slice vault_secret_in_use and vault_delete_secret_if_unused')
  }
  return sql.slice(start, end)
}

describe('vault_delete_secret_by_name_if_unused on Postgres', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.waitReady
    const step = async (name: string, sql: string) => {
      try {
        await db.exec(sql)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${name}: ${message}`)
      }
    }
    await step(
      'schema',
      `
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema if not exists private;
      create schema if not exists vault;
      create table vault.secrets (
        id uuid primary key,
        name text,
        secret text
      );
      create table public.byok_keys (
        id uuid primary key,
        project_id uuid,
        provider_slug text,
        vault_secret_id uuid
      );
      create table public.project_settings (
        project_id uuid primary key,
        byok_anthropic_key_ref text,
        byok_openai_key_ref text,
        byok_firecrawl_key_ref text,
        byok_browserbase_key_ref text
      );
      create table public.organization_integration_settings (
        organization_id uuid primary key,
        token_ref text
      );
    `,
    )
    await step('in-use', dependencySql(PRIOR))
    await step('migration', MIGRATION)
  }, 60_000)

  afterAll(async () => {
    await db?.close()
  })

  beforeEach(async () => {
    await db.exec(`
      truncate table
        public.byok_keys,
        public.project_settings,
        public.organization_integration_settings,
        vault.secrets;
    `)
  })

  async function deleted(address: string): Promise<number> {
    const result = await db.query<{ deleted: number | string }>(
      'select public.vault_delete_secret_by_name_if_unused($1::text) as deleted',
      [address],
    )
    return Number(result.rows[0].deleted)
  }

  async function secretValue(id: string): Promise<string | null> {
    const result = await db.query<{ secret: string | null }>(
      'select secret from vault.secrets where id = $1::uuid',
      [id],
    )
    return result.rows[0]?.secret ?? null
  }

  async function seedPooled(id: string, name: string) {
    await db.query(
      `insert into vault.secrets (id, name, secret) values ($1::uuid, $2, 'sk-FAKE-shared')`,
      [id, name],
    )
    await db.query(
      `insert into public.byok_keys (id, project_id, provider_slug, vault_secret_id) values
         ($1::uuid, $2::uuid, 'anthropic', $3::uuid),
         ($4::uuid, $5::uuid, 'anthropic', $3::uuid)`,
      [KEY_A, PROJECT_A, id, KEY_B, PROJECT_B],
    )
  }

  it.each([
    ['name', SECRET_NAME, SECRET_ID, SECRET_NAME],
    ['uuid', UUID_SECRET_ID, UUID_SECRET_ID, UUID_SECRET_NAME],
  ] as const)(
    'a pooled reference preserves the secret addressed by %s, and the last removal deletes it',
    async (_label, address, id, name) => {
      await seedPooled(id, name)

      expect(await deleted(address)).toBe(0)
      expect(await secretValue(id)).toBe('sk-FAKE-shared')

      await db.query('delete from public.byok_keys where id = $1::uuid', [KEY_A])
      expect(await deleted(address)).toBe(0)
      expect(await secretValue(id)).toBe('sk-FAKE-shared')

      await db.query('delete from public.byok_keys where id = $1::uuid', [KEY_B])
      expect(await deleted(address)).toBe(1)
      expect(await secretValue(id)).toBeNull()
      expect(await deleted(address)).toBe(0)
    },
  )
})
