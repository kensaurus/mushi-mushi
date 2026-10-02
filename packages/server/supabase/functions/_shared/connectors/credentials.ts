/**
 * FILE: packages/server/supabase/functions/_shared/connectors/credentials.ts
 * PURPOSE: Connector credentials live only in Supabase Vault. Rows hold a
 *          `vault://<uuid>` ref; the value is read at call time and never
 *          returned to a client or logged (only a short prefix is shown).
 */

import type { getServiceClient } from '../db.ts'

type Db = ReturnType<typeof getServiceClient>

export async function storeCredential(db: Db, name: string, value: string): Promise<string> {
  const { data, error } = await db.rpc('vault_store_secret', { secret_name: name, secret_value: value })
  if (error || typeof data !== 'string') throw new Error(`could not store the credential in Vault: ${error?.message ?? 'no id'}`)
  return `vault://${data}`
}

export async function resolveCredential(db: Db, ref: string | null | undefined): Promise<string | null> {
  if (!ref || !ref.startsWith('vault://')) return null
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: ref.slice('vault://'.length) })
  if (error || typeof data !== 'string' || !data) return null
  return data
}

