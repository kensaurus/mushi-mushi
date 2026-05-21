/**
 * FILE: packages/vue/src/index.ts
 * PURPOSE: Vue 3 plugin for Mushi Mushi — delegates entirely to @mushi-mushi/web
 *          so offline queue, PII scrubber, breadcrumb buffer, rate limiter,
 *          INP capture, beforeSendFeedback, and onCrashedLastRun are all
 *          inherited automatically. Mirrors the React provider pattern.
 *
 * Round 8 (2026-05-21):
 *   - `MushiConfig` is now the canonical core type (no narrow re-shape) so
 *     Nuxt / Vite users see the full Round 7 surface (theme, position,
 *     beforeSendFeedback, onCrashedLastRun, …).
 *   - SSR guard around `Mushi.init` so Nuxt 3's first server-render doesn't
 *     reach for `window` / `localStorage`.
 *   - `app.config.errorHandler` is chained, not replaced, so existing
 *     reporters (Sentry, Bugsnag, Vue's own dev-tools) keep working.
 */

import type { Plugin, InjectionKey, App, ComponentPublicInstance } from 'vue'
import { inject, ref } from 'vue'
import { Mushi } from '@mushi-mushi/web'
import type { MushiConfig, MushiSDKInstance, MushiReportCategory } from '@mushi-mushi/core'

// Re-export the canonical config so consumers `import { MushiConfig } from
// '@mushi-mushi/vue'` and get the full Round 7 surface, including
// `beforeSendFeedback`, `onCrashedLastRun`, theme, position, locale, etc.
export type { MushiConfig, MushiSDKInstance, MushiReportCategory } from '@mushi-mushi/core'

const MUSHI_KEY: InjectionKey<MushiSDKInstance> = Symbol('mushi')

const isBrowser = (): boolean =>
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
  typeof (globalThis as { document?: unknown }).document !== 'undefined'

export const MushiPlugin: Plugin = {
  install(app: App, config: MushiConfig) {
    // SSR guard: Nuxt 3 / Vite SSR call install() on the server. Skip
    // SDK init there — the client-side runtime mounts a fresh app
    // and re-runs install() with browser globals available.
    if (!isBrowser()) {
      return
    }

    const sdk = Mushi.init(config)
    app.provide(MUSHI_KEY, sdk)

    // Chain — don't replace — the existing errorHandler so Sentry /
    // Bugsnag / Datadog / Vue dev tools keep firing alongside us.
    const previous = app.config.errorHandler
    app.config.errorHandler = (
      err: unknown,
      vm: ComponentPublicInstance | null,
      info: string,
    ) => {
      // Run upstream first so its own error path is unaffected by ours.
      try {
        previous?.(err, vm, info)
      } catch {
        // Never swallow our reporter on a buggy upstream handler.
      }
      sdk.captureException(err, {
        source: 'vue-error-handler',
        metadata: { vueInfo: info },
      }).catch(() => {})
    }
  },
}

export function useMushi(): MushiSDKInstance | undefined {
  return inject(MUSHI_KEY)
}

export function useMushiReport() {
  const sdk = inject(MUSHI_KEY)
  return {
    submitReport: async (data: { description: string; category: MushiReportCategory }) => {
      if (!sdk) throw new Error('MushiPlugin not installed')
      await sdk.captureEvent({ description: data.description, category: data.category })
    },
  }
}

/**
 * Reactive widget state helper. Delegates open/close to the Mushi SDK
 * so the full widget lifecycle (screenshot capture, breadcrumbs, etc.)
 * is managed by @mushi-mushi/web.
 */
export function useMushiWidget() {
  const sdk = inject(MUSHI_KEY)
  const isOpen = ref(sdk?.isOpen() ?? false)
  return {
    isOpen,
    open: () => {
      sdk?.open()
      isOpen.value = true
    },
    close: () => {
      sdk?.close()
      isOpen.value = false
    },
  }
}
