/**
 * FILE: packages/vue/src/index.ts
 * PURPOSE: Vue 3 plugin for Mushi Mushi — delegates entirely to @mushi-mushi/web
 *          so offline queue, PII scrubber, breadcrumb buffer, and rate limiter
 *          are all inherited automatically. Mirrors the React provider pattern.
 */

import type { Plugin, InjectionKey, App } from 'vue'
import { inject, ref } from 'vue'
import { Mushi } from '@mushi-mushi/web'
import type { MushiConfig as CoreMushiConfig, MushiSDKInstance, MushiReportCategory } from '@mushi-mushi/core'

export interface MushiConfig {
  projectId: string
  apiKey: string
  endpoint?: string
}

const MUSHI_KEY: InjectionKey<MushiSDKInstance> = Symbol('mushi')

function toCoreConfig(config: MushiConfig): CoreMushiConfig {
  return {
    projectId: config.projectId,
    apiKey: config.apiKey,
    ...(config.endpoint ? { apiEndpoint: config.endpoint } : {}),
  }
}

export const MushiPlugin: Plugin = {
  install(app: App, config: MushiConfig) {
    const sdk = Mushi.init(toCoreConfig(config))

    app.provide(MUSHI_KEY, sdk)

    app.config.errorHandler = (err, _vm, info) => {
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
