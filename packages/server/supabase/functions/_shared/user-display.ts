/**
 * FILE: packages/server/supabase/functions/_shared/user-display.ts
 * PURPOSE: Turn Mushi user ids (auth.users) into a name and email for the
 *          console, so activity feeds never show a raw UUID.
 *
 * Supabase has no display-name column, so the name comes from user metadata
 * (full_name → name → display_name), falling back to the email's local part
 * title-cased ("alice.dev" → "Alice Dev"). Ids are deduped so N rows by one
 * person cost one lookup. Same rule as the inviter and saved-query author
 * decorations in organizations.ts / query-fixes-repo.ts.
 */

export interface UserDisplay {
  email: string | null
  name: string | null
}

interface AuthUserLike {
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}

export function displayFromAuthUser(user: AuthUserLike | null | undefined): UserDisplay {
  if (!user) return { email: null, name: null }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const pick = (key: string): string | null => {
    const v = meta[key]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  let name = pick('full_name') ?? pick('name') ?? pick('display_name')
  if (!name && user.email) {
    const local = user.email.split('@')[0] ?? ''
    name =
      local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ') || null
  }
  return { email: user.email ?? null, name }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The all-zero id marks system actors (cron, retention sweep), not a person.
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

interface AdminAuthDb {
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: AuthUserLike | null } }>
    }
  }
}

/** Look up each distinct user id once. Unknown or failed lookups map to nulls. */
export async function resolveUserDisplays(
  db: AdminAuthDb,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, UserDisplay>> {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id) && UUID_RE.test(id!) && id !== NIL_UUID))]
  const out = new Map<string, UserDisplay>()
  await Promise.all(
    unique.map(async (id) => {
      try {
        const { data } = await db.auth.admin.getUserById(id)
        out.set(id, displayFromAuthUser(data.user))
      } catch {
        out.set(id, { email: null, name: null })
      }
    }),
  )
  return out
}
