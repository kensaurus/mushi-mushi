import type { ReactNode } from 'react'
import {
  CodeValue,
  DefinitionChips,
  DetailRows,
  InfoHint,
} from '../ui'
import { EmptySectionMessage } from './ReportClassification'
import { parseUserAgent } from '../../lib/userAgent'
import type { ReportDetail } from './types'
import {
  BROWSER_CHIP,
  CONSOLE_LEVEL_PILL,
  formatConsoleMessage,
  httpMethodPillClass,
  inferLevelFromMessage,
  normaliseConsoleLevel,
  PERF_TONE_CLASS,
  perfVitalTone,
  platformPillClass,
  type ConsoleLevel,
} from './reportLogFormat'

function statusBadge(status: number): string {
  if (status >= 500) return 'bg-danger-muted text-danger border border-danger/25'
  if (status >= 400) return 'bg-warn-muted text-warn border border-warn/25'
  if (status >= 300) return 'bg-info-muted text-info border border-info/25'
  if (status >= 200) return 'bg-ok-muted text-ok border border-ok/25'
  return 'bg-surface-overlay text-fg-muted border border-edge-subtle'
}

/**
 * Environment card — URL, browser chips, and structured metadata rows
 * (viewport, platform, locale, session) in a single scannable surface.
 */
