/**
 * Hono middleware: require a valid Supabase JWT or MCP API key (read/write by HTTP method).
 */
import type { Context, Next } from 'npm:hono@4'
import { adminOrApiKey, jwtAuth, type McpScope } from '../../_shared/auth.ts'
import type { Variables } from '../types.ts'

export async function requireAuth(
  c: Context<{ Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  // jwtAuth sets c.set('userId'), c.set('userEmail'), c.set('authMethod')
  return jwtAuth(c as Context, next)
}

/** JWT console session or MCP API key; write verbs require mcp:write. */
export async function requireAuthOrApiKey(
  c: Context<{ Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  const scope: McpScope = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)
    ? 'mcp:write'
    : 'mcp:read'
  return adminOrApiKey({ scope })(c as Context, next)
}
