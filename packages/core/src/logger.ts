/**
 * FILE: logger.ts
 * PURPOSE: Zero-dependency structured logger for the mushi-mushi SDK ecosystem.
 *
 * OVERVIEW:
 * - Production-grade logging with levels, scoped namespaces, and child loggers
 * - JSON output for server/production, pretty-formatted output for development
 * - Automatic environment detection (browser vs Node vs Deno)
 * - Structured metadata on every log entry
 * - No external dependencies — safe to ship in any SDK bundle
 *
 * USAGE:
 *   import { createLogger } from '@mushi/core'
 *   const log = createLogger({ scope: 'mushi:api' })
 *   log.info('Request received', { method: 'POST', path: '/v1/reports' })
 *   const child = log.child('ingest', { reportId: 'abc' })
 *   child.warn('Slow query', { latencyMs: 420 })
 *
 * TECHNICAL DETAILS:
 * - Log levels: debug(10) < info(20) < warn(30) < error(40) < fatal(50) < silent(99)
 * - Format auto-detected: JSON in production/server, pretty in development
 * - Pretty format uses ANSI colors when supported (Node/Deno TTY)
 * - Child loggers inherit parent scope + metadata, can override level
 * - Timestamps are ISO 8601 with millisecond precision
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'

export type LogFormat = 'json' | 'pretty' | 'auto'

export interface LoggerOptions {
  scope: string
  level?: LogLevel
  meta?: Record<string, unknown>
  format?: LogFormat
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  fatal(msg: string, meta?: Record<string, unknown>): void
  child(scope: string, meta?: Record<string, unknown>): Logger
  setLevel(level: LogLevel): void
}

export interface LogEntry {
  ts: string
  level: LogLevel
  scope: string
  msg: string
  [key: string]: unknown
}

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
  silent: 99,
}

const LEVEL_LABEL: Record<string, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  fatal: 'FTL',
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
} as const

const LEVEL_COLOR: Record<string, string> = {
  debug: ANSI.dim,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
  fatal: `${ANSI.bgRed}${ANSI.white}${ANSI.bold}`,
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function detectFormat(): 'json' | 'pretty' {
  try {
    if (typeof (globalThis as any).Deno !== 'undefined') return 'json'
  } catch { /* not Deno */ }

  const proc = typeof (globalThis as any).process !== 'undefined'
    ? (globalThis as any).process
    : undefined

  if (proc?.env) {
    if (proc.env.NODE_ENV === 'production') return 'json'
    if (proc.env.LOG_FORMAT === 'json') return 'json'
    if (proc.env.LOG_FORMAT === 'pretty') return 'pretty'
    if (proc.stdout?.isTTY) return 'pretty'
  }

  if (typeof (globalThis as any).window !== 'undefined') return 'pretty'

  return 'json'
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function flattenMeta(meta: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'object') {
      parts.push(`${k}=${JSON.stringify(v)}`)
    } else {
      parts.push(`${k}=${String(v)}`)
    }
  }
  return parts.join(' ')
}

function formatPretty(entry: LogEntry): string {
  const { ts, level, scope, msg, ...rest } = entry
  const time = ts.slice(11, 23)
  const color = LEVEL_COLOR[level] ?? ''
  const label = LEVEL_LABEL[level] ?? level.toUpperCase()
  const metaStr = Object.keys(rest).length > 0 ? ` ${ANSI.dim}${flattenMeta(rest)}${ANSI.reset}` : ''

  return `${ANSI.dim}${time}${ANSI.reset} ${color}${label}${ANSI.reset} ${ANSI.cyan}[${scope}]${ANSI.reset} ${msg}${metaStr}`
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry)
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
  formatter: (entry: LogEntry) => string,
): Logger {
  let currentLevel = minLevel

  function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_VALUE[level] < LEVEL_VALUE[currentLevel]) return

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg,
      ...baseMeta,
      ...meta,
    }

    emit(level, formatter(entry))
  }

  return {
    debug: (msg, meta?) => log('debug', msg, meta),
    info: (msg, meta?) => log('info', msg, meta),
    warn: (msg, meta?) => log('warn', msg, meta),
    error: (msg, meta?) => log('error', msg, meta),
    fatal: (msg, meta?) => log('fatal', msg, meta),

    child(childScope: string, childMeta?: Record<string, unknown>): Logger {
      return buildLogger(
        `${scope}:${childScope}`,
        currentLevel,
        { ...baseMeta, ...childMeta },
        formatter,
      )
    },

    setLevel(level: LogLevel) {
      currentLevel = level
    },
  }
}

/**
 * Create a structured logger instance.
 *
 * @example
 * const log = createLogger({ scope: 'mushi:api', level: 'info' })
 * log.info('Server started', { port: 3000 })
 *
 * const child = log.child('auth', { userId: 'u-123' })
 * child.warn('Token expired')
 */
export function createLogger(options: LoggerOptions): Logger {
  const {
    scope,
    level = 'info',
    meta = {},
    format = 'auto',
  } = options

  const resolvedFormat = format === 'auto' ? detectFormat() : format
  const formatter = resolvedFormat === 'json' ? formatJson : formatPretty

  return buildLogger(scope, level, meta, formatter)
}

/**
 * Noop logger that discards all output.
 * Useful when logging should be completely disabled.
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
  setLevel: () => {},
}
