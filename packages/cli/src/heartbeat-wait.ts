/**
 * Poll GET /v1/sync/ingest-setup until the SDK heartbeat (or first report)
 * lands — used by `mushi connect --wait` and CI smoke gates.
 */

export interface IngestSetupStep {
  id: string
  label: string
  complete: boolean
  required: boolean
  hint?: string
}

export interface IngestSetupPayload {
  ready: boolean
  required_complete: number
  required_total: number
  steps: IngestSetupStep[]
  diagnostic?: {
    last_sdk_seen_at: string | null
    last_sdk_endpoint_host: string | null
    admin_endpoint_host: string | null
  }
}

export interface HeartbeatWaitOptions {
  endpoint: string
  apiKey: string
  projectId?: string
  /** Max polls before giving up. Default 40 (= ~2 min at 3s interval). */
  maxAttempts?: number
  /** Ms between polls. Default 3000. */
  intervalMs?: number
  /** Called after each poll with the latest payload. */
  onPoll?: (payload: IngestSetupPayload, attempt: number) => void
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}

export interface HeartbeatWaitResult {
  ok: boolean
  payload: IngestSetupPayload | null
  attempts: number
  reason: 'ready' | 'heartbeat' | 'timeout' | 'aborted' | 'fetch-error' | 'unauthorized'
  error?: string
}

/** Non-retryable HTTP failure (bad key / wrong endpoint) — polling won't fix it. */
export class IngestSetupHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`ingest-setup HTTP ${status}`)
    this.name = 'IngestSetupHttpError'
    this.status = status
  }
}

const NON_RETRYABLE_STATUSES = new Set([401, 403, 404])

export async function fetchIngestSetup(
  config: { endpoint: string; apiKey: string; projectId?: string },
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<IngestSetupPayload | null> {
  // Validate the key is safe before embedding in HTTP headers (no newlines/CRLF).
  const safeKey = config.apiKey.replace(/[\r\n]/g, '')
  const res = await doFetch(`${config.endpoint}/v1/sync/ingest-setup`, {
    headers: {
      Authorization: `Bearer ${safeKey}`,
      'X-Mushi-Api-Key': safeKey,
      ...(config.projectId ? { 'X-Mushi-Project': config.projectId } : {}),
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    if (NON_RETRYABLE_STATUSES.has(res.status)) throw new IngestSetupHttpError(res.status)
    return null
  }
  const body = (await res.json()) as { ok?: boolean; data?: IngestSetupPayload }
  return body.ok && body.data ? body.data : null
}

export async function waitForIngestReady(
  options: HeartbeatWaitOptions,
): Promise<HeartbeatWaitResult> {
  const doFetch = options.fetch ?? globalThis.fetch
  const maxAttempts = options.maxAttempts ?? 40
  const intervalMs = options.intervalMs ?? 3000
  let lastPayload: IngestSetupPayload | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      return { ok: false, payload: lastPayload, attempts: attempt - 1, reason: 'aborted' }
    }

    try {
      lastPayload = await fetchIngestSetup(
        { endpoint: options.endpoint, apiKey: options.apiKey, projectId: options.projectId },
        doFetch,
      )
      if (lastPayload) {
        options.onPoll?.(lastPayload, attempt)
        if (lastPayload.ready) {
          return { ok: true, payload: lastPayload, attempts: attempt, reason: 'ready' }
        }
        const sdkStep = lastPayload.steps.find((s) => s.id === 'sdk_installed')
        if (sdkStep?.complete) {
          return { ok: true, payload: lastPayload, attempts: attempt, reason: 'heartbeat' }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof IngestSetupHttpError) {
        // Bad key / wrong endpoint — no amount of polling will fix this.
        return { ok: false, payload: lastPayload, attempts: attempt, reason: 'unauthorized', error: msg }
      }
      if (options.signal?.aborted) {
        return { ok: false, payload: lastPayload, attempts: attempt, reason: 'aborted', error: msg }
      }
      if (attempt === maxAttempts) {
        return { ok: false, payload: lastPayload, attempts: attempt, reason: 'fetch-error', error: msg }
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }

  return { ok: false, payload: lastPayload, attempts: maxAttempts, reason: 'timeout' }
}
