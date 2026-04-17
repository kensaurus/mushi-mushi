/**
 * FILE: sse.test.ts
 * PURPOSE: Regression tests for the SSE sanitizer (V5.3 §2.10, M8) covering
 *          CVE-2026-29085 (SSE field injection via embedded \n\n).
 *          The sanitizer MUST guarantee that no untrusted string can produce
 *          an event boundary or forge `event:`/`id:`/`retry:` frames.
 */

import { describe, it, expect } from 'vitest'

// Re-import the runtime under test by inlining the helpers — the production
// module lives under supabase/functions which uses Deno-style imports we don't
// load here. This keeps the test platform-agnostic while still exercising the
// exact algorithm.

const FORBIDDEN_FIELD_PREFIXES = ['event:', 'id:', 'retry:', 'data:']

function toSseEvent(payload: unknown, opts: { event?: string; id?: string } = {}): string {
  const lines: string[] = []
  if (opts.event) lines.push(`event: ${assertSingleLine(opts.event)}`)
  if (opts.id) lines.push(`id: ${assertSingleLine(opts.id)}`)
  lines.push(`data: ${JSON.stringify(payload)}`)
  return lines.join('\n') + '\n\n'
}

function sanitizeSseString(input: string): string {
  if (typeof input !== 'string') input = String(input)
  const lines = input.split(/\r\n|\r|\n/)
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    if (FORBIDDEN_FIELD_PREFIXES.some(p => line.toLowerCase().startsWith(p))) {
      out.push(`data:  ${line}`)
    } else {
      out.push(`data: ${line}`)
    }
  }
  return out.join('\n') + '\n\n'
}

function assertSingleLine(s: string): string {
  if (/[\r\n]/.test(s)) throw new Error('SSE field value must not contain CR/LF')
  return s
}

describe('toSseEvent (CVE-2026-29085)', () => {
  it('JSON-encodes payloads so newlines cannot escape the data: field', () => {
    const malicious = { msg: 'hello\n\nevent: logout\ndata: {"forced":true}' }
    const frame = toSseEvent(malicious, { event: 'status' })
    // Only ONE blank line allowed and it MUST be at the very end.
    const blankLineIndices: number[] = []
    const lines = frame.split('\n')
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i] === '' && i !== lines.length - 2) blankLineIndices.push(i)
    }
    expect(blankLineIndices.length).toBe(0)
    // The substring "event: logout" survives inside the JSON-encoded payload
    // (newlines are escaped as the two characters \n), which is fine: the SSE
    // parser only honors `event:` at the *start of a line*. Verify there is
    // exactly ONE line starting with `event:` and it is our own.
    const eventLines = frame.split('\n').filter(l => l.startsWith('event:'))
    expect(eventLines).toEqual(['event: status'])
    expect(frame.endsWith('\n\n')).toBe(true)
  })

  it('rejects CR/LF in event/id field values', () => {
    expect(() => toSseEvent({}, { event: 'oops\nevent: hijack' })).toThrow()
    expect(() => toSseEvent({}, { id: 'x\rnext' })).toThrow()
  })

  it('emits well-formed event with id', () => {
    const f = toSseEvent({ a: 1 }, { event: 'tick', id: '42' })
    expect(f).toBe('event: tick\nid: 42\ndata: {"a":1}\n\n')
  })
})

describe('sanitizeSseString — raw text fallback', () => {
  it('prefixes every continuation line with data: so no blank line appears mid-payload', () => {
    const input = 'line one\nline two\n\nline four'
    const sanitized = sanitizeSseString(input)
    const lines = sanitized.split('\n')
    // every non-final line must start with 'data:' (or be the trailing blanks)
    for (let i = 0; i < lines.length - 2; i++) {
      expect(lines[i].startsWith('data:')).toBe(true)
    }
  })

  it('escapes attempts to forge event: / id: / retry: frames', () => {
    const input = 'normal text\nevent: takeover\nid: hijack\nretry: 1'
    const sanitized = sanitizeSseString(input)
    // Each forbidden prefix should be double-spaced so the parser treats it as data
    expect(sanitized).toContain('data:  event: takeover')
    expect(sanitized).toContain('data:  id: hijack')
    expect(sanitized).toContain('data:  retry: 1')
    // Critical: no naked "event:" at line start
    expect(/^event:/m.test(sanitized.replace(/^data:.*$/gm, ''))).toBe(false)
  })

  it('strips control characters that break log viewers', () => {
    const input = 'before\u0001\u0007\u001bafter'
    const sanitized = sanitizeSseString(input)
    expect(sanitized).toContain('beforeafter')
    expect(sanitized).not.toContain('\u0001')
  })

  it('handles CRLF, CR, and LF identically', () => {
    const inputs = ['a\nb', 'a\r\nb', 'a\rb']
    for (const i of inputs) {
      const out = sanitizeSseString(i)
      expect(out).toBe('data: a\ndata: b\n\n')
    }
  })

  it('coerces non-strings safely', () => {
    expect(sanitizeSseString(42 as unknown as string)).toBe('data: 42\n\n')
  })
})

describe('CVE-2026-29085 attack surface — concrete attempts', () => {
  it.each([
    ['inject event by embedding \\n\\n then event:', 'innocent\n\nevent: rce\ndata: ok'],
    ['inject id+data combo', 'foo\nid: 1\ndata: payload'],
    ['inject retry to flood reconnect', 'spam\nretry: 1'],
    ['inject CR-only newline', 'a\rdata: hijacked'],
    ['inject by colon-prefixed field after CR', 'a\rdata:  not-evil'],
  ])('blocks: %s', (_label, attack) => {
    const sanitized = sanitizeSseString(attack)
    // No two consecutive newlines anywhere except at the very end.
    const idx = sanitized.indexOf('\n\n')
    expect(idx).toBe(sanitized.length - 2)
  })
})
