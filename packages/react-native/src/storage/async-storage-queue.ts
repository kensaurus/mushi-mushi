const QUEUE_KEY = '@mushi:offline_queue'

interface QueueItem {
  report: Record<string, unknown>
  enqueuedAt: number
}

export class AsyncStorageQueue {
  private maxSize: number
  private apiEndpoint: string
  private apiKey: string

  constructor(config: { maxSize?: number; apiEndpoint: string; apiKey: string }) {
    this.maxSize = config.maxSize ?? 50
    this.apiEndpoint = config.apiEndpoint
    this.apiKey = config.apiKey
  }

  async enqueue(report: object): Promise<void> {
    const AsyncStorage = await this.getAsyncStorage()
    if (!AsyncStorage) return

    const queue = await this.getQueue(AsyncStorage)
    if (queue.length >= this.maxSize) queue.shift()

    // Added: PII scrubbing (Phase 2.4)
    const scrubbedReport = this.scrubReportPii(report as Record<string, unknown>)
    queue.push({ report: scrubbedReport, enqueuedAt: Date.now() })
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  }

  async flush(): Promise<number> {
    const AsyncStorage = await this.getAsyncStorage()
    if (!AsyncStorage) return 0

    const queue = await this.getQueue(AsyncStorage)
    if (!queue.length) return 0

    let flushed = 0
    const remaining: QueueItem[] = []

    for (const item of queue) {
      // Added: retry+jitter (Phase 2.4)
      const ok = await sendWithRetry(item, this.apiEndpoint, this.apiKey)
      if (ok) {
        flushed++
      } else {
        remaining.push(item)
        break
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
    return flushed
  }

  async size(): Promise<number> {
    const AsyncStorage = await this.getAsyncStorage()
    if (!AsyncStorage) return 0
    const queue = await this.getQueue(AsyncStorage)
    return queue.length
  }

  // Added: PII scrubbing (Phase 2.4)
  // Scrubs free-text fields where users typically type emails / phones /
  // card numbers when describing a bug. We deliberately do NOT scrub
  // structured fields like `metadata.userEmail` — those are explicitly
  // captured by the host app via `setUser()` and the operator opts in to
  // collecting them. Scrubbing them here would silently break attribution.
  private scrubReportPii(report: Record<string, unknown>): Record<string, unknown> {
    const next = { ...report }
    if (typeof next.description === 'string') {
      next.description = scrubPii(next.description)
    }
    if (typeof next.summary === 'string') {
      next.summary = scrubPii(next.summary)
    }
    // Free-text breadcrumb messages are the other vector for accidental PII
    // (users paste account ids, card test numbers, etc. into the support
    // composer that gets logged as a breadcrumb).
    if (Array.isArray(next.breadcrumbs)) {
      next.breadcrumbs = (next.breadcrumbs as Array<Record<string, unknown>>).map((b) =>
        typeof b?.message === 'string' ? { ...b, message: scrubPii(b.message) } : b,
      )
    }
    return next
  }

  private async getQueue(storage: { getItem: (key: string) => Promise<string | null> }): Promise<QueueItem[]> {
    try {
      const raw = await storage.getItem(QUEUE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }

  private async getAsyncStorage() {
    try {
      const mod = await import('@react-native-async-storage/async-storage')
      return mod.default
    } catch {
      return null
    }
  }
}

// Added: PII scrubbing (Phase 2.4)
function scrubPii(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED]')
    .replace(/\b\d{3}[.-]?\d{3}[.-]?\d{4}\b/g, '[REDACTED]')
    .replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[REDACTED]')
}

// Added: retry+jitter (Phase 2.4)
async function sendWithRetry(item: QueueItem, endpoint: string, apiKey: string, attempt = 0): Promise<boolean> {
  const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000)
  try {
    const res = await fetch(`${endpoint}/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': apiKey,
      },
      body: JSON.stringify(item.report),
    })
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(delay)
      return sendWithRetry(item, endpoint, apiKey, attempt + 1)
    }
    return res.ok
  } catch {
    if (attempt < 3) {
      await sleep(delay)
      return sendWithRetry(item, endpoint, apiKey, attempt + 1)
    }
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
