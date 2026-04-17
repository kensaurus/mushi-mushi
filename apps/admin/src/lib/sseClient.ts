/**
 * FILE: apps/admin/src/lib/sseClient.ts
 * PURPOSE: Bearer-authenticated SSE client (V5.3 §2.10, M8).
 *
 * The native EventSource cannot send Authorization headers, which forces apps
 * to either expose tokens in URLs (insecure) or use cookie auth (CSRF-prone).
 * This helper uses fetch() + ReadableStream so we can send Bearer tokens and
 * abort on unmount cleanly.
 *
 * Parsing follows the SSE spec (https://html.spec.whatwg.org/multipage/server-sent-events.html):
 *   - lines beginning with ':' are comments and ignored
 *   - lines are split on \n / \r\n / \r
 *   - blank line dispatches the buffered event
 *   - data lines are concatenated with '\n'
 */

export interface SseEvent {
  event: string
  data: string
  id?: string
}

export interface SseClientOptions {
  url: string
  bearer?: string
  signal?: AbortSignal
  /** Called for every well-formed event. */
  onEvent: (e: SseEvent) => void
  /**
   * Called exactly once when the stream is closed (server end, network drop,
   * abort, HTTP error). This is the single closure notification — the
   * returned promise always resolves; it never rejects for stream lifecycle
   * events. Callers MUST handle reconnection / fallback inside this callback,
   * not in a `try/catch` around the awaited call.
   */
  onClose?: (reason: 'end' | 'error' | 'abort', err?: unknown) => void
}

const MAX_LINE_BYTES = 64 * 1024

export async function openSseStream(opts: SseClientOptions): Promise<void> {
  // The entire stream lifecycle — including the initial fetch — must live
  // inside the try so any failure (DNS, TLS, abort-before-headers, HTTP
  // error, mid-stream read error) is funneled through the single `onClose`
  // notification documented on `SseClientOptions.onClose`. Letting `fetch`
  // throw outside the try would reject the returned promise, contradicting
  // the JSDoc contract and forcing every caller to wrap the await in its
  // own try/catch.
  try {
    const res = await fetch(opts.url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
      },
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      opts.onClose?.('error', new Error(`SSE HTTP ${res.status}`))
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let buffer = ''
    let event = 'message'
    let id: string | undefined
    let dataLines: string[] = []

    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        opts.onClose?.('end')
        return
      }
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_LINE_BYTES * 16) {
        // defensive: the server is misbehaving — close instead of OOM
        await reader.cancel()
        opts.onClose?.('error', new Error('SSE buffer overflow'))
        return
      }

      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            opts.onEvent({ event, data: dataLines.join('\n'), id })
          }
          event = 'message'
          id = undefined
          dataLines = []
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'event') event = value
        else if (field === 'id') id = value
        else if (field === 'data') dataLines.push(value)
        // ignore retry, unknown fields per spec
      }
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      opts.onClose?.('abort')
      return
    }
    // `onClose` is the single closure notification per the public contract
    // (see `SseClientOptions.onClose`). Returning instead of re-throwing
    // prevents callers from receiving the same error via two channels —
    // which previously caused dispatchFix to start two parallel polling
    // loops for the same dispatchId.
    opts.onClose?.('error', err)
  }
}
