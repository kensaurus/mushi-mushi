/**
 * Web Vitals instrumentation for the Mushi Mushi admin console.
 *
 * Collects Core Web Vitals (LCP, CLS, INP, FCP, TTFB) and forwards each
 * measurement to Sentry as a custom measurement attached to the current
 * transaction. This gives the P75/P90 distributions in the Sentry
 * Performance dashboard alongside normal error events.
 *
 * The module is imported lazily from `main.tsx` (after first paint) so it
 * never delays the initial render — it has zero synchronous cost on the
 * critical path.
 *
 * Reference: https://web.dev/articles/vitals
 *
 * web-vitals v6 can emit another sample on each soft navigation when
 * `reportSoftNavs` is true. This console is a React Router SPA and the
 * sample is attached to the current pageload span, so soft-nav reporting
 * stays off and each vital remains a full-page-load measurement.
 * `sendToSentry` forwards name, value, id, and rating from the standard
 * build. The v6 attribution default (`includeProcessedEventEntries: false`)
 * does not change that payload.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals'
import * as Sentry from '@sentry/react'

type VitalName = 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB'

function sendToSentry(metric: { name: string; value: number; id: string; rating?: string }): void {
  const name = metric.name as VitalName
  const value = metric.value

  // Report to Sentry as a span attribute on the current pageload span so it
  // appears in the Performance → Web Vitals summary view. We don't need the
  // `withActiveSpan` wrapper — the active span is already in context.
  const activeSpan = Sentry.getActiveSpan()
  if (activeSpan) {
    activeSpan.setAttribute(`measurements.${name.toLowerCase()}`, value)
  }

  // Also stash as a scope extra so the metric is attached to any subsequent
  // error captured during this pageload (useful when a slow LCP correlates
  // with a JS error). CLS is unitless ratio in [0,1]; we multiply by 1000
  // and label as 'millisecond' so the Sentry dashboard renders consistent
  // numeric units across all five vitals.
  const currentScope = Sentry.getCurrentScope()
  if (currentScope) {
    currentScope.setExtra(`webvitals.${name}`, {
      value: Math.round(name === 'CLS' ? value * 1000 : value),
      unit: 'millisecond',
      rating: metric.rating ?? 'unknown',
    })
  }

  // Emit to console in dev so engineers can see vitals without DevTools.
  if (import.meta.env.DEV) {
    const emoji = metric.rating === 'good' ? '✅' : metric.rating === 'needs-improvement' ? '⚠️' : '❌'
    const displayVal = name === 'CLS' ? value.toFixed(4) : `${Math.round(value)}ms`
    console.debug(`[Web Vitals] ${emoji} ${name}: ${displayVal} (${metric.id})`)
  }
}

/**
 * Start observing all Core Web Vitals.
 * Call once after DOMContentLoaded — imports are deferred by the lazy()
 * call in main.tsx so this never runs before first paint.
 */
export function reportWebVitals(): void {
  // Soft navigations stay off so client-side route changes keep the
  // full-page-load numbers attached to the pageload span.
  onCLS(sendToSentry, { reportSoftNavs: false })
  onFCP(sendToSentry, { reportSoftNavs: false })
  onINP(sendToSentry, { reportSoftNavs: false })
  onLCP(sendToSentry, { reportSoftNavs: false })
  onTTFB(sendToSentry, { reportSoftNavs: false })
}
