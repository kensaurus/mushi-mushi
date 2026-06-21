// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/svelte/src/index.ts
 * PURPOSE: Svelte / SvelteKit SDK for Mushi Mushi — delegates entirely
 *          to @mushi-mushi/web so offline queue, PII scrubber, breadcrumb
 *          buffer, rate limiter, INP capture, beforeSendFeedback, and
 *          onCrashedLastRun are all inherited automatically.
 *
 * Round 8 (2026-05-21):
 *   - `MushiConfig` is now the canonical core type. Consumers get the
 *     full Round 7 surface (theme, position, locale, beforeSendFeedback,
 *     onCrashedLastRun, …) with no narrow re-shape.
 *   - SSR guard around `initMushi` so SvelteKit's first server-render
 *     doesn't reach for `window`.
 *   - `mushiHandleError` is the SvelteKit-shaped server-hook helper
 *     for `src/hooks.server.ts` — it returns `App.Error | void` to fit
 *     the SvelteKit type contract.
 */

import { Mushi } from '@mushi-mushi/web'
import type { MushiConfig, MushiSDKInstance } from '@mushi-mushi/core'

// Re-export the canonical config so consumers `import { MushiConfig } from
// '@mushi-mushi/svelte'` and get the full Round 7 surface.
export type { MushiConfig, MushiSDKInstance, MushiReportCategory } from '@mushi-mushi/core'

const isBrowser = (): boolean =>
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
  typeof (globalThis as { document?: unknown }).document !== 'undefined'

/**
 * Initialise the Mushi SDK. SSR-safe: returns `null` when run on the
 * server (SvelteKit's hooks.server.ts) so the runner can skip wiring
 * up on the wrong side. Mount this from `src/hooks.client.ts`'s
 * `init` export, or from a top-level `+layout.svelte`'s `onMount`.
 */
export function initMushi(config: MushiConfig): MushiSDKInstance | null {
  if (!isBrowser()) return null
  return Mushi.init(config)
}

export function getMushi(): MushiSDKInstance {
  const instance = Mushi.getInstance()
  if (!instance) {
    throw new Error(
      'Mushi not initialised — call initMushi() in src/hooks.client.ts or a top-level +layout.svelte onMount.',
    )
  }
  return instance
}

/**
 * Generic error-handler factory — works in any Svelte / SvelteKit
 * context that surfaces an `{ error, event }` shape. Kept for
 * backwards compatibility; new code should prefer `mushiHandleError`
 * which matches SvelteKit's `handleError` server-hook type exactly.
 */
export function createMushiErrorHandler() {
  return ({ error, event }: { error: unknown; event?: { url?: { pathname?: string } } }) => {
    const instance = Mushi.getInstance()
    if (instance) {
      instance.captureException(error, {
        source: 'svelte-error-handler',
        metadata: { route: event?.url?.pathname },
      }).catch(() => {})
    }
  }
}

/**
 * SvelteKit `handleError` server-hook helper. Drop into
 * `src/hooks.server.ts` and `src/hooks.client.ts`:
 *
 * ```ts
 * // src/hooks.server.ts
 * import type { HandleServerError } from '@sveltejs/kit'
 * import { mushiHandleError } from '@mushi-mushi/svelte'
 *
 * export const handleError: HandleServerError = mushiHandleError({
 *   // optional — the default extracts a stable message from the error
 *   format: (error) => ({ message: 'Internal error', code: 'E_INTERNAL' }),
 * })
 * ```
 *
 * The returned hook captures the error to Mushi and forwards the
 * formatted shape to SvelteKit's typed `App.Error` interface so the
 * +error.svelte page receives a consistent payload.
 *
 * Server-side: writes via `Mushi.getInstance()` if `initMushi` was
 * called from `hooks.server.ts`. Otherwise no-ops gracefully.
 */
export interface MushiHandleErrorOptions {
  /** Optional formatter that maps the error to `App.Error`. */
  format?: (error: unknown, event?: SvelteKitErrorEvent) => Record<string, unknown> | void
}

export interface SvelteKitErrorEvent {
  url?: { pathname?: string }
  request?: { method?: string }
  status?: number
  message?: string
}

export function mushiHandleError(opts: MushiHandleErrorOptions = {}) {
  return (
    input: { error: unknown; event?: SvelteKitErrorEvent; status?: number; message?: string },
  ): Record<string, unknown> | void => {
    const { error, event, status, message } = input
    const instance = Mushi.getInstance()
    if (instance) {
      instance.captureException(error, {
        source: 'sveltekit-handle-error',
        metadata: {
          route: event?.url?.pathname,
          method: event?.request?.method,
          status,
          message,
        },
      }).catch(() => {})
    }
    return opts.format?.(error, event)
  }
}
