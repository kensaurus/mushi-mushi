import { log } from './logger.ts'

const traceLog = log.child('trace')

interface TraceMetadata {
  reportId?: string
  projectId?: string
  [key: string]: unknown
}

interface SpanData {
  model?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  statusCode?: number
  error?: string
  [key: string]: unknown
}

interface Span {
  end(data?: SpanData): void
}

interface Trace {
  id: string
  span(name: string): Span
  score(name: string, value: number, comment?: string): Promise<void>
  end(): Promise<void>
}

function getLangfuseConfig() {
  return {
    secretKey: Deno.env.get('LANGFUSE_SECRET_KEY'),
    publicKey: Deno.env.get('LANGFUSE_PUBLIC_KEY'),
    baseUrl: Deno.env.get('LANGFUSE_BASE_URL') ?? 'https://cloud.langfuse.com',
  }
}

function isConfigured(): boolean {
  const { secretKey, publicKey } = getLangfuseConfig()
  return !!(secretKey && publicKey)
}

async function langfuseApi(path: string, body: Record<string, unknown>): Promise<void> {
  const { secretKey, publicKey, baseUrl } = getLangfuseConfig()
  if (!secretKey || !publicKey) return

  try {
    const auth = btoa(`${publicKey}:${secretKey}`)
    await fetch(`${baseUrl}/api/public${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    traceLog.warn('Langfuse API error', { path, err: String(err) })
  }
}

export function createTrace(name: string, metadata?: TraceMetadata): Trace {
  const traceId = crypto.randomUUID()
  const startTime = new Date().toISOString()

  if (isConfigured()) {
    langfuseApi('/ingestion', {
      batch: [{
        id: crypto.randomUUID(),
        type: 'trace-create',
        timestamp: startTime,
        body: {
          id: traceId,
          name,
          metadata,
          timestamp: startTime,
        },
      }],
    }).catch(() => {})
  }

  function span(spanName: string): Span {
    const spanId = crypto.randomUUID()
    const spanStart = Date.now()

    return {
      end(data?: SpanData) {
        const spanEnd = Date.now()
        const duration = spanEnd - spanStart

        if (isConfigured()) {
          const events: Record<string, unknown>[] = [{
            id: crypto.randomUUID(),
            type: 'span-create',
            timestamp: new Date().toISOString(),
            body: {
              id: spanId,
              traceId,
              name: spanName,
              startTime: new Date(spanStart).toISOString(),
              endTime: new Date(spanEnd).toISOString(),
              metadata: {
                ...data,
                durationMs: duration,
              },
              level: data?.error ? 'ERROR' : 'DEFAULT',
              statusMessage: data?.error,
            },
          }]

          if (data?.model) {
            events.push({
              id: crypto.randomUUID(),
              type: 'generation-create',
              timestamp: new Date().toISOString(),
              body: {
                id: crypto.randomUUID(),
                traceId,
                parentObservationId: spanId,
                name: spanName,
                model: data.model,
                startTime: new Date(spanStart).toISOString(),
                endTime: new Date(spanEnd).toISOString(),
                usage: {
                  input: data.inputTokens,
                  output: data.outputTokens,
                },
                metadata: { latencyMs: data.latencyMs ?? duration },
                level: data.error ? 'ERROR' : 'DEFAULT',
              },
            })
          }

          langfuseApi('/ingestion', { batch: events }).catch(() => {})
        }

        traceLog.info('Span completed', {
          trace: name,
          span: spanName,
          durationMs: duration,
          ...(data?.model ? { model: data.model } : {}),
          ...(data?.error ? { error: data.error } : {}),
        })
      },
    }
  }

  async function score(scoreName: string, value: number, comment?: string): Promise<void> {
    if (isConfigured()) {
      await langfuseApi('/ingestion', {
        batch: [{
          id: crypto.randomUUID(),
          type: 'score-create',
          timestamp: new Date().toISOString(),
          body: {
            traceId,
            name: scoreName,
            value,
            comment,
          },
        }],
      })
    }
  }

  async function end(): Promise<void> {
    if (isConfigured()) {
      await langfuseApi('/ingestion', {
        batch: [{
          id: crypto.randomUUID(),
          type: 'trace-create',
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            metadata: { ...metadata, completedAt: new Date().toISOString() },
          },
        }],
      })
    }
  }

  return { id: traceId, span, score, end }
}
