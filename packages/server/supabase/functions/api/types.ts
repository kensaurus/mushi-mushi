/**
 * Hono context Variables shared across admin routes.
 * Set by requireAuth; read by route handlers via c.get('userId') etc.
 */
import type { LogContext } from '../_shared/log-context.ts'

export type { LogContext }

export interface Variables {
  /** Set by request-logging middleware — echoed on X-Request-Id response header. */
  requestId?: string
  /** Enriched after auth middleware — merged into access logs on request.done. */
  logContext?: LogContext
  userId: string
  userEmail: string
  // Must match the literal set in _shared/auth.ts (`c.set('authMethod', 'apiKey')`).
  // Previously declared as 'api_key', which type-checked but never matched the
  // runtime value, silently disabling any `authMethod === 'apiKey'` branch.
  authMethod: 'jwt' | 'apiKey'
  projectId?: string
  projectName?: string
  apiKeyId?: string
  apiKeyPrefix?: string
}
