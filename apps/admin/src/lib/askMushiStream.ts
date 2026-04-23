/**
 * FILE: apps/admin/src/lib/askMushiStream.ts
 * PURPOSE: SSE consumer for `/v1/admin/ask-mushi/messages/stream`. Built
 *          on the existing `openSseStream` helper (same one fix-dispatch
 *          uses) so the auth + reconnect story stays identical.
 *
 *          Wire format from the backend:
 *            event: start  data: { threadId, model }
 *            event: delta  data: { delta: "..." }      (many)
 *            event: meta   data: { latencyMs, inputTokens, outputTokens,
 *                                  cacheReadTokens, cacheCreateTokens,
 *                                  costUsd, model, fallbackUsed }
 *            event: done   data: { done: true }
 *            event: error  data: { code, message }
 *
 *          Streaming is feature-flagged via VITE_MUSHI_ASK_STREAMING. When
 *          off (or when EventSource isn't reachable) the sidebar falls
 *          back to the non-stream POST endpoint, which keeps existing
 *          behaviour — UX is the same, only the typewriter effect drops.
 */

import { openSseStream } from './sseClient'
import { supabase } from './supabase'
import { RESOLVED_API_URL } from './env'
import type { AskMushiSendBody, AskMushiMessageMeta } from './askMushiTypes'

export interface AskMushiStreamHandlers {
  onStart?: (info: { threadId: string; model: string }) => void
  onDelta: (delta: string) => void
  onMeta: (meta: AskMushiMessageMeta & { threadId: string }) => void
  onDone: () => void
  onError: (err: { code: string; message: string }) => void
}

export function isAskMushiStreamingEnabled(): boolean {
  // Vite exposes string env vars; treat anything truthy as enabled.
  // Default ON when building locally so the dev loop touches the new
  // path; production builds can opt out via VITE_MUSHI_ASK_STREAMING=0.
  const raw = (import.meta.env.VITE_MUSHI_ASK_STREAMING ?? '1').toString().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes'
}

export interface AskMushiStreamHandle {
  /** Aborts the underlying fetch. Safe to call after the stream ended. */
  cancel: () => void
}

export async function openAskMushiStream(
  body: AskMushiSendBody,
  handlers: AskMushiStreamHandlers,
): Promise<AskMushiStreamHandle> {
  const { data: session } = await supabase.auth.getSession()
  const bearer = session.session?.access_token
  if (!bearer) {
    handlers.onError({ code: 'UNAUTHENTICATED', message: 'No session' })
    return { cancel: () => {} }
  }

  // We need to POST a JSON body with SSE response. `openSseStream` issues
  // GET only, so we go direct here — same Bearer + abort story, just
  // method=POST. Keep the plumbing tight to avoid forking sseClient.
  const ctrl = new AbortController()
  const handle: AskMushiStreamHandle = { cancel: () => ctrl.abort() }

  // Hoisted so the outer catch can guard against firing onError after a
  // terminal callback already ran (e.g. server sends `event: done`,
  // closes the socket, and a downstream read throws while unwinding).
  // Future side-effects in onDone (analytics, persistence, telemetry)
  // must never double-fire.
  let closed = false

  void (async () => {
    try {
      const res = await fetch(`${RESOLVED_API_URL}/v1/admin/ask-mushi/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        if (!closed) {
          closed = true
          handlers.onError({ code: 'HTTP_' + res.status, message: `Stream HTTP ${res.status}` })
        }
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: false })
      let buffer = ''
      let event = 'message'
      let dataLines: string[] = []
      // Track if we've ever seen an event, so a clean close mid-stream
      // can be downgraded to onDone instead of falling through silently.
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
              handlers.onError({ code: parsed.code ?? 'STREAM_ERROR', message: parsed.message ?? 'Stream error' })
            }
          }
        } catch {
          /* ignore malformed payloads — next event will hopefully be valid */
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

  // Suppress the "unused but assigned" lint if openSseStream changes shape.
  void openSseStream
  return handle
}
