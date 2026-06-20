import {
  buildSdkIngestHeaders,
  MUSHI_INTERNAL_INIT_MARKER,
  scrubPii,
  type MushiInternalRequestKind,
} from '@mushi-mushi/core'
import {
  decryptQueueBlob,
  encryptQueueBlob,
  ENCRYPTED_QUEUE_KEY,
  LEGACY_QUEUE_KEY,
  type AsyncStorageLike,
} from './secure-storage'

const QUEUE_KEY = ENCRYPTED_QUEUE_KEY

interface QueueItem {
  report: Record<string, unknown>
  enqueuedAt: number
}

export interface AsyncStorageQueueConfig {
  maxSize?: number
  apiEndpoint: string
  apiKey: string
  projectId: string
  sdkPackage?: string
  sdkVersion?: string
  getUserToken?: () => string | null | undefined
  /** When true (default), encrypt queue + store reporter token in SecureStore when available. */
  secureStorage?: boolean
  /** Fired once per queued report that drains successfully to the server. */
  onSynced?: (reportId: string) => void
}

export class AsyncStorageQueue {
  private maxSize: number
  private apiEndpoint: string
  private apiKey: string
  private projectId: string
  private sdkPackage?: string
  private sdkVersion?: string
  private getUserToken?: () => string | null | undefined
  private secureStorage: boolean
  private onSynced?: (reportId: string) => void

  constructor(config: AsyncStorageQueueConfig) {
    this.maxSize = config.maxSize ?? 50
    this.apiEndpoint = config.apiEndpoint
    this.apiKey = config.apiKey
    this.projectId = config.projectId
    this.sdkPackage = config.sdkPackage
    this.sdkVersion = config.sdkVersion
    this.getUserToken = config.getUserToken
    this.secureStorage = config.secureStorage !== false
    this.onSynced = config.onSynced
  }

  async enqueue(report: object): Promise<void> {
    const AsyncStorage = await this.getAsyncStorage()
    if (!AsyncStorage) return

    const queue = await this.getQueue(AsyncStorage)
    if (queue.length >= this.maxSize) queue.shift()

    const scrubbedReport = this.scrubReportPii(report as Record<string, unknown>)
    queue.push({ report: scrubbedReport, enqueuedAt: Date.now() })
    await this.persistQueue(AsyncStorage, queue)
  }

  async flush(): Promise<number> {
    const AsyncStorage = await this.getAsyncStorage()
    if (!AsyncStorage) return 0

    const queue = await this.getQueue(AsyncStorage)
    if (!queue.length) return 0

    let flushed = 0
    const remaining: QueueItem[] = []

    for (const item of queue) {
      const ok = await sendWithRetry(item, {
        apiEndpoint: this.apiEndpoint,
        apiKey: this.apiKey,
        projectId: this.projectId,
        sdkPackage: this.sdkPackage,
        sdkVersion: this.sdkVersion,
        getUserToken: this.getUserToken,
      })
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

    await this.persistQueue(AsyncStorage, remaining)
    return flushed
  }

  async size(): Promise<number> {
    const AsyncStorage = await this.getAsyncStorage()
    if (!AsyncStorage) return 0
    const queue = await this.getQueue(AsyncStorage)
    return queue.length
  }

  private scrubReportPii(report: Record<string, unknown>): Record<string, unknown> {
    const next = { ...report }
    if (typeof next.description === 'string') {
      next.description = scrubPii(next.description)
    }
    if (typeof next.summary === 'string') {
      next.summary = scrubPii(next.summary)
    }
    if (Array.isArray(next.breadcrumbs)) {
      next.breadcrumbs = (next.breadcrumbs as Array<Record<string, unknown>>).map((b) =>
        typeof b?.message === 'string' ? { ...b, message: scrubPii(b.message) } : b,
      )
    }
    if (Array.isArray(next.consoleLogs)) {
      next.consoleLogs = (next.consoleLogs as Array<Record<string, unknown>>).map((entry) =>
        typeof entry?.message === 'string' ? { ...entry, message: scrubPii(entry.message) } : entry,
      )
    }
    return next
  }

  private async persistQueue(storage: AsyncStorageLike, queue: QueueItem[]): Promise<void> {
    const plaintext = JSON.stringify(queue)
    const blob = await encryptQueueBlob(plaintext, this.secureStorage)
    await storage.setItem(QUEUE_KEY, blob)
  }

  private async getQueue(storage: AsyncStorageLike): Promise<QueueItem[]> {
    try {
      let raw = await storage.getItem(QUEUE_KEY)
      if (!raw) {
        raw = await storage.getItem(LEGACY_QUEUE_KEY)
        if (raw) {
          await storage.removeItem(LEGACY_QUEUE_KEY)
        }
      }
      if (!raw) return []
      const plaintext = await decryptQueueBlob(raw, this.secureStorage)
      return JSON.parse(plaintext) as QueueItem[]
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

interface SendContext {
  apiEndpoint: string
  apiKey: string
  projectId: string
  sdkPackage?: string
  sdkVersion?: string
  getUserToken?: () => string | null | undefined
}

async function sendWithRetry(item: QueueItem, ctx: SendContext, attempt = 0): Promise<boolean> {
  const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000)
  const internalKind: MushiInternalRequestKind = 'report-submit'
  const userToken = ctx.getUserToken?.() ?? null
  try {
    const res = await fetch(`${ctx.apiEndpoint}/v1/reports`, {
      method: 'POST',
      headers: buildSdkIngestHeaders({
        apiKey: ctx.apiKey,
        projectId: ctx.projectId,
        sdkPackage: ctx.sdkPackage,
        sdkVersion: ctx.sdkVersion,
        userToken,
        internalKind,
      }),
      body: JSON.stringify(item.report),
      [MUSHI_INTERNAL_INIT_MARKER]: internalKind,
    } as RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: MushiInternalRequestKind })
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(delay)
      return sendWithRetry(item, ctx, attempt + 1)
    }
    return res.ok
  } catch {
    if (attempt < 3) {
      await sleep(delay)
      return sendWithRetry(item, ctx, attempt + 1)
    }
    return false
  }
}

/** @internal Exported for unit tests — assert offline flush sends full SDK headers. */
export function buildOfflineFlushHeaders(ctx: SendContext): Record<string, string> {
  return buildSdkIngestHeaders({
    apiKey: ctx.apiKey,
    projectId: ctx.projectId,
    sdkPackage: ctx.sdkPackage,
    sdkVersion: ctx.sdkVersion,
    userToken: ctx.getUserToken?.() ?? null,
    internalKind: 'report-submit',
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
