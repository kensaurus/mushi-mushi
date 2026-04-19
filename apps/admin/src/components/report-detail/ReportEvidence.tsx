import { Field } from '../ui'
import { EmptySectionMessage } from './ReportClassification'
import type { ReportDetail } from './types'

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
    <div className="grid grid-cols-2 gap-x-4">
      {entries.map(([key, val]) => {
        const upper = key.toUpperCase()
        const tooltip = PERF_TOOLTIPS[upper]
        const display = typeof val === 'number'
          ? upper === 'CLS' ? val.toFixed(3) : `${val.toFixed(0)} ms`
          : String(val)
        return (
          <Field
            key={key}
            label={upper}
            value={display}
            mono
            tooltip={tooltip}
          />
        )
      })}
    </div>
  )
}

export function ConsoleLogs({ logs }: { logs: ReportDetail['console_logs'] }) {
  if (!logs || logs.length === 0) {
    return <EmptySectionMessage text="No console output was captured during this report." />
  }
  return (
    <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
      {logs.map((log, i) => {
        const tone = log.level === 'error' ? 'text-danger' : log.level === 'warn' ? 'text-warn' : 'text-fg-muted'
        return (
          <div key={i} className={`text-2xs font-mono leading-relaxed ${tone}`}>
            <span className="opacity-70">[{log.level}]</span> {log.message}
          </div>
        )
      })}
    </div>
  )
}

export function NetworkLogs({ logs }: { logs: ReportDetail['network_logs'] }) {
  if (!logs || logs.length === 0) {
    return <EmptySectionMessage text="No network activity was captured during this report." />
  }
  return (
    <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
      {logs.map((req, i) => {
        const tone = req.status >= 500 ? 'text-danger'
          : req.status >= 400 ? 'text-warn'
          : 'text-fg-muted'
        return (
          <div key={i} className={`text-2xs font-mono leading-relaxed ${tone}`}>
            <span className="opacity-70">{req.method}</span> {req.url}
            {' → '}
            <span className="font-medium">{req.status}</span>
            <span className="opacity-70"> ({req.duration} ms)</span>
          </div>
        )
      })}
    </div>
  )
}
