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
 *
 * No decorators, on purpose. This package is built with tsup, not ng-packagr,
 * so an `@Injectable()` class ships as a runtime decorator call whose factory
 * Angular must compile with `@angular/compiler` — which AOT apps (every
 * `ng build`) never load, so DI threw "needs to be compiled using the JIT
 * compiler". Every provider below is an explicit factory with explicit
 * `deps`, which Angular resolves without compiling anything.
 */

import {
  ENVIRONMENT_INITIALIZER,
  ErrorHandler,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core'
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

/**
 * App-wide Mushi handle. Provided by `provideMushi()` / `provideMushiAngular()`
 * and read with `inject(MushiService)`. Do not list the class itself in a
 * `providers` array: it has no compiled factory, so use the provider functions.
 */
export class MushiService {
  constructor(config?: MushiConfig) {
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

  /** Attach the signed-in user to reports and analytics (same as `Mushi.identify()`). */
  identify(userId: string, traits?: { email?: string; name?: string; [k: string]: unknown }): void {
    Mushi.getInstance()?.identify(userId, traits)
  }

  captureError(error: unknown, context?: Record<string, unknown>): void {
    Mushi.getInstance()?.captureException(error, { metadata: context }).catch(() => {})
  }
}

/**
 * Angular `ErrorHandler` that reports uncaught errors to Mushi, then logs them
 * exactly like Angular's default handler so the console output does not change.
 */
export class MushiErrorHandler extends ErrorHandler {
  private service: MushiService

  constructor(service: MushiService) {
    super()
    this.service = service
  }

  override handleError(error: unknown): void {
    this.service.captureError(error)
    super.handleError(error)
  }
}

/**
 * The provider list both public functions share. `serviceFactory` lets the
 * legacy `provideMushi(config).service` accessor and DI hand out one instance.
 */
function mushiProviders(config: MushiConfig, serviceFactory: (config: MushiConfig) => MushiService): Provider[] {
  return [
    { provide: MUSHI_CONFIG, useValue: config },
    { provide: MushiService, useFactory: serviceFactory, deps: [MUSHI_CONFIG] },
    { provide: MushiErrorHandler, useFactory: (service: MushiService) => new MushiErrorHandler(service), deps: [MushiService] },
    { provide: ErrorHandler, useExisting: MushiErrorHandler },
    // Angular resolves ErrorHandler lazily, on the first error, so nothing
    // would construct MushiService (and call Mushi.init) at startup. The
    // environment initializer does. It is the v14+ token rather than
    // provideEnvironmentInitializer() (v19+) so the >=17 peer range holds.
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        inject(MushiService)
      },
    },
  ]
}

/** `provideMushi()`'s return value: environment providers, plus the original `{ service, errorHandler }` accessors. */
export type MushiEnvironmentProviders = EnvironmentProviders & {
  /** @deprecated Inject `MushiService` instead. Same instance DI hands out. */
  readonly service: MushiService
  /** @deprecated Provided as Angular's `ErrorHandler` automatically. */
  readonly errorHandler: MushiErrorHandler
}

/**
 * App-level setup for `bootstrapApplication` (or `NgModule.providers`):
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideMushi({ projectId: '…', apiKey: '…' })],
 * })
 * ```
 *
 * Provides `MushiService`, installs `MushiErrorHandler` as Angular's
 * `ErrorHandler`, and initialises the SDK at startup (browser only).
 */
export function provideMushi(config: MushiConfig): MushiEnvironmentProviders {
  let shared: MushiService | null = null
  const serviceFor = (cfg: MushiConfig): MushiService => (shared ??= new MushiService(cfg))
  let legacyHandler: MushiErrorHandler | null = null
  const providers = makeEnvironmentProviders(mushiProviders(config, serviceFor))
  // The pre-DI API returned `{ service, errorHandler }`. Keep both readable,
  // lazily and sharing DI's instance, so that code keeps working and
  // Mushi.init still runs once.
  Object.defineProperties(providers, {
    service: { get: () => serviceFor(config) },
    errorHandler: { get: () => (legacyHandler ??= new MushiErrorHandler(serviceFor(config))) },
  })
  return providers as MushiEnvironmentProviders
}

/**
 * The same providers as a plain `Provider[]`, for spreading:
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [...provideMushiAngular({ projectId: '…', apiKey: '…' })],
 * })
 * ```
 *
 * `MushiService` reads `MUSHI_CONFIG` through DI, so SSR-aware platforms
 * (Angular Universal) can override it per request.
 */
export function provideMushiAngular(config: MushiConfig): Provider[] {
  return mushiProviders(config, (cfg) => new MushiService(cfg))
}
