const QUEUE_KEY = '@mushi:offline_queue'

interface QueueItem {
  report: Record<string, unknown>
  enqueuedAt: number
}

export class AsyncStorageQueue {
  private maxSize: number
  private apiEndpoint: string
  private apiKey: string
  private onSynced?: (reportId: string) => void

  constructor(config: {
    maxSize?: number
    apiEndpoint: string
    apiKey: string
    /** Fired once per queued report that drains successfully to the server. */
    onSynced?: (reportId: string) => void
  }) {
    this.maxSize = config.maxSize ?? 50
    this.apiEndpoint = config.apiEndpoint
    this.apiKey = config.apiKey
    this.onSynced = config.onSynced
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
        const reportId = (item.report as { id?: unknown }).id
        if (typeof reportId === 'string') {
          try {
            this.onSynced?.(reportId)
          } catch {
            // A host callback must never break the drain loop.
          }
        }
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

// PII scrubbing — Wave S2 / D-16
//
// Mirrors packages/core/src/pii-scrubber.ts so a React Native user who pastes
// a Stripe key, an OpenAI key, a JWT, or a credit card into a bug report
// never ships it to our servers. Order matters: high-entropy / high-cost
// tokens first so generic email/phone regex never wins a tie. We omit
// IPv4/IPv6 by default (too noisy: `192.168.1.1` is rarely PII).
const SCRUB_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]'],
  [/\b(?:\d[ -]*){12,18}\d\b/g, '[REDACTED_CC]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [
    /(?:aws_secret_access_key|secret_access_key)["'\s:=]+[A-Za-z0-9/+=]{40}\b/gi,
    'aws_secret_access_key=[REDACTED_AWS_SECRET]',
  ],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g, '[REDACTED_STRIPE_KEY]'],
  [/\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b/g, '[REDACTED_STRIPE_PK]'],
  [/\bxox[abpor]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\bghp_[A-Za-z0-9]{36}\b/g, '[REDACTED_GITHUB_PAT]'],
  [/\bgithub_pat_[A-Za-z0-9_]{80,}\b/g, '[REDACTED_GITHUB_PAT]'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_OPENAI_KEY]'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_ANTHROPIC_KEY]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED_GOOGLE_KEY]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]'],
  [/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]'],
  [
    /(?:\+\d{1,3}[\s.\-])?\(?\d{2,4}\)?[\s.\-]\d{3,4}[\s.\-]\d{3,4}\b/g,
    '[REDACTED_PHONE]',
  ],
]

function scrubPii(text: string): string {
  let result = text
  for (const [regex, replacement] of SCRUB_PATTERNS) {
    result = result.replace(regex, replacement)
  }
  return result
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
