/**
 * FILE: packages/angular/src/index.ts
 * PURPOSE: Angular SDK for Mushi Mushi — injectable service, error handler,
 *          and provider factory via @mushi/core.
 */

import { createApiClient, captureEnvironment, getSessionId, getReporterToken, createLogger } from '@mushi/core'
import type { MushiApiClient, MushiReport, MushiReportCategory } from '@mushi/core'

const log = createLogger({ scope: 'mushi:angular' })

export interface MushiConfig {
  projectId: string
  apiKey: string
  endpoint?: string
}

export const MUSHI_CONFIG = 'MUSHI_CONFIG'

export class MushiService {
  private client: MushiApiClient
  private projectId: string

  constructor(config: MushiConfig) {
    this.projectId = config.projectId
    this.client = createApiClient({
      projectId: config.projectId,
      apiKey: config.apiKey,
      apiEndpoint: config.endpoint ?? 'https://api.mushimushi.dev',
    })
  }

  private buildReport(data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): MushiReport {
    return {
      id: crypto.randomUUID?.() ?? `mushi_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      projectId: this.projectId,
      description: data.description,
      category: data.category,
      environment: captureEnvironment(),
      metadata: data.metadata,
      sessionId: getSessionId(),
      reporterToken: getReporterToken(),
      createdAt: new Date().toISOString(),
    } as MushiReport
  }

  async submitReport(data: { description: string; category: MushiReportCategory; metadata?: Record<string, unknown> }): Promise<void> {
    await this.client.submitReport(this.buildReport(data))
  }

  captureError(error: unknown, context?: Record<string, unknown>): void {
    const description = error instanceof Error ? error.message : String(error)
    this.submitReport({
      description,
      category: 'bug',
      metadata: { stack: error instanceof Error ? error.stack : undefined, ...context },
    }).catch(e => log.error('Failed to capture error', { err: String(e) }))
  }
}

export class MushiErrorHandler {
  private service: MushiService

  constructor(service: MushiService) {
    this.service = service
  }

  handleError(error: unknown): void {
    this.service.captureError(error)
    log.error('Unhandled error', { err: String(error) })
  }
}

export function provideMushi(config: MushiConfig) {
  const service = new MushiService(config)
  return {
    service,
    errorHandler: new MushiErrorHandler(service),
  }
}
