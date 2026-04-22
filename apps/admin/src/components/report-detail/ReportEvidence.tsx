import { CodeValue, DefinitionChips, Field, IdField, InfoHint } from '../ui'
import { EmptySectionMessage } from './ReportClassification'
import { parseUserAgent } from '../../lib/userAgent'
import type { ReportDetail } from './types'

/**
 * Environment card — renders the UA, URL, viewport, platform, session ID
 * as scannable technical values instead of a prose wall:
 *   - URL → mono code-block with `url` (info-blue) tone, full value
 *     preserved (no truncation), click-to-copy.
 *   - User agent → parsed into Browser / Engine / OS chips with the raw
 *     string still accessible via the expander below.
 *   - Viewport + platform → a single compact line of tokens.
 *   - Session ID → IdField in `full` mode so the whole UUID renders inline
 *     as a code block rather than ellipsis-truncated to 12 chars.
 */
export function EnvironmentFields({ environment, sessionId }: {
  environment: ReportDetail['environment']
  sessionId: ReportDetail['session_id']
}) {
  const url = environment?.url
  const ua = parseUserAgent(environment?.userAgent)
  const viewport = environment?.viewport
    ? `${environment.viewport.width} × ${environment.viewport.height}`
    : null
  const platform = environment?.platform

  const uaChips: Array<{ label: string; value: string }> = []
  if (ua.browser) {
    uaChips.push({
      label: 'Browser',
      value: ua.browserVersion ? `${ua.browser} ${ua.browserVersion}` : ua.browser,
    })
  }
  if (ua.engine) uaChips.push({ label: 'Engine', value: ua.engine })
  if (ua.os)     uaChips.push({ label: 'OS',     value: ua.mobile ? `${ua.os} (mobile)` : ua.os })

  return (
    <div className="space-y-2.5">
      {url && (
        <div>
          <span className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1">URL</span>
          <CodeValue value={url} tone="url" />
        </div>
      )}

      {(uaChips.length > 0 || ua.raw) && (
        <div>
          <span className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1">
            Browser
            <InfoHint content="Parsed from the user-agent string. Click 'Raw user agent' for the full value." />
          </span>
          {uaChips.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {uaChips.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/40 px-1.5 py-0.5 text-2xs"
                >
                  <span className="text-3xs font-medium uppercase tracking-wider text-fg-muted">{chip.label}</span>
                  <span className="font-mono text-fg">{chip.value}</span>
                </span>
              ))}
            </div>
          )}
          {ua.raw && (
            <details className="group">
              <summary className="cursor-pointer text-3xs text-fg-faint hover:text-fg-muted select-none list-none">
                <span className="inline-block mr-1 transition-transform group-open:rotate-90">▸</span>
                Raw user agent
              </summary>
              <div className="mt-1">
                <CodeValue value={ua.raw} tone="neutral" />
              </div>
            </details>
          )}
        </div>
      )}

      {(viewport || platform) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {viewport && (
            <div>
              <span className="block text-xs text-fg-muted font-medium">Viewport</span>
              <span className="text-sm font-mono text-fg">{viewport}</span>
            </div>
          )}
          {platform && (
            <div>
              <span className="block text-xs text-fg-muted font-medium">Platform</span>
              <span className="text-sm font-mono text-fg">{platform}</span>
            </div>
          )}
        </div>
      )}

      {sessionId ? (
        <IdField
          label="Session ID"
          value={sessionId}
          full
          tone="id"
          tooltip="Unique identifier for the user's browser session at the time of the report."
        />
      ) : (
        <Field label="Session ID" value="Not captured" />
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
    return <EmptySectionMessage text="No Web Vitals captured during this report." />
  }
  return (
    <DefinitionChips
      className="mb-0 sm:grid-cols-2 lg:grid-cols-3"
      items={entries.map(([key, val]) => {
        const upper = key.toUpperCase()
        const tooltip = PERF_TOOLTIPS[upper]
        const display = typeof val === 'number'
          ? upper === 'CLS' ? val.toFixed(3) : `${val.toFixed(0)} ms`
          : String(val)
        return {
          label: upper,
          hint: tooltip,
          value: <span className="font-mono tabular-nums text-fg">{display}</span>,
        }
      })}
    />
  )
}

