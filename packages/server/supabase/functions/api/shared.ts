import type { Context } from 'npm:hono@4';
import { getServiceClient } from '../_shared/db.ts';
import { reportError } from '../_shared/sentry.ts';

/**
 * capture a Supabase / Postgres error to Sentry AND return the
 * canonical 500 JSON response in one call. Most DB errors here returned
 * `c.json({ ok: false, error: { code: 'DB_ERROR', ... } }, 500)` directly
 * which sidesteps Hono's `app.onError` (no throw → no capture). That made
 * production drift like the 04-20 `nl_query_history.is_saved` 500 invisible
 * to Sentry. This helper centralises both behaviours so missing-column /
 * RLS / pool-exhaustion failures all page someone going forward.
 *
 * Postgres error codes propagate through `code` so Sentry filters can
 * single out e.g. `42703` (undefined column) vs `42501` (permission).
 */
export function dbError(
  c: Context,
  err:
    | { message?: string; code?: string; details?: string | null; hint?: string | null }
    | null
    | undefined,
): Response {
  const captured = err instanceof Error ? err : new Error(err?.message ?? 'Unknown DB error');
  reportError(captured, {
    tags: {
      path: c.req.path,
      method: c.req.method,
      db_code: err?.code ?? 'unknown',
      error_type: 'db',
    },
    extra: {
      pg_code: err?.code ?? null,
      pg_details: err?.details ?? null,
      pg_hint: err?.hint ?? null,
    },
  });
  return c.json(
    { ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'Unknown DB error' } },
    500,
  );
}

// Resolve the set of project ids owned by the authenticated user. Used by
// every multi-tenant admin endpoint to scope queries — without this, any
// authenticated user could read every other project's data.
export async function ownedProjectIds(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  const { data } = await db.from('projects').select('id').eq('owner_id', userId);
  return (data ?? []).map((p) => p.id);
}
