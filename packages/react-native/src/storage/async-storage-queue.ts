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
    queue.push({ report: report as Record<string, unknown>, enqueuedAt: Date.now() })
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
      try {
        const res = await fetch(`${this.apiEndpoint}/v1/reports`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Mushi-Api-Key': this.apiKey,
          },
          body: JSON.stringify(item.report),
        })
        if (res.ok) {
          flushed++
        } else {
          remaining.push(item)
        }
      } catch {
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
