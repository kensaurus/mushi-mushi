/** Strip ANSI SGR sequences from SDK / terminal log lines. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

export type ConsoleLevel = 'error' | 'warn' | 'info' | 'log' | 'debug'

const LEVEL_ALIASES: Record<string, ConsoleLevel> = {
  error: 'error',
  err: 'error',
  warn: 'warn',
  warning: 'warn',
  wrn: 'warn',
  info: 'info',
  inf: 'info',
  log: 'log',
  debug: 'debug',
  dbg: 'debug',
  trace: 'debug',
}

/** Normalise a console level string from the SDK payload. */
export function normaliseConsoleLevel(level: string): ConsoleLevel {
  const key = level.toLowerCase()
  return LEVEL_ALIASES[key] ?? 'log'
}

/**
 * Mushi SDK logs often embed level + namespace inside the message after ANSI
 * stripping, e.g. "15:28:26.069 DBG [mushi] Proactive triggers enabled".
 */
export function inferLevelFromMessage(message: string, fallback: ConsoleLevel): ConsoleLevel {
  const plain = stripAnsi(message)
  const token = plain.match(/\b(ERR(?:OR)?|WRN|WARN(?:ING)?|INF(?:O)?|DBG|DEBUG|TRACE|LOG)\b/i)
  if (!token) return fallback
  return normaliseConsoleLevel(token[1]!)
}

/** Clean a console line for display — strip ANSI, collapse whitespace. */
export function formatConsoleMessage(message: string): string {
  return stripAnsi(message).replace(/\s+/g, ' ').trim()
}

export const CONSOLE_LEVEL_PILL: Record<
  ConsoleLevel,
  { pill: string; row: string; dot: string }
> = {
  error: {
    pill: 'bg-danger/15 text-danger border border-danger/35 ring-1 ring-danger/10',
    row: 'border-l-danger/60 bg-danger/[0.04]',
    dot: 'bg-danger',
  },
  warn: {
    pill: 'bg-warn/15 text-warn border border-warn/35 ring-1 ring-warn/10',
    row: 'border-l-warn/55 bg-warn/[0.04]',
    dot: 'bg-warn',
  },
  info: {
    pill: 'bg-info/15 text-info border border-info/30 ring-1 ring-info/10',
    row: 'border-l-info/45 bg-info/[0.03]',
    dot: 'bg-info',
  },
  log: {
    pill: 'bg-surface-overlay text-fg-secondary border border-edge-subtle',
    row: 'border-l-edge-subtle bg-surface-overlay/20',
    dot: 'bg-fg-faint',
  },
  debug: {
    pill: 'bg-brand/10 text-brand border border-brand/25 ring-1 ring-brand/10',
    row: 'border-l-brand/35 bg-brand/[0.03]',
    dot: 'bg-brand/70',
  },
}

export type TimelineKind = 'route' | 'click' | 'request' | 'log' | 'screen'

export const TIMELINE_KIND_PILL: Record<TimelineKind, string> = {
  route: 'bg-brand/12 text-brand border border-brand/30',
  click: 'bg-warn/12 text-warn border border-warn/30',
  request: 'bg-info/12 text-info border border-info/30',
  log: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
  screen: 'bg-ok/12 text-ok border border-ok/30',
}

export function formatTimelineTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return String(ts)
  }
}

export function formatTimelineOffset(ts: number, baseTs: number): string {
  const delta = Math.max(0, ts - baseTs)
  if (delta < 1000) return `+${delta}ms`
  return `+${(delta / 1000).toFixed(1)}s`
}

/** Shared pill chrome for report metadata (platform, viewport, HTTP method). */
export const META_PILL_BASE =
  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-2xs font-semibold tabular-nums'

