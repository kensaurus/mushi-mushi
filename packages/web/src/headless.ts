// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/web/src/headless.ts
 * PURPOSE: Headless (no-widget) entry for @mushi-mushi/web.
 *
 * Import from `@mushi-mushi/web/headless` to get a lean bundle that includes
 * the programmatic capture APIs and zero widget DOM code — no Shadow DOM, no
 * inline styles, no rrweb replay machinery, no 91 KB `mushi.ts` singleton.
 *
 * Size limit: ≤35 KB gzip. The full `@mushi-mushi/web` entry is ≤88 KB gzip.
 *
 * Typical use cases:
 *  - Server-side-rendered / headless environments where the host app owns UI
 *  - A/B testing: capture events without rendering the widget
 *  - Unit/integration tests that call `captureEvent()` directly
 *  - Embedding Mushi in frameworks with their own error boundary / overlay
 *
 * @example
 * ```ts
 * import { createHeadlessCapture } from '@mushi-mushi/web/headless'
 *
 * const capture = createHeadlessCapture({
 *   projectId: 'proj_…',
 *   apiKey: 'mushi_pk_…',
 * })
 *
 * window.onerror = (msg, _src, _line, _col, err) => {
 *   void capture.captureException(err ?? new Error(String(msg)))
 * }
 * ```
 */

import { DEFAULT_API_ENDPOINT } from '@mushi-mushi/core'

// ── Re-exports ────────────────────────────────────────────────────────────────

export {
  // Browser capture primitives — no widget dependency
  createConsoleCapture,
  createNetworkCapture,
  createScreenshotCapture,
  createPerformanceCapture,
  createElementSelector,
  createTimelineCapture,
} from './capture/index.js'

export type {
  ConsoleCapture,
  NetworkCapture,
  ScreenshotCapture,
  PerformanceCapture,
  ElementSelector,
  TimelineCapture,
} from './capture/index.js'

export { createBrowserOtelSpanProcessor } from './otel.js'
export type {
  BrowserOtelSpan,
  BrowserOtelSpanProcessor,
  BrowserOtelSpanProcessorOptions,
} from './otel.js'

export { DEFAULT_API_ENDPOINT } from '@mushi-mushi/core'

export type {
  MushiReportCategory,
  MushiConsoleEntry,
  MushiNetworkEntry,
  MushiPerformanceMetrics,
  MushiTimelineEntry,
  MushiTimelineKind,
  MushiCaptureEventInput,
} from '@mushi-mushi/core'

// ── Headless capture client ───────────────────────────────────────────────────

export interface HeadlessCaptureOptions {
  /** Mushi project ID — `proj_…` from the console's Project Settings. */
  projectId: string
  /** Project API key — must have `report:write` scope. */
  apiKey: string
  /**
   * Override the ingest endpoint. Defaults to the Mushi Cloud URL.
   * Self-hosted deployments MUST set this.
   */
  apiEndpoint?: string
  /** Timeout in ms for each individual report POST. Default 10 s. */
  timeout?: number
}

export interface HeadlessCaptureEventInput {
  /** Human-readable summary — becomes `reports.description`. */
  description: string
  category?: 'bug' | 'slow' | 'visual' | 'confusing' | 'other'
  severity?: 'critical' | 'high' | 'medium' | 'low'
  component?: string
  metadata?: Record<string, unknown>
  tags?: Record<string, string | number | boolean>
  error?: { name?: string; message?: string; stack?: string }
}

export interface HeadlessCaptureResult {
  ok: boolean
  reportId?: string
}

export interface HeadlessCaptureInstance {
  /**
   * Submit a bug report programmatically without opening the widget.
   * Never throws — failures are captured in the returned `{ ok: false }`.
   */
  captureEvent(event: HeadlessCaptureEventInput): Promise<HeadlessCaptureResult>
  /**
   * Convenience wrapper: normalises any thrown value (Error, string, unknown)
   * into a critical-severity `captureEvent` call.
   */
  captureException(
    error: unknown,
    options?: Omit<HeadlessCaptureEventInput, 'description' | 'error'>,
  ): Promise<HeadlessCaptureResult>
}

let warnedOnce = false

function warnOnce(msg: string): void {
  if (!warnedOnce) {
    warnedOnce = true
    console.warn(msg)
  }
}

/**
 * Create a lightweight headless capture instance.
 *
 * No widget is initialised. No DOM mutations occur. The report is sent
 * directly over fetch using the same `/v1/reports` wire format as the
 * browser and node SDK.
 */
export function createHeadlessCapture(opts: HeadlessCaptureOptions): HeadlessCaptureInstance {
  const endpoint = (opts.apiEndpoint ?? DEFAULT_API_ENDPOINT).replace(/\/$/, '')
  const timeout = opts.timeout ?? 10_000

  async function submitRaw(event: HeadlessCaptureEventInput): Promise<HeadlessCaptureResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(`${endpoint}/v1/reports`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Mushi-Api-Key': opts.apiKey,
          'X-Mushi-Project': opts.projectId,
          'User-Agent': '@mushi-mushi/web:headless',
        },
        body: JSON.stringify({
          projectId: opts.projectId,
          category: event.category ?? 'bug',
          description: event.description,
          ...(event.severity ? { severity: event.severity } : {}),
          environment: {
            url: typeof window !== 'undefined' ? window.location.href : undefined,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          },
          metadata: {
            ...(event.metadata ?? {}),
            ...(event.error ? { error: event.error } : {}),
            ...(event.tags ? { tags: event.tags } : {}),
            ...(event.component ? { component: event.component } : {}),
          },
          // Browser sessions don't have a crypto-signed reporter token —
          // use a project-scoped placeholder that the backend treats as
          // a programmatic (non-widget) submission.
          reporterToken: `headless-${opts.projectId}`,
          createdAt: new Date().toISOString(),
          sdkPackage: '@mushi-mushi/web',
        }),
      })
      if (!res.ok) {
        warnOnce(`[mushi-mushi/web:headless] submit failed: HTTP ${res.status}`)
        return { ok: false }
      }
      const body = await res.json().catch(() => ({})) as { data?: { reportId?: string } }
      return { ok: true, reportId: body.data?.reportId }
    } catch (err) {
      warnOnce(`[mushi-mushi/web:headless] submit threw: ${(err as Error).message}`)
      return { ok: false }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    captureEvent(event: HeadlessCaptureEventInput): Promise<HeadlessCaptureResult> {
      return submitRaw(event)
    },

    captureException(
      error: unknown,
      options: Omit<HeadlessCaptureEventInput, 'description' | 'error'> = {},
    ): Promise<HeadlessCaptureResult> {
      const e = error instanceof Error ? error : new Error(String(error))
      return submitRaw({
        description: e.message,
        category: 'bug',
        severity: 'critical',
        component: 'headless:captureException',
        error: { name: e.name, message: e.message, stack: e.stack },
        ...options,
      })
    },
  }
}
