/**
 * FILE: request-logging.ts
 * PURPOSE: Hono middleware for HTTP access logs with request correlation.
 *
 * OVERVIEW:
 * - Propagates or mints X-Request-Id for every request
 * - Logs start (debug) and completion (info/warn/error by status)
 * - Attaches trace-id fragment when W3C traceparent is present
 * - Suppresses OPTIONS noise; health checks stay at debug
 *
 * USAGE:
 *   app.use('*', requestLoggingMiddleware())
 *   const reqLog = getRequestLogger(c) // inside a route handler
 */

import type { Context, Next } from 'npm:hono@4'

import type { LogContext } from './log-context.ts'
import { log } from './logger.ts'
import { parseTraceparent } from './trace.ts'

const accessLog = log.child('http:access')

const QUIET_PATHS = new Set(['/health', '/api/health'])

function normalizePath(pathname: string): string {
  return pathname.replace(/^\/api(?=\/|$)/, '') || '/'
}

function isQuietPath(path: string): boolean {
  return QUIET_PATHS.has(path) || path.endsWith('/health')
}

/**
 * Hono middleware — register early so every route gets a request id.
 */
export function requestLoggingMiddleware() {
  return async (c: Context, next: Next) => {
    const started = Date.now()
    const req = c.req
    const url = new URL(req.url)
    const path = normalizePath(url.pathname)

    const requestId = req.header('x-request-id')?.trim() || crypto.randomUUID().slice(0, 12)
    c.set('requestId', requestId)
    c.header('X-Request-Id', requestId)

    const traceparent = req.header('traceparent')
    const traceParts = traceparent ? parseTraceparent(traceparent) : null
    const traceId = traceParts?.traceId?.slice(0, 16)

    const reqLog = accessLog.child('req', {
      requestId,
      ...(traceId ? { traceId } : {}),
    })

    const isOptions = req.method === 'OPTIONS'
    const quiet = isQuietPath(path)

    if (!isOptions && !quiet) {
      reqLog.debug('request.start', {
        method: req.method,
        path,
        ...(url.search ? { query: url.search } : {}),
      })
    }

    await next()

    const durationMs = Date.now() - started
    const status = c.res.status
    const logContext = c.get('logContext') as LogContext | undefined
    const doneMeta = {
      method: req.method,
      path,
      status,
      durationMs,
      ...(logContext?.projectId ? { projectId: logContext.projectId } : {}),
      ...(logContext?.authMethod ? { authMethod: logContext.authMethod } : {}),
      ...(logContext?.apiKeyPrefix ? { keyPrefix: logContext.apiKeyPrefix } : {}),
      ...(logContext?.userId && logContext.authMethod === 'jwt' ? { userId: logContext.userId } : {}),
    }

    if (isOptions) return

    if (quiet && status < 400) {
      reqLog.debug('request.done', doneMeta)
      return
    }

    if (status >= 500) {
      reqLog.error('request.done', doneMeta)
    } else if (status >= 400) {
      reqLog.warn('request.done', doneMeta)
    } else {
      reqLog.info('request.done', doneMeta)
    }
  }
}

/** Request-scoped logger — includes requestId from middleware context. */
export function getRequestLogger(c: Context) {
  const requestId = c.get('requestId') as string | undefined
  return requestId ? accessLog.child('req', { requestId }) : accessLog
}
