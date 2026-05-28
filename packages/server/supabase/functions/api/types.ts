/**
 * Hono context Variables shared across admin routes.
 * Set by requireAuth; read by route handlers via c.get('userId') etc.
 */
export interface Variables {
  userId: string
  userEmail: string
  authMethod: 'jwt' | 'api_key'
  projectId?: string
}
