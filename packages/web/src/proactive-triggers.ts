export interface ProactiveTriggerCallbacks {
  onTrigger: (type: string, context: Record<string, unknown>) => void
}

export interface ProactiveTriggerCleanup {
  destroy: () => void
}

export function setupProactiveTriggers(
  callbacks: ProactiveTriggerCallbacks,
): ProactiveTriggerCleanup {
  const cleanups: Array<() => void> = []

  // --- Rage Click Detection ---
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

  // --- Long Task Detection ---
  if (typeof PerformanceObserver !== 'undefined') {
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
  const failedRequests: number[] = []
  const origFetch = globalThis.fetch

  globalThis.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    try {
      const res = await origFetch.apply(this, args)
      if (!res.ok && res.status >= 400) {
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
      return res
    } catch (err) {
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
      throw err
    }
  } as typeof fetch

  cleanups.push(() => { globalThis.fetch = origFetch })

  return {
    destroy() {
      cleanups.forEach(fn => fn())
    },
  }
}
