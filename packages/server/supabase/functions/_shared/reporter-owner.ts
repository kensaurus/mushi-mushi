/**
 * FILE: packages/server/supabase/functions/_shared/reporter-owner.ts
 * PURPOSE: Is a report's reporter the project's owner? (2026-11-20)
 *
 * The bug card in Slack names only the owner ("kenji (owner)"); everyone else
 * shows as initials, "a user" or "anonymous" (_shared/slack.ts reporterLabel).
 * The owner is the reporter when the end user's email_hash (SHA-256 of the
 * trimmed, lowercased email, end-user-identity.ts) equals the hash of the
 * project owner's auth email. Anything unknown or failing is "not the owner":
 * the card then shows initials, never a full name.
 */

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; auth?: { admin?: { getUserById?: (id: string) => Promise<{ data?: { user?: { email?: string | null } | null } | null }> } } }

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** True only when the end user is provably the project's owner. Never throws. */
export async function reporterIsProjectOwner(db: Db, projectId: string | null | undefined, endUserId: string | null | undefined): Promise<boolean> {
  if (!projectId || !endUserId) return false
  try {
    const [{ data: eu }, { data: project }] = await Promise.all([
      db.from('end_users').select('email_hash').eq('id', endUserId).maybeSingle(),
      db.from('projects').select('owner_id').eq('id', projectId).maybeSingle(),
    ])
    const hash = (eu as { email_hash?: string | null } | null)?.email_hash
    const ownerId = (project as { owner_id?: string | null } | null)?.owner_id
    if (!hash || !ownerId || !db.auth?.admin?.getUserById) return false
    const { data } = await db.auth.admin.getUserById(ownerId)
    const email = data?.user?.email?.trim().toLowerCase()
    return Boolean(email) && (await sha256Hex(email!)) === hash
  } catch {
    return false
  }
}
