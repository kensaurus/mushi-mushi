/**
 * FILE: packages/svelte/src/index.ts
 * PURPOSE: Svelte SDK for Mushi Mushi — init, report submission,
 *          and SvelteKit error handler via @mushi-mushi/core.
 */

import { createApiClient, captureEnvironment, getSessionId, getReporterToken, createLogger } from '@mushi-mushi/core'
import type { MushiApiClient, MushiReport, MushiReportCategory } from '@mushi-mushi/core'

const log = createLogger({ scope: 'mushi:svelte' })

export interface MushiConfig {
  projectId: string
  apiKey: string
  endpoint?: string
}

interface MushiInstance {
  submitReport(data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): Promise<void>
  captureError(err: unknown, context?: Record<string, unknown>): void
}

let _instance: MushiInstance | null = null
let _client: MushiApiClient | null = null
let _projectId = ''

function buildReport(data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): MushiReport {
  return {
    id: crypto.randomUUID?.() ?? `mushi_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    projectId: _projectId,
    description: data.description,
    category: data.category,
    environment: captureEnvironment(),
    metadata: data.metadata,
    sessionId: getSessionId(),
    reporterToken: getReporterToken(),
    createdAt: new Date().toISOString(),
  } as MushiReport
}

export function initMushi(config: MushiConfig): MushiInstance {
  _projectId = config.projectId

  _client = createApiClient({
    projectId: config.projectId,
    apiKey: config.apiKey,
    ...(config.endpoint ? { apiEndpoint: config.endpoint } : {}),
  })

  _instance = {
    async submitReport(data) {
      if (!_client) throw new Error('Call initMushi() first')
      await _client.submitReport(buildReport(data))
    },
    captureError(err: unknown, context?: Record<string, unknown>) {
      const description = err instanceof Error ? err.message : String(err)
      _instance?.submitReport({
        description,
        category: 'bug',
        metadata: { stack: err instanceof Error ? err.stack : undefined, ...context },
      }).catch(e => log.error('Failed to capture error', { err: String(e) }))
    },
  }

  return _instance
}

export function getMushi(): MushiInstance {
  if (!_instance) throw new Error('Call initMushi() first')
  return _instance
}

export function createMushiErrorHandler() {
  return ({ error, event }: { error: unknown; event?: { url?: { pathname?: string } } }) => {
    if (_instance) {
      _instance.captureError(error, { route: event?.url?.pathname })
    }
  }
}
