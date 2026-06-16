/**
 * FILE: logger.ts
 * PURPOSE: Structured logger for Supabase Edge Functions (Deno runtime).
 *
 * OVERVIEW:
 * - JSON in production; human-readable pretty lines in local dev
 * - Scoped child loggers (e.g. mushi:api:http:access)
 * - Configurable level via MUSHI_LOG_LEVEL / LOG_LEVEL
 * - Automatic redaction of secrets before emit
 * - Dedicated audit channel (`event: audit`) for grep-friendly trails
 * - Errors/fatals forward to Sentry via reportMessage unless `sentry: false`
 *
 * USAGE:
 *   import { log, createLogger } from '../_shared/logger.ts'
 *   log.info('Request received', { method: 'POST', path: '/v1/reports' })
 *   const child = log.child('ingest', { reportId: 'abc' })
 *   child.audit('report.created', { projectId, reportId })
 */

import { reportMessage } from './sentry.ts';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
type LogFormat = 'json' | 'pretty' | 'auto';

function readEnv(key: string): string | undefined {
  try {
    if (typeof Deno !== 'undefined' && Deno.env?.get) {
      return Deno.env.get(key);
    }
  } catch {
    /* not Deno */
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[key];
}

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
  silent: 99,
};

const LEVEL_LABEL: Record<string, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  fatal: 'FTL',
};

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
} as const;

const LEVEL_COLOR: Record<string, string> = {
  debug: ANSI.dim,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
  fatal: `${ANSI.bgRed}${ANSI.white}${ANSI.bold}`,
};

/** Keys that must never appear in plaintext log output. */
const SENSITIVE_KEY_RE =
  /^(authorization|cookie|set-cookie|password|secret|token|api[_-]?key|apikey|bearer|private[_-]?key|service[_-]?role|access[_-]?token|refresh[_-]?token|reporter[_-]?token)$/i;

const SECRET_VALUE_RE =
  /^(Bearer\s+\S+|sk-[a-z0-9_-]{8,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)$/i;

interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  [key: string]: unknown;
}

interface LoggerOptions {
  scope: string;
  level?: LogLevel;
  meta?: Record<string, unknown>;
  format?: LogFormat;
}

interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  fatal(msg: string, meta?: Record<string, unknown>): void;
  /** Structured audit trail — always info-level with `event: audit`. */
  audit(action: string, meta?: Record<string, unknown>): void;
  child(scope: string, meta?: Record<string, unknown>): Logger;
  setLevel(level: LogLevel): void;
}

function detectFormat(): 'json' | 'pretty' {
  const explicit = (readEnv('MUSHI_LOG_FORMAT') ?? readEnv('LOG_FORMAT') ?? 'auto')
    .trim()
    .toLowerCase();
  if (explicit === 'json') return 'json';
  if (explicit === 'pretty') return 'pretty';

  const supabaseUrl = (readEnv('SUPABASE_URL') ?? '').toLowerCase();
  if (supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')) {
    return 'pretty';
  }
  return 'json';
}

function detectLevel(): LogLevel {
  const raw = (readEnv('MUSHI_LOG_LEVEL') ?? readEnv('LOG_LEVEL') ?? 'info').trim().toLowerCase();
  if (raw in LEVEL_VALUE) return raw as LogLevel;
  return 'info';
}

function shouldRedactKey(key: string): boolean {
  if (SENSITIVE_KEY_RE.test(key)) return true;
  const lower = key.toLowerCase();
  return lower.endsWith('_token') || lower.endsWith('_secret') || lower.endsWith('_password');
}

function redactString(value: string): string {
  if (SECRET_VALUE_RE.test(value.trim())) return '[redacted]';
  if (value.length > 8 && /^[A-Za-z0-9+/=_-]{24,}$/.test(value))
    return `[redacted:${value.slice(-4)}]`;
  return value;
}

function redactValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (shouldRedactKey(key)) return '[redacted]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));
  if (typeof value === 'object') return redactMeta(value as Record<string, unknown>);
  return value;
}

function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

function flattenMeta(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') {
      parts.push(`${k}=${JSON.stringify(v)}`);
    } else {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.join(' ');
}

function formatPretty(entry: LogEntry): string {
  const { ts, level, scope, msg, ...rest } = entry;
  const time = ts.slice(11, 23);
  const color = LEVEL_COLOR[level] ?? '';
  const label = LEVEL_LABEL[level] ?? level.toUpperCase();
  const auditTag = rest.event === 'audit' ? `${ANSI.magenta}AUD${ANSI.reset} ` : '';
  const metaStr =
    Object.keys(rest).length > 0 ? ` ${ANSI.dim}${flattenMeta(rest)}${ANSI.reset}` : '';

  return `${ANSI.dim}${time}${ANSI.reset} ${auditTag}${color}${label}${ANSI.reset} ${ANSI.cyan}[${scope}]${ANSI.reset} ${msg}${metaStr}`;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function emit(level: LogLevel, formatted: string): void {
  switch (level) {
    case 'error':
    case 'fatal':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

function buildLogger(
  scope: string,
  minLevel: LogLevel,
  baseMeta: Record<string, unknown>,
  formatter: (entry: LogEntry) => string,
): Logger {
  let currentLevel = minLevel;

  function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_VALUE[level] < LEVEL_VALUE[currentLevel]) return;

    const merged = redactMeta({ ...baseMeta, ...meta });
    const { sentry: forwardToSentry = true, ...logMeta } = merged;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg,
      ...logMeta,
    };

    emit(level, formatter(entry));

    if (forwardToSentry !== false && (level === 'error' || level === 'fatal')) {
      reportMessage(msg, level === 'fatal' ? 'fatal' : 'error', {
        tags: { scope },
        extra: logMeta,
      });
    }
  }

  return {
    debug: (msg, meta?) => write('debug', msg, meta),
    info: (msg, meta?) => write('info', msg, meta),
    warn: (msg, meta?) => write('warn', msg, meta),
    error: (msg, meta?) => write('error', msg, meta),
    fatal: (msg, meta?) => write('fatal', msg, meta),
    audit: (action, meta?) => write('info', action, { event: 'audit', ...meta }),

    child(childScope: string, childMeta?: Record<string, unknown>): Logger {
      return buildLogger(
        `${scope}:${childScope}`,
        currentLevel,
        { ...baseMeta, ...childMeta },
        formatter,
      );
    },

    setLevel(level: LogLevel) {
      currentLevel = level;
    },
  };
}

const resolvedFormat = detectFormat();
const resolvedLevel = detectLevel();
const formatter = resolvedFormat === 'json' ? formatJson : formatPretty;

/** Root logger for all edge functions — scope: mushi */
export const log = buildLogger('mushi', resolvedLevel, {}, formatter);

/** Create a scoped logger (same format/level defaults as root). */
export function createLogger(options: LoggerOptions): Logger {
  const format = options.format === 'auto' || !options.format ? detectFormat() : options.format;
  const fmt = format === 'json' ? formatJson : formatPretty;
  return buildLogger(options.scope, options.level ?? resolvedLevel, options.meta ?? {}, fmt);
}

export type { Logger, LogLevel, LogFormat, LogEntry, LoggerOptions };
