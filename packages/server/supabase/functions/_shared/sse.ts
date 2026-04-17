/**
 * FILE: packages/server/supabase/functions/_shared/sse.ts
 * PURPOSE: Server-side helpers for Server-Sent Events (SSE) emission with
 *          CVE-2026-29085 sanitization (V5.3 §2.10, M8).
 *
 * BACKGROUND:
 *   CVE-2026-29085 covers SSE injection: when untrusted strings are written
 *   into a `data:` field without escaping, an attacker can embed `\n\n` to
 *   close the current event and forge their own event/id/retry frames. This
 *   lets a low-privilege user push fake admin events to other clients sharing
 *   the same stream, or break out of the channel by injecting "event: logout".
 *
 *   The fix is twofold:
 *     1. Always JSON-encode payloads before placing them in `data:` (so any
 *        \n becomes \\n) — see {@link toSseDataLine}.
 *     2. If a raw string MUST be emitted, prefix every newline with another
 *        `data:` so the wire format never contains a blank line — see
 *        {@link sanitizeSseString}.
 *
 *   The SSE spec defines a "blank line" (\n\n or \r\n\r\n) as the event
 *   delimiter; our sanitizer enforces that no caller can ever produce one
 *   in the middle of a payload.
 */

const FORBIDDEN_FIELD_PREFIXES = ['event:', 'id:', 'retry:', 'data:']

/**
 * Render an arbitrary value as a single SSE event with `data: <json>\n\n`.
 * This is the safe path: JSON.stringify guarantees no raw \n leaks.
 */
export function toSseEvent(payload: unknown, opts: { event?: string; id?: string } = {}): string {
  const lines: string[] = []
  if (opts.event) lines.push(`event: ${assertSingleLine(opts.event)}`)
  if (opts.id) lines.push(`id: ${assertSingleLine(opts.id)}`)
  const json = JSON.stringify(payload)
  // JSON.stringify cannot emit a literal \n inside a string; safe to use a single data: line.
  lines.push(`data: ${json}`)
  return lines.join('\n') + '\n\n'
}

/**
 * Sanitize a free-form string so it can be embedded in a `data:` field.
 * Splits on any newline and prefixes every continuation line with `data: `,
 * so the consumer reassembles the original text. Drops any line whose first
 * non-whitespace token would be interpreted as a privileged SSE field.
 */
export function sanitizeSseString(input: string): string {
  if (typeof input !== 'string') input = String(input)
  const lines = input.split(/\r\n|\r|\n/)
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    if (FORBIDDEN_FIELD_PREFIXES.some(p => line.toLowerCase().startsWith(p))) {
      // Defensive: prefix an extra space so the SSE parser treats it as data.
      out.push(`data:  ${line}`)
    } else {
      out.push(`data: ${line}`)
    }
  }
  return out.join('\n') + '\n\n'
}

/**
 * Convenience: emit a comment frame (heartbeat) — comments start with `:`.
 * Useful to keep load balancers from closing idle connections.
 */
export function sseHeartbeat(): string {
  return `: heartbeat ${Date.now()}\n\n`
}

function assertSingleLine(s: string): string {
  if (/[\r\n]/.test(s)) {
    throw new Error('SSE field value must not contain CR/LF')
  }
  return s
}

/**
 * Pick safe headers for a streaming response. The X-Accel-Buffering hint
 * is required behind nginx and Supabase's edge proxy to disable buffering.
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const
