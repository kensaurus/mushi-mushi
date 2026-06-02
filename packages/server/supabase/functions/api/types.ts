/**
 * Hono context Variables shared across admin routes.
 * Set by requireAuth; read by route handlers via c.get('userId') etc.
 */
export interface Variables {
  userId: string
  userEmail: string
  // Must match the literal set in _shared/auth.ts (`c.set('authMethod', 'apiKey')`).
  // Previously declared as 'api_key', which type-checked but never matched the
  // runtime value, silently disabling any `authMethod === 'apiKey'` branch.
  authMethod: 'jwt' | 'apiKey'
  projectId?: string
  projectName?: string
}
