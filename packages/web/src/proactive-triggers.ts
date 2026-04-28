import type { MushiApiCascadeConfig, MushiUrlMatcher } from '@mushi-mushi/core'
import { getInternalRequestKind, getRequestUrl, shouldIgnoreMushiUrl } from './internal-requests'

export interface ProactiveTriggerConfig {
  rageClick?: boolean
  longTask?: boolean
  apiCascade?: boolean | MushiApiCascadeConfig
  apiEndpoint?: string
  errorBoundary?: boolean
}

export interface ProactiveTriggerCallbacks {
  onTrigger: (type: string, context: Record<string, unknown>) => void
}

export interface ProactiveTriggerCleanup {
  destroy: () => void
}

export function setupProactiveTriggers(
  callbacks: ProactiveTriggerCallbacks,
  config: ProactiveTriggerConfig = {},
): ProactiveTriggerCleanup {
  const cleanups: Array<() => void> = []

  // --- Rage Click Detection ---
  if (config.rageClick !== false) {
    let clickTimes: number[] = []
    let lastClickTarget: EventTarget | null = null

    function handleClick(e: MouseEvent) {
      const now = Date.now()
      if (e.target === lastClickTarget) {
        clickTimes.push(now)
        clickTimes = clickTimes.filter(t => now - t < 500)
        if (clickTimes.length >= 3) {
          const el = e.target as HTMLElement
          callbacks.onTrigger('rage_click', {
            element: el.tagName,
            id: el.id,
            text: el.textContent?.slice(0, 50),
          })
          clickTimes = []
        }
      } else {
        lastClickTarget = e.target
        clickTimes = [now]
      }
    }
    document.addEventListener('click', handleClick, true)
    cleanups.push(() => document.removeEventListener('click', handleClick, true))
  }

  // --- Long Task Detection ---
  if (config.longTask !== false && typeof PerformanceObserver !== 'undefined') {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 5000) {
            callbacks.onTrigger('long_task', {
              duration: Math.round(entry.duration),
              startTime: Math.round(entry.startTime),
            })
          }
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
      cleanups.push(() => observer.disconnect())
    } catch {
      // longtask not supported
    }
  }

  // --- API Cascade Failure ---
  const apiCascade = normalizeApiCascadeConfig(config.apiCascade)
  if (apiCascade.enabled) {
    const failedRequests: number[] = []
    const origFetch = globalThis.fetch

    globalThis.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const [input, init] = args
      const url = getRequestUrl(input)
      const ignoreFailure = Boolean(getInternalRequestKind(input, init))
        || shouldIgnoreMushiUrl(url, {
          apiEndpoint: config.apiEndpoint,
          ignoreUrls: apiCascade.ignoreUrls,
        })

      try {
        const res = await origFetch.apply(this, args)
        if (!ignoreFailure && !res.ok && res.status >= 400) {
          recordApiFailure(failedRequests, callbacks)
        }
        return res
      } catch (err) {
        if (!ignoreFailure) recordApiFailure(failedRequests, callbacks)
        throw err
      }
    } as typeof fetch

    cleanups.push(() => { globalThis.fetch = origFetch })
  }

  // --- Global Error Boundary ---
  if (config.errorBoundary) {
    function handleError(event: ErrorEvent) {
      callbacks.onTrigger('error_boundary', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    }
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      callbacks.onTrigger('error_boundary', {
        message: event.reason instanceof Error ? event.reason.message : String(event.reason),
        type: 'unhandled_rejection',
      })
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    cleanups.push(() => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    })
  }

  return {
    destroy() {
      cleanups.forEach(fn => fn())
    },
  }
}

function normalizeApiCascadeConfig(
  config: boolean | MushiApiCascadeConfig | undefined,
): Required<Pick<MushiApiCascadeConfig, 'enabled'>> & { ignoreUrls: MushiUrlMatcher[] } {
  if (config === false) return { enabled: false, ignoreUrls: [] }
  if (config && typeof config === 'object') {
    return {
      enabled: config.enabled !== false,
      ignoreUrls: config.ignoreUrls ?? [],
    }
  }
  return { enabled: true, ignoreUrls: [] }
}

function recordApiFailure(failedRequests: number[], callbacks: ProactiveTriggerCallbacks): void {
  const now = Date.now()
  failedRequests.push(now)
  const recentFailures = failedRequests.filter(t => now - t < 10000)
  if (recentFailures.length >= 3) {
    callbacks.onTrigger('api_cascade', {
      failureCount: recentFailures.length,
      windowMs: 10000,
    })
    failedRequests.length = 0
  }
}
