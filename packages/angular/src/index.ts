/**
 * FILE: packages/angular/src/index.ts
 * PURPOSE: Angular SDK for Mushi Mushi — delegates entirely to @mushi-mushi/web
 *          so offline queue, PII scrubber, breadcrumb buffer, and rate limiter
 *          are all inherited automatically. Mirrors the React provider pattern.
 */

import { InjectionToken, Injectable } from '@angular/core'
import { Mushi } from '@mushi-mushi/web'
import type { MushiConfig as CoreMushiConfig, MushiReportCategory } from '@mushi-mushi/core'

export interface MushiConfig {
  projectId: string
  apiKey: string
  endpoint?: string
  capture?: {
    discoverInventory?: boolean
  }
}

export const MUSHI_CONFIG = new InjectionToken<MushiConfig>('MushiConfig')

function toCoreConfig(config: MushiConfig): CoreMushiConfig {
  return {
    projectId: config.projectId,
    apiKey: config.apiKey,
    ...(config.endpoint ? { apiEndpoint: config.endpoint } : {}),
    ...(config.capture !== undefined ? { capture: config.capture } : {}),
  }
}

@Injectable()
export class MushiService {
  constructor(config: MushiConfig) {
    Mushi.init(toCoreConfig(config))
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

export function provideMushi(config: MushiConfig) {
  const service = new MushiService(config)
  return {
    service,
    errorHandler: new MushiErrorHandler(service),
  }
}
