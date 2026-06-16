/**
 * FILE: log-context.ts
 * PURPOSE: Request-scoped auth metadata merged into HTTP access logs.
 */

export interface LogContext {
  projectId?: string
  authMethod?: 'jwt' | 'apiKey'
  userId?: string
  apiKeyId?: string
  apiKeyPrefix?: string
}

/** Merge auth fields into Hono context for access-log enrichment. */
export function mergeLogContext(
  existing: LogContext | undefined,
  patch: LogContext,
): LogContext {
  return { ...existing, ...patch }
}
