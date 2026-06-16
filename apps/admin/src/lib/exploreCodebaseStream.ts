/**
 * SSE consumer for POST /v1/admin/projects/:id/codebase/chat/stream
 */

import { apiFetchRaw } from './supabase'
import type { CodebaseCitation } from '../components/explore/exploreUnderstandTypes'

export interface CodebaseChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CodebaseChatSendBody {
  threadId?: string
  messages: CodebaseChatMessage[]
  fileFocus?: { file_path: string; symbol_name?: string | null }
}

export interface CodebaseChatStreamHandlers {
  onStart?: (info: { threadId: string; model: string }) => void
  onDelta: (delta: string) => void
  onMeta: (meta: {
    threadId: string
    model: string
    citations: CodebaseCitation[]
    latencyMs?: number
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
  }) => void
  onDone: () => void
  onError: (err: { code: string; message: string }) => void
}

export interface CodebaseChatStreamHandle {
  cancel: () => void
}

export async function openCodebaseChatStream(
  projectId: string,
  body: CodebaseChatSendBody,
  handlers: CodebaseChatStreamHandlers,
): Promise<CodebaseChatStreamHandle> {
  const ctrl = new AbortController()
  const handle: CodebaseChatStreamHandle = { cancel: () => ctrl.abort() }
  let closed = false

  void (async () => {
    try {
      const res = await apiFetchRaw(`/v1/admin/projects/${projectId}/codebase/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        let code = `HTTP_${res.status}`
        let message = `Stream HTTP ${res.status}`
        try {
          const json = (await res.json()) as { error?: { code?: string; message?: string } }
          if (json.error?.code) code = json.error.code
          if (json.error?.message) message = json.error.message
        } catch {
          /* non-json error body */
        }
        if (!closed) {
          closed = true
          handlers.onError({ code, message })
        }
        return
      }

      if (!res.body) {
        if (!closed) {
          closed = true
          handlers.onError({ code: 'STREAM_EMPTY', message: 'No response body' })
        }
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: false })
      let buffer = ''
      let event = 'message'
      let dataLines: string[] = []
      let sawAnything = false

      const dispatch = () => {
        if (dataLines.length === 0) return
        const data = dataLines.join('\n')
        sawAnything = true
        try {
          const parsed = JSON.parse(data)
          if (event === 'start') handlers.onStart?.(parsed)
          else if (event === 'delta') handlers.onDelta(parsed.delta ?? '')
          else if (event === 'meta') handlers.onMeta(parsed)
          else if (event === 'done') {
            if (!closed) {
              closed = true
              handlers.onDone()
            }
          } else if (event === 'error') {
            if (!closed) {
              closed = true
              handlers.onError({
                code: parsed.code ?? 'STREAM_ERROR',
                message: parsed.message ?? 'Stream error',
              })
            }
          }
        } catch {
          /* ignore malformed payloads */
        }
        event = 'message'
        dataLines = []
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          if (closed) return
          closed = true
          if (sawAnything) handlers.onDone()
          else handlers.onError({ code: 'STREAM_EMPTY', message: 'Stream ended before any event' })
          return
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r\n|\r|\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line === '') {
            dispatch()
            continue
          }
          if (line.startsWith(':')) continue
          const colon = line.indexOf(':')
          const field = colon === -1 ? line : line.slice(0, colon)
          let v = colon === -1 ? '' : line.slice(colon + 1)
          if (v.startsWith(' ')) v = v.slice(1)
          if (field === 'event') event = v
          else if (field === 'data') dataLines.push(v)
        }
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      if (closed) return
      closed = true
      handlers.onError({
        code: 'STREAM_NETWORK',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })()

  return handle
}