export function EnvironmentFields({ environment, sessionId }: {
  environment: ReportDetail['environment']
  sessionId: ReportDetail['session_id']
}) {
  const url = environment?.url
  const ua = parseUserAgent(environment?.userAgent)
  const viewport = environment?.viewport
  const platform = environment?.platform
  const language = typeof environment?.language === 'string' ? environment.language : null
  const timezone = typeof environment?.timezone === 'string' ? environment.timezone : null

  const uaChips: Array<{ label: string; value: string; tone: keyof typeof BROWSER_CHIP }> = []
  if (ua.browser) {
    uaChips.push({
      label: 'Browser',
      tone: 'browser',
      value: ua.browserVersion ? `${ua.browser} ${ua.browserVersion}` : ua.browser,
    })
  }
  if (ua.engine) uaChips.push({ label: 'Engine', tone: 'engine', value: ua.engine })
  if (ua.os) {
    uaChips.push({
      label: 'OS',
      tone: 'os',
      value: ua.mobile ? `${ua.os} · mobile` : ua.os,
    })
  }

  const metaRows = [
    viewport
      ? {
          label: 'Viewport',
          hint: 'Browser inner width × height at report time.',
          value: (
            <span className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono tabular-nums text-fg">
              <span className="text-info">{viewport.width.toLocaleString()}</span>
              <span className="text-fg-faint">×</span>
              <span className="text-info">{viewport.height.toLocaleString()}</span>
            </span>
          ),
        }
      : null,
    platform
      ? {
          label: 'Platform',
          hint: 'navigator.platform from the reporter device.',
          value: (
            <span className={platformPillClass(platform)}>{platform}</span>
          ),
        }
      : null,
    language
      ? {
          label: 'Language',
          hint: 'navigator.language — primary locale.',
          value: (
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono text-fg-secondary">
              {language}
            </code>
          ),
        }
      : null,
    timezone
      ? {
          label: 'Timezone',
          hint: 'IANA timezone from the reporter device.',
          value: (
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono text-fg-secondary">
              {timezone}
            </code>
          ),
        }
      : null,
    sessionId
      ? {
          label: 'Session',
          hint: 'Unique browser session at report time.',
          value: (
            <code className="break-all rounded-sm border border-brand/20 bg-brand/8 px-1.5 py-0.5 font-mono text-2xs text-brand">
              {sessionId}
            </code>
          ),
          wrap: true,
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string
    hint?: string
    value: ReactNode
    wrap?: boolean
  }>

  const hasAny =
    url ||
    uaChips.length > 0 ||
    ua.raw ||
    metaRows.length > 0

  if (!hasAny) {
    return (
      <EmptySectionMessage
        text="No environment data was captured for this report."
        hint="Web and mobile SDKs populate URL, user agent, and session when telemetry is enabled."
      />
    )
  }

  return (
    <div className="space-y-2.5">
      {url && (
        <div>
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-fg-muted">URL</span>
          <CodeValue value={url} tone="url" />
        </div>
      )}

      {(uaChips.length > 0 || ua.raw) && (
        <div>
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-fg-muted">
            Browser
            <InfoHint content="Parsed from the user-agent string. Expand raw UA for the full value." />
          </span>
          {uaChips.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {uaChips.map((chip) => (
                <span
                  key={chip.label}
                  className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs ${BROWSER_CHIP[chip.tone]}`}
                >
                  <span className="text-3xs font-medium uppercase tracking-wider opacity-70">{chip.label}</span>
                  <span className="font-mono">{chip.value}</span>
                </span>
              ))}
            </div>
          )}
          {ua.raw && (
            <details className="group">
              <summary className="cursor-pointer select-none list-none text-3xs text-fg-faint hover:text-fg-muted">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
                Raw user agent
              </summary>
              <div className="mt-1">
                <CodeValue value={ua.raw} tone="neutral" />
              </div>
            </details>
          )}
        </div>
      )}

      {metaRows.length > 0 && (
        <DetailRows
          dense
          items={metaRows.map((row) => ({
            label: row.label,
            hint: row.hint,
            value: row.value,
            wrap: row.wrap,
          }))}
        />
      )}

      {!sessionId && metaRows.length > 0 && (
        <p className="text-2xs text-fg-faint">Session ID was not captured.</p>
      )}
    </div>
  )
}

const PERF_TOOLTIPS: Record<string, string> = {
  LCP: 'Largest Contentful Paint — time until the largest visible element rendered. Target < 2.5s.',
  CLS: 'Cumulative Layout Shift — visual stability score. Target < 0.1.',
  INP: 'Interaction to Next Paint — responsiveness to clicks/taps. Target < 200ms.',
  TTFB: 'Time to First Byte — server response time. Target < 800ms.',
  FCP: 'First Contentful Paint — time until any content first appears. Target < 1.8s.',
  FID: 'First Input Delay — legacy metric, replaced by INP.',
}

export function PerformanceMetrics({ metrics }: { metrics: Record<string, number> | null }) {
  const entries = metrics ? Object.entries(metrics) : []
  if (entries.length === 0) {
    return (
      <EmptySectionMessage
        text="No Web Vitals captured during this report."
        hint="Enable performance capture in the SDK config. Values colour green / amber / red against Core Web Vitals thresholds."
      />
    )
  }
  return (
    <DefinitionChips
      className="mb-0 sm:grid-cols-2 lg:grid-cols-3"
      items={entries.map(([key, val]) => {
        const upper = key.toUpperCase()
        const tooltip = PERF_TOOLTIPS[upper]
        const tone = typeof val === 'number' ? perfVitalTone(upper, val) : 'neutral'
        const display =
          typeof val === 'number'
            ? upper === 'CLS'
              ? val.toFixed(3)
              : `${val.toFixed(0)} ms`
            : String(val)
        return {
          label: upper,
          hint: tooltip,
          value: (
            <span className={`font-mono tabular-nums font-semibold ${PERF_TONE_CLASS[tone]}`}>
              {display}
            </span>
          ),
        }
      })}
    />
  )
}

const LEVEL_TONE = {
  error: CONSOLE_LEVEL_PILL.error.row,
  warn: CONSOLE_LEVEL_PILL.warn.row,
  info: CONSOLE_LEVEL_PILL.info.row,
  log: CONSOLE_LEVEL_PILL.log.row,
  debug: CONSOLE_LEVEL_PILL.debug.row,
} as const

const LEVEL_BADGE = {
  error: CONSOLE_LEVEL_PILL.error.pill,
  warn: CONSOLE_LEVEL_PILL.warn.pill,
  info: CONSOLE_LEVEL_PILL.info.pill,
  log: CONSOLE_LEVEL_PILL.log.pill,
  debug: CONSOLE_LEVEL_PILL.debug.pill,
} as const

function normaliseLevel(level: string): ConsoleLevel {
  return normaliseConsoleLevel(level)
}

export function ConsoleLogs({ logs }: { logs: ReportDetail['console_logs'] }) {
  if (!logs || logs.length === 0) {
    return (
      <EmptySectionMessage
        text="No console output was captured during this report."
        hint="Console capture requires the SDK widget session to be active before the error occurs."
      />
    )
  }
  return (
    <div className="max-h-64 overflow-y-auto rounded-sm border border-edge-subtle bg-surface-overlay/40">
      {logs.map((log, i) => {
        const baseLevel = normaliseLevel(log.level)
        const message = formatConsoleMessage(log.message)
        const level = inferLevelFromMessage(log.message, baseLevel)
        const rowTone = LEVEL_TONE[level]
        const badge = LEVEL_BADGE[level]
        const time =
          log.timestamp > 0
            ? new Date(log.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            : null
        return (
          <div
            key={i}
            className={`flex items-start gap-2 border-b border-b-edge-subtle/25 border-l-2 px-2 py-1 last:border-b-0 ${rowTone}`}
          >
            {time ? (
              <time className="w-[4.5rem] shrink-0 pt-0.5 font-mono text-3xs tabular-nums text-fg-faint">
                {time}
              </time>
            ) : null}
            <span
              className={`mt-0.5 inline-flex min-w-[2.75rem] shrink-0 items-center justify-center rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide ${badge}`}
            >
              {level}
            </span>
            <code className="min-w-0 flex-1 font-mono text-2xs leading-snug wrap-anywhere text-fg-secondary">
              {message}
            </code>
          </div>
        )
      })}
    </div>
  )
}

export function NetworkLogs({ logs }: { logs: ReportDetail['network_logs'] }) {
  if (!logs || logs.length === 0) {
    return (
      <EmptySectionMessage
        text="No network activity was captured during this report."
        hint="Network logging records fetch/XHR calls made while the widget session was open."
      />
    )
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-sm border border-edge-subtle bg-surface-overlay/40">
      {logs.map((req, i) => {
        const methodCls = httpMethodPillClass(req.method)
        const slow = req.duration >= 1000
        return (
          <div
            key={i}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-1.5 border-b border-edge-subtle/30 px-2 py-1 last:border-b-0"
          >
            <span className={`shrink-0 ${methodCls}`}>{req.method}</span>
            <code className="min-w-0 truncate font-mono text-2xs text-fg-secondary" title={req.url}>
              {req.url}
            </code>
            <span
              className={`inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-3xs font-semibold tabular-nums ${statusBadge(req.status)}`}
            >
              {req.status}
            </span>
            <span
              className={`shrink-0 font-mono text-3xs tabular-nums ${slow ? 'font-semibold text-warn' : 'text-fg-faint'}`}
            >
              {req.duration}ms
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Device & build metadata — SDK package, versions, and platform tag.
 */
export function DeviceAndBuildPanel({ report }: { report: ReportDetail }) {
  const platform = (report.environment?.platform ?? '').trim()
  const rows = [
    report.sdk_package
      ? {
          label: 'SDK',
          hint: 'Mushi SDK package that captured this report.',
          value: (
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono text-fg-secondary">
              {report.sdk_package}
            </code>
          ),
          wrap: true,
        }
      : null,
    report.sdk_version
      ? {
          label: 'SDK version',
          value: (
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono tabular-nums text-fg">
              {report.sdk_version}
            </code>
          ),
        }
      : null,
    report.app_version
      ? {
          label: 'App version',
          hint: 'Host application version from the SDK.',
          value: (
            <code className="rounded-sm border border-brand/20 bg-brand/8 px-1.5 py-0.5 font-mono tabular-nums text-brand">
              {report.app_version}
            </code>
          ),
        }
      : null,
    platform
      ? {
          label: 'Platform',
          value: <span className={platformPillClass(platform)}>{platform}</span>,
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string
    hint?: string
    value: ReactNode
    wrap?: boolean
  }>

  if (rows.length === 0) return null

  return <DetailRows dense items={rows} />
}