export const PLATFORM_PILL: Record<string, string> = {
  ios: `${META_PILL_BASE} bg-info-muted text-info border-info/25 uppercase tracking-wide`,
  android: `${META_PILL_BASE} bg-ok-muted text-ok border-ok/25 uppercase tracking-wide`,
  web: `${META_PILL_BASE} bg-brand/12 text-brand border-brand/25 uppercase tracking-wide`,
  macos: `${META_PILL_BASE} bg-surface-overlay text-fg-secondary border-edge-subtle uppercase tracking-wide`,
  darwin: `${META_PILL_BASE} bg-surface-overlay text-fg-secondary border-edge-subtle uppercase tracking-wide`,
  windows: `${META_PILL_BASE} bg-surface-overlay text-fg-secondary border-edge-subtle uppercase tracking-wide`,
  win32: `${META_PILL_BASE} bg-surface-overlay text-fg-secondary border-edge-subtle uppercase tracking-wide`,
  linux: `${META_PILL_BASE} bg-surface-overlay text-fg-muted border-edge-subtle uppercase tracking-wide`,
}

export function platformPillClass(platform: string): string {
  const key = platform.toLowerCase()
  return PLATFORM_PILL[key] ?? `${META_PILL_BASE} bg-surface-overlay text-fg-secondary border-edge-subtle uppercase tracking-wide`
}

export const BROWSER_CHIP: Record<'browser' | 'engine' | 'os', string> = {
  browser: 'border-info/25 bg-info-muted/40 text-info',
  engine: 'border-edge-subtle bg-surface-overlay/50 text-fg-secondary',
  os: 'border-brand/20 bg-brand/8 text-brand',
}

export const HTTP_METHOD_PILL: Record<string, string> = {
  GET: `${META_PILL_BASE} bg-info/12 text-info border-info/30 uppercase tracking-wide`,
  POST: `${META_PILL_BASE} bg-ok/12 text-ok border-ok/30 uppercase tracking-wide`,
  PUT: `${META_PILL_BASE} bg-warn/12 text-warn border-warn/30 uppercase tracking-wide`,
  PATCH: `${META_PILL_BASE} bg-warn/12 text-warn border-warn/30 uppercase tracking-wide`,
  DELETE: `${META_PILL_BASE} bg-danger/12 text-danger border-danger/30 uppercase tracking-wide`,
  HEAD: `${META_PILL_BASE} bg-surface-overlay text-fg-muted border-edge-subtle uppercase tracking-wide`,
  OPTIONS: `${META_PILL_BASE} bg-surface-overlay text-fg-muted border-edge-subtle uppercase tracking-wide`,
}

export function httpMethodPillClass(method: string): string {
  const key = method.toUpperCase()
  return HTTP_METHOD_PILL[key] ?? `${META_PILL_BASE} bg-surface-overlay text-fg-muted border-edge-subtle uppercase tracking-wide`
}

export function formatViewport(width: number, height: number): string {
  return `${width.toLocaleString()} × ${height.toLocaleString()}`
}

export type PerfVitalTone = 'ok' | 'warn' | 'danger' | 'neutral'

/** Web Vitals thresholds — colours values so triagers spot regressions at a glance. */
export function perfVitalTone(metric: string, value: number): PerfVitalTone {
  const key = metric.toUpperCase()
  switch (key) {
    case 'LCP':
      if (value <= 2500) return 'ok'
      if (value <= 4000) return 'warn'
      return 'danger'
    case 'CLS':
      if (value <= 0.1) return 'ok'
      if (value <= 0.25) return 'warn'
      return 'danger'
    case 'INP':
    case 'FID':
      if (value <= 200) return 'ok'
      if (value <= 500) return 'warn'
      return 'danger'
    case 'TTFB':
      if (value <= 800) return 'ok'
      if (value <= 1800) return 'warn'
      return 'danger'
    case 'FCP':
      if (value <= 1800) return 'ok'
      if (value <= 3000) return 'warn'
      return 'danger'
    default:
      return 'neutral'
  }
}

export const PERF_TONE_CLASS: Record<PerfVitalTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  neutral: 'text-fg',
}