const LEVEL_TONE = {
  error: 'text-danger border-l-danger/50',
  warn:  'text-warn border-l-warn/50',
  info:  'text-info border-l-info/40',
  log:   'text-fg-secondary border-l-edge-subtle',
  debug: 'text-fg-faint border-l-edge-subtle',
} as const

const LEVEL_BADGE = {
  error: 'bg-danger-muted text-danger',
  warn:  'bg-warn-muted text-warn',
  info:  'bg-info-muted text-info',
  log:   'bg-surface-overlay text-fg-muted',
  debug: 'bg-surface-overlay text-fg-faint',
} as const

type ConsoleLevel = keyof typeof LEVEL_TONE

function normaliseLevel(level: string): ConsoleLevel {
  const l = level.toLowerCase()
  if (l === 'error' || l === 'warn' || l === 'info' || l === 'debug' || l === 'log') return l
  return 'log'
}

export function ConsoleLogs({ logs }: { logs: ReportDetail['console_logs'] }) {
  if (!logs || logs.length === 0) {
    return <EmptySectionMessage text="No console output was captured during this report." />
  }
  return (
    <div className="rounded-sm bg-surface-overlay/40 border border-edge-subtle max-h-56 overflow-y-auto">
      {logs.map((log, i) => {
        const level = normaliseLevel(log.level)
        const tone = LEVEL_TONE[level]
        const badge = LEVEL_BADGE[level]
        return (
          <div
            key={i}
            className={`flex items-start gap-1.5 border-l-2 border-b border-b-edge-subtle/30 last:border-b-0 px-2 py-1 ${tone}`}
          >
            <span className={`shrink-0 mt-0.5 inline-flex items-center rounded-sm px-1 text-3xs font-semibold uppercase tracking-wider ${badge}`}>
              {level}
            </span>
            <code className="text-2xs font-mono leading-relaxed wrap-anywhere text-fg-secondary">
              {log.message}
            </code>
          </div>
        )
      })}
    </div>
  )
}

function statusBadge(status: number): string {
  if (status >= 500) return 'bg-danger-muted text-danger'
  if (status >= 400) return 'bg-warn-muted text-warn'
  if (status >= 300) return 'bg-info-muted text-info'
  if (status >= 200) return 'bg-ok-muted text-ok'
  return 'bg-surface-overlay text-fg-muted'
}

const METHOD_TONE: Record<string, string> = {
  GET:    'text-info',
  POST:   'text-ok',
  PUT:    'text-warn',
  PATCH:  'text-warn',
  DELETE: 'text-danger',
}

export function NetworkLogs({ logs }: { logs: ReportDetail['network_logs'] }) {
  if (!logs || logs.length === 0) {
    return <EmptySectionMessage text="No network activity was captured during this report." />
  }
  return (
    <div className="rounded-sm bg-surface-overlay/40 border border-edge-subtle max-h-56 overflow-y-auto">
      {logs.map((req, i) => {
        const methodTone = METHOD_TONE[req.method.toUpperCase()] ?? 'text-fg-muted'
        return (
          <div
            key={i}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-1.5 border-b border-edge-subtle/30 last:border-b-0 px-2 py-1"
          >
            <code className={`shrink-0 text-3xs font-mono font-semibold uppercase ${methodTone}`}>
              {req.method}
            </code>
            <code className="text-2xs font-mono text-fg-secondary truncate min-w-0" title={req.url}>
              {req.url}
            </code>
            <span className={`shrink-0 inline-flex items-center rounded-sm px-1 text-3xs font-semibold ${statusBadge(req.status)}`}>
              {req.status}
            </span>
            <span className="shrink-0 text-3xs font-mono text-fg-faint tabular-nums">
              {req.duration}ms
            </span>
          </div>
        )
      })}
    </div>
  )
}
