/**
 * FILE: packages/server/supabase/functions/_shared/api-key-mint.ts
 * PURPOSE: One way to hash and mint a project API key. auth.ts looks keys up
 *          by `hashApiKey`, so every minter that stores `key_hash` through
 *          `mintProjectApiKey` stays byte-compatible with the lookup.
 *
 * The plaintext key is returned to the caller once and never stored.
 */

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }

/** SHA-256 of a raw API key, lowercase hex, as stored in `project_api_keys.key_hash`. */
export async function hashApiKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface MintedApiKey {
  id: string | null
  /** The plaintext key: show it once, never store it. */
  key: string
  prefix: string
}

/**
 * Insert a new active project key with exactly `scopes` and return its
 * plaintext once. Scope validation is the caller's job (and the
 * project_api_keys.scopes CHECK's).
 */
export async function mintProjectApiKey(
  db: Db,
  input: { projectId: string; label: string; scopes: readonly string[] },
): Promise<{ ok: true; minted: MintedApiKey } | { ok: false; error: { message?: string; code?: string } }> {
  const key = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
  const prefix = key.slice(0, 12)
  const { data, error } = await db
    .from('project_api_keys')
    .insert({
      project_id: input.projectId,
      key_hash: await hashApiKey(key),
      key_prefix: prefix,
      label: input.label,
      scopes: [...input.scopes],
      is_active: true,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error }
  return { ok: true, minted: { id: (data as { id?: string } | null)?.id ?? null, key, prefix } }
}
