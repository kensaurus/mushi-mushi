/**
 * FILE: logger.ts
 * PURPOSE: Structured JSON logger for Supabase Edge Functions (Deno runtime).
 *
 * OVERVIEW:
 * - Always outputs structured JSON — optimal for Supabase log aggregation
 * - Scoped loggers with hierarchical namespaces (e.g., mushi:api:ingest)
 * - Child loggers inherit parent scope and metadata
 * - Zero dependencies, Deno-native
 *
 * USAGE:
 *   import { log } from '../_shared/logger.ts'
 *   log.info('Request received', { method: 'POST', path: '/v1/reports' })
 *   const child = log.child('ingest', { reportId: 'abc' })
 *   child.error('Insert failed', { table: 'reports' })
 */

import { reportMessage } from './sentry.ts'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

interface LogEntry {
  ts: string
  level: LogLevel
  scope: string
  msg: string
  [key: string]: unknown
}

interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  fatal(msg: string, meta?: Record<string, unknown>): void
  child(scope: string, meta?: Record<string, unknown>): Logger
}

function emit(level: LogLevel, formatted: string): void {
  switch (level) {
    case 'error':
    case 'fatal':
      console.error(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    default:
      console.log(formatted)
  }
}

function buildLogger(
  scope: string,
  minLevel: LogLevel,
  baseMeta: Record<string, unknown>,
): Logger {
  function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_VALUE[level] < LEVEL_VALUE[minLevel]) return

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg,
      ...baseMeta,
      ...meta,
    }

    emit(level, JSON.stringify(entry))

    // Forward errors and fatals to Sentry as a single chokepoint — every
    // call site that already does `log.error(...)` gets monitoring for free.
    // No-op when Sentry isn't initialized (local dev, self-hosted forks).
    if (level === 'error' || level === 'fatal') {
      reportMessage(msg, level === 'fatal' ? 'fatal' : 'error', {
        tags: { scope },
        extra: { ...baseMeta, ...meta },
      })
    }
  }

  return {
    debug: (msg, meta?) => write('debug', msg, meta),
    info: (msg, meta?) => write('info', msg, meta),
    warn: (msg, meta?) => write('warn', msg, meta),
    error: (msg, meta?) => write('error', msg, meta),
    fatal: (msg, meta?) => write('fatal', msg, meta),

    child(childScope: string, childMeta?: Record<string, unknown>): Logger {
      return buildLogger(
        `${scope}:${childScope}`,
        minLevel,
        { ...baseMeta, ...childMeta },
      )
    },
  }
}

/** Root logger for all edge functions — scope: mushi */
export const log = buildLogger('mushi', 'info', {})

export type { Logger, LogLevel, LogEntry }
