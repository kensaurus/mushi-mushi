/**
 * FILE: packages/svelte/src/index.ts
 * PURPOSE: Svelte SDK for Mushi Mushi — delegates entirely to @mushi-mushi/web
 *          so offline queue, PII scrubber, breadcrumb buffer, and rate limiter
 *          are all inherited automatically. Mirrors the React provider pattern.
 */

import { Mushi } from '@mushi-mushi/web'
import type { MushiConfig as CoreMushiConfig, MushiSDKInstance } from '@mushi-mushi/core'

export interface MushiConfig {
  projectId: string
  apiKey: string
  endpoint?: string
}

function toCoreConfig(config: MushiConfig): CoreMushiConfig {
  return {
    projectId: config.projectId,
    apiKey: config.apiKey,
    ...(config.endpoint ? { apiEndpoint: config.endpoint } : {}),
  }
}

export function initMushi(config: MushiConfig): MushiSDKInstance {
  return Mushi.init(toCoreConfig(config))
}

export function getMushi(): MushiSDKInstance {
  const instance = Mushi.getInstance()
  if (!instance) throw new Error('Call initMushi() first')
  return instance
}

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
