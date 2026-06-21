// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/angular/src/index.ts
 * PURPOSE: Angular SDK for Mushi Mushi — delegates entirely to @mushi-mushi/web
 *          so offline queue, PII scrubber, breadcrumb buffer, rate limiter,
 *          INP capture, beforeSendFeedback, and onCrashedLastRun are all
 *          inherited automatically. Mirrors the React provider pattern.
 *
 * Round 8 (2026-05-21):
 *   - `MushiConfig` is now the canonical core type (no narrow re-shape).
 *   - SSR guard around `Mushi.init` so Angular Universal / @nguniversal
 *     prerender doesn't reach for `window` on the server.
 *   - `provideMushi` mirrors Angular DI conventions (returns providers,
 *     not a hand-built object).
 */

import { InjectionToken, Injectable, Optional, Inject } from '@angular/core'
import { Mushi } from '@mushi-mushi/web'
import type { MushiConfig, MushiReportCategory } from '@mushi-mushi/core'

// Re-export the canonical config so consumers `import { MushiConfig } from
// '@mushi-mushi/angular'` and get the full Round 7 surface.
export type { MushiConfig, MushiSDKInstance, MushiReportCategory } from '@mushi-mushi/core'

export const MUSHI_CONFIG = new InjectionToken<MushiConfig>('MushiConfig')

const isBrowser = (): boolean =>
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
  typeof (globalThis as { document?: unknown }).document !== 'undefined'

@Injectable()
export class MushiService {
  constructor(@Optional() @Inject(MUSHI_CONFIG) config?: MushiConfig) {
    // SSR guard: Angular Universal pre-renders on the server where
    // `window` / `document` / `localStorage` are absent. Skip init
    // there — the browser bundle re-runs the constructor on hydration.
    if (config && isBrowser()) {
      Mushi.init(config)
    }
  }

  report(data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): Promise<string | null> {
    return Mushi.getInstance()?.captureEvent({
      description: data.description,
      category: data.category,
      metadata: data.metadata,
    }) ?? Promise.resolve(null)
  }

  /** @deprecated Use report() — kept for backwards compatibility */
  async submitReport(data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): Promise<void> {
    await this.report(data)
  }

  captureError(error: unknown, context?: Record<string, unknown>): void {
    Mushi.getInstance()?.captureException(error, { metadata: context }).catch(() => {})
  }
}

export class MushiErrorHandler {
  private service: MushiService

  constructor(service: MushiService) {
    this.service = service
  }

  handleError(error: unknown): void {
    this.service.captureError(error)
  }
}

/**
 * Convenience builder that constructs a service + error handler pair
 * from a config. Kept for backwards compatibility — new Angular 16+
 * apps should prefer `provideMushiAngular` which returns DI providers
 * compatible with `bootstrapApplication`.
 */
export function provideMushi(config: MushiConfig) {
  const service = new MushiService(config)
  return {
    service,
    errorHandler: new MushiErrorHandler(service),
  }
}

/**
 * Angular 16+ DI provider factory for `bootstrapApplication`:
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     ...provideMushiAngular({ projectId: '…', apiKey: '…' }),
 *   ],
 * })
 * ```
 *
 * Returns the standard `Provider[]` shape Angular expects. The
 * `MushiService` constructor reads `MUSHI_CONFIG` via DI so SSR-aware
 * platforms (Angular Universal) can override it per-request.
 */
export function provideMushiAngular(config: MushiConfig) {
  return [
    { provide: MUSHI_CONFIG, useValue: config },
    MushiService,
    {
      provide: MushiErrorHandler,
      useFactory: (service: MushiService) => new MushiErrorHandler(service),
      deps: [MushiService],
    },
  ]
}
