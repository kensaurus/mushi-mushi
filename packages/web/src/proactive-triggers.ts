import type { MushiApiCascadeConfig, MushiUrlMatcher } from '@mushi-mushi/core'
import { getInternalRequestKind, getRequestUrl, shouldIgnoreMushiUrl } from './internal-requests'
import { subscribeHistory } from './history-patch'

export interface ProactiveTriggerConfig {
  rageClick?: boolean
  longTask?: boolean
  apiCascade?: boolean | MushiApiCascadeConfig
  apiEndpoint?: string
  errorBoundary?: boolean
  /**
   * Beta-mode nudges. Fire when the user has been on the same route for
   * `pageDwellMs` continuous milliseconds without filing any report. Default
   * disabled because production apps usually don't want unsolicited prompts;
   * recommended only when `betaMode.enabled` is true on the widget.
   *
   * Pass `true` to use the default 5-minute threshold, or a config object
   * to override. Set to `false` (default) to disable entirely.
   */
  pageDwell?: boolean | { thresholdMs?: number; excludeRoutes?: string[] }
  /**
   * First-session welcome. Fires exactly once per user (tracked via
   * `localStorage`) `delayMs` milliseconds after `Mushi.init`. Use to
   * gently surface the bug button to new beta users so they know feedback
   * is welcome. Default disabled.
   */
  firstSession?: boolean | { delayMs?: number; storageKey?: string }
  /**
   * The project ID, used to namespace the `firstSession` localStorage key so
   * multi-tenant single-page apps don't share first-session state across
   * projects. Sourced from `MushiConfig.projectId` by the SDK.
   */
  projectId?: string
}

const DEFAULT_EXCLUDE_ROUTES: readonly string[] = [
  '/login',
  '/logout',
  '/signup',
  '/sso/*',
  '/auth/*',
]

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

  // --- Page Dwell (beta-feedback nudge) ---
  // Tracks continuous time on the same `location.pathname`. Resets on every
  // navigation (pushState/replaceState/popstate). Auth routes are excluded by
  // default so users are never prompted during login/signup flows.
  const pageDwellEnabled = config.pageDwell === true
    || (typeof config.pageDwell === 'object' && config.pageDwell !== null)
  if (pageDwellEnabled && typeof window !== 'undefined') {
    const dwellCfg = typeof config.pageDwell === 'object' ? config.pageDwell ?? {} : {}
    const thresholdMs = dwellCfg.thresholdMs || 5 * 60 * 1000
    const excludeRoutes: readonly string[] =
      dwellCfg.excludeRoutes !== undefined ? dwellCfg.excludeRoutes : DEFAULT_EXCLUDE_ROUTES
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastPath = window.location?.pathname ?? ''

    function isExcluded(path: string): boolean {
      return excludeRoutes.some((pattern) => {
        if (pattern.endsWith('/*')) {
          return path.startsWith(pattern.slice(0, -2))
        }
        return path === pattern || path.startsWith(pattern + '/')
      })
    }

    function fire(): void {
      const path = window.location?.pathname ?? ''
      if (isExcluded(path)) return
      callbacks.onTrigger('page_dwell', { thresholdMs, path })
    }
    function arm(): void {
      if (timer) clearTimeout(timer)
      const path = window.location?.pathname ?? ''
      if (!isExcluded(path)) {
        timer = setTimeout(fire, thresholdMs)
      }
    }
    function reset(): void {
      const path = window.location?.pathname ?? ''
      if (path !== lastPath) {
        lastPath = path
        arm()
      }
    }
    arm()

    const unsubHistory = subscribeHistory({
      onPush: reset,
      onReplace: reset,
      onPop: reset,
    })
    cleanups.push(() => {
      if (timer) clearTimeout(timer)
      unsubHistory()
    })
  }

  // --- First Session Welcome ---
  // Beta apps benefit from a single, well-timed "feedback is welcome"
  // nudge for new visitors. We persist a flag in localStorage so we only
  // fire it once per user, not once per tab/session. Cooldown + suppression
  // are still enforced by the ProactiveManager downstream.
  //
  // The storage key is project-scoped by default so multi-tenant SPAs
  // (e.g. different projects in the same domain) don't share the "already
  // shown" flag. Pass an explicit `storageKey` to override.
  const firstSessionEnabled = config.firstSession === true
    || (typeof config.firstSession === 'object' && config.firstSession !== null)
  if (firstSessionEnabled && typeof window !== 'undefined') {
    const opts = typeof config.firstSession === 'object' ? config.firstSession ?? {} : {}
    const delayMs = opts.delayMs ?? 45 * 1000
    const storageKey = opts.storageKey
      ?? (config.projectId ? `mushi:${config.projectId}:firstSessionShown` : 'mushi:firstSessionShown')

    let alreadyShown = false
    try { alreadyShown = window.localStorage?.getItem(storageKey) === '1' }
    catch { /* localStorage unavailable */ }

    if (!alreadyShown) {
      const timer = setTimeout(() => {
        try { window.localStorage?.setItem(storageKey, '1') } catch { /* noop */ }
        callbacks.onTrigger('first_session', { delayMs })
      }, delayMs)
      cleanups.push(() => clearTimeout(timer))
    }
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
