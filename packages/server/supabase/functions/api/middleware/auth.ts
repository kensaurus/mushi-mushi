/**
 * Hono middleware: require a valid Supabase JWT.
 * Thin wrapper around the shared `jwtAuth` so route files can import from
 * a local path (`../middleware/auth.ts`) without depending on `_shared/` directly.
 */
import type { Context, Next } from 'npm:hono@4'
import { jwtAuth } from '../../_shared/auth.ts'
import type { Variables } from '../types.ts'

export async function requireAuth(
  c: Context<{ Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  // jwtAuth sets c.set('userId'), c.set('userEmail'), c.set('authMethod')
  return jwtAuth(c as Context, next)
}
