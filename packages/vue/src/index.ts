/**
 * FILE: packages/vue/src/index.ts
 * PURPOSE: Vue 3 plugin for Mushi Mushi — provides report submission,
 *          error capture, and a global error handler via @mushi/core.
 */

import type { Plugin, InjectionKey, App } from 'vue'
import { inject, ref } from 'vue'
import { createApiClient, captureEnvironment, getSessionId, getReporterToken, createLogger } from '@mushi/core'
import type { MushiApiClient, MushiReport, MushiReportCategory } from '@mushi/core'

const log = createLogger({ scope: 'mushi:vue' })

export interface MushiConfig {
  projectId: string
  apiKey: string
  endpoint?: string
}

interface MushiInstance {
  submitReport(data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): Promise<void>
  captureError(err: unknown, context?: Record<string, unknown>): void
}

const MUSHI_KEY: InjectionKey<MushiInstance> = Symbol('mushi')

function buildReport(projectId: string, data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): MushiReport {
  return {
    id: crypto.randomUUID?.() ?? `mushi_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    projectId,
    description: data.description,
    category: data.category,
    environment: captureEnvironment(),
    metadata: data.metadata,
    sessionId: getSessionId(),
    reporterToken: getReporterToken(),
    createdAt: new Date().toISOString(),
  } as MushiReport
}

export const MushiPlugin: Plugin = {
  install(app: App, config: MushiConfig) {
    const client: MushiApiClient = createApiClient({
      projectId: config.projectId,
      apiKey: config.apiKey,
      apiEndpoint: config.endpoint ?? 'https://api.mushimushi.dev',
    })

    const instance: MushiInstance = {
      async submitReport(data) {
        await client.submitReport(buildReport(config.projectId, data))
      },
      captureError(err: unknown, context?: Record<string, unknown>) {
        const description = err instanceof Error ? err.message : String(err)
        instance.submitReport({
          description,
          category: 'bug',
          metadata: { stack: err instanceof Error ? err.stack : undefined, ...context },
        }).catch(e => log.error('Failed to capture error', { err: String(e) }))
      },
    }

    app.provide(MUSHI_KEY, instance)

    app.config.errorHandler = (err, _vm, info) => {
      instance.captureError(err, { vueInfo: info })
    }
  },
}

export function useMushi(): MushiInstance | undefined {
  return inject(MUSHI_KEY)
}

export function useMushiReport() {
  const mushi = inject(MUSHI_KEY)
  return {
    submitReport: async (data: { description: string; category: MushiReportCategory }) => {
      if (!mushi) throw new Error('MushiPlugin not installed')
      await mushi.submitReport(data)
    },
  }
}

export function useMushiWidget() {
  const isOpen = ref(false)
  return {
    isOpen,
    open: () => { isOpen.value = true },
    close: () => { isOpen.value = false },
  }
}
