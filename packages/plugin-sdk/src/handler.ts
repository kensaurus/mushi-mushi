/**
 * Framework-agnostic plugin handler.
 *
 * Plugin authors register one async function per event name (or a generic
 * `'*'` handler). The runtime takes care of HMAC verification, replay
 * protection (delivery-ID dedup), JSON parsing, and structured error
 * responses. Handlers run with a 25 s default timeout to keep the Mushi
 * dispatcher healthy.
 */

import { verifySignature } from './sign.js'
import type { MushiEventEnvelope, MushiEventName } from './types.js'

export interface PluginHandlerConfig {
  /** Shared secret with the Mushi platform. NEVER log this. */
  secret: string
  /** Per-event handlers; `'*'` matches anything not explicitly listed. */
  on: Partial<Record<MushiEventName | '*', (e: MushiEventEnvelope) => Promise<void> | void>>
  /** Optional dedup store (in-memory by default). */
  dedupStore?: DedupStore
  /** Hard ceiling per handler invocation. */
  timeoutMs?: number
  /** Optional logger; defaults to a console-based no-op-friendly logger. */
  logger?: PluginLogger
}

export interface DedupStore {
  has(deliveryId: string): Promise<boolean> | boolean
  remember(deliveryId: string): Promise<void> | void
}

export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}

export interface HandlePluginRequestInput {
  rawBody: string
  headers: Record<string, string | undefined>
}

export interface HandlePluginResult {
  status: number
  body: { ok: boolean; error?: { code: string; message?: string } }
}

const DEFAULT_TIMEOUT_MS = 25_000

export function createPluginHandler(config: PluginHandlerConfig) {
  const dedup = config.dedupStore ?? createInMemoryDedupStore()
  const log = config.logger ?? consoleLogger
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async function handle(input: HandlePluginRequestInput): Promise<HandlePluginResult> {
    const sigHeader = pickHeader(input.headers, 'x-mushi-signature')
    const verification = verifySignature({ rawBody: input.rawBody, header: sigHeader, secret: config.secret })
    if (!verification.ok) {
      log.warn('Signature verification failed', { reason: verification.reason })
      return reject(401, 'BAD_SIGNATURE', verification.reason)
    }

    let envelope: MushiEventEnvelope
    try {
      envelope = JSON.parse(input.rawBody) as MushiEventEnvelope
    } catch {
      return reject(400, 'INVALID_JSON')
    }
    if (!envelope || typeof envelope !== 'object' || !envelope.event || !envelope.deliveryId) {
      return reject(400, 'INVALID_ENVELOPE')
    }

    if (await dedup.has(envelope.deliveryId)) {
      log.info('Duplicate delivery; acking without re-running handler', { deliveryId: envelope.deliveryId })
      return { status: 200, body: { ok: true } }
    }

    const handler = config.on[envelope.event as MushiEventName] ?? config.on['*']
    if (!handler) {
      log.info('No handler registered for event; acking', { event: envelope.event })
      return { status: 200, body: { ok: true } }
    }

    try {
      await runWithTimeout(() => Promise.resolve(handler(envelope)), timeoutMs)
      await dedup.remember(envelope.deliveryId)
      return { status: 200, body: { ok: true } }
    } catch (err) {
      log.error('Plugin handler threw', { event: envelope.event, deliveryId: envelope.deliveryId, err: String(err) })
      return reject(500, 'HANDLER_ERROR', err instanceof Error ? err.message : String(err))
    }
  }
}

function reject(status: number, code: string, message?: string): HandlePluginResult {
  return { status, body: { ok: false, error: { code, ...(message ? { message } : {}) } } }
}

function pickHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Handler timed out after ${ms} ms`)), ms)
    fn().then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function createInMemoryDedupStore(maxEntries = 5000): DedupStore {
  const seen = new Set<string>()
  const order: string[] = []
  return {
    has(id: string) {
      return seen.has(id)
    },
    remember(id: string) {
      if (seen.has(id)) return
      seen.add(id)
      order.push(id)
      if (order.length > maxEntries) {
        const evict = order.shift()
        if (evict) seen.delete(evict)
      }
    },
  }
}

const consoleLogger: PluginLogger = {
  info: (msg, meta) => console.log(`[mushi-plugin] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[mushi-plugin] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[mushi-plugin] ${msg}`, meta ?? ''),
}
