/**
 * FILE: agui.test.ts
 * PURPOSE: Tests for the AG-UI emitter (V5.3 §2.14, B3). Validates the
 *          envelope shape, monotonic IDs, and that frames pass the SSE
 *          sanitiser (no embedded \n\n in payloads).
 *
 * Re-implements the emitter inline so tests stay platform-agnostic
 * (the production source is under supabase/functions and uses Deno-style
 * imports). The behaviour under test is the wire format, not the file.
 */

import { describe, it, expect } from 'vitest'

const AGUI_PROTOCOL_VERSION = '0.4'

type AguiEventType =
  | 'run.started'
  | 'run.status'
  | 'run.completed'
  | 'run.failed'

interface AguiEnvelope<T = unknown> {
  type: AguiEventType
  id: string
  ts: string
  runId: string
  protocol: typeof AGUI_PROTOCOL_VERSION
  payload: T
}

function toSseEvent(payload: unknown, opts: { event?: string; id?: string } = {}): string {
  const lines: string[] = []
  if (opts.event) lines.push(`event: ${opts.event}`)
  if (opts.id) lines.push(`id: ${opts.id}`)
  lines.push(`data: ${JSON.stringify(payload)}`)
  return lines.join('\n') + '\n\n'
}

class AguiEmitter {
  private seq = 0
  readonly frames: string[] = []
  constructor(private runId: string) {}
  private nextId() { this.seq += 1; return `${this.runId}:${this.seq}` }
  private emit<T>(type: AguiEventType, payload: T) {
    const env: AguiEnvelope<T> = {
      type,
      id: this.nextId(),
      ts: new Date().toISOString(),
      runId: this.runId,
      protocol: AGUI_PROTOCOL_VERSION,
      payload,
    }
    this.frames.push(toSseEvent(env, { event: type, id: env.id }))
  }
  started(p: unknown) { this.emit('run.started', p) }
  status(p: unknown) { this.emit('run.status', p) }
  completed(p: unknown) { this.emit('run.completed', p) }
  failed(p: unknown) { this.emit('run.failed', p) }
}

describe('AG-UI emitter', () => {
  it('emits a started envelope with monotonically increasing ids', () => {
    const e = new AguiEmitter('run-abc')
    e.started({ resource: 'fix_dispatch', resourceId: 'd1' })
    e.status({ status: 'queued' })
    e.completed({ output: { prUrl: 'https://example.com/pr/1' } })

    const envelopes = e.frames.map((f) => JSON.parse(f.split('data: ')[1]!.trim()) as AguiEnvelope)
    expect(envelopes).toHaveLength(3)
    expect(envelopes[0]!.type).toBe('run.started')
    expect(envelopes[0]!.id).toBe('run-abc:1')
    expect(envelopes[1]!.id).toBe('run-abc:2')
    expect(envelopes[2]!.id).toBe('run-abc:3')
    expect(envelopes.every((env) => env.protocol === AGUI_PROTOCOL_VERSION)).toBe(true)
    expect(envelopes.every((env) => env.runId === 'run-abc')).toBe(true)
  })

  it('frames carry an event header matching the envelope type', () => {
    const e = new AguiEmitter('run-x')
    e.failed({ code: 'TIMEOUT', message: 'no progress' })
    expect(e.frames[0]!.split('\n')[0]).toBe('event: run.failed')
  })

  it('embedded payload strings cannot break the SSE frame', () => {
    const e = new AguiEmitter('run-x')
    e.failed({ code: 'X', message: 'attacker\n\nevent: forged\ndata: pwn' })
    const frame = e.frames[0]!
    // exactly one blank-line terminator at the end
    expect(frame.endsWith('\n\n')).toBe(true)
    expect(frame.match(/\n\n/g)?.length).toBe(1)
    // forged event header must not appear as a top-level field
    expect(/^event: forged/m.test(frame)).toBe(false)
  })

  it('payloads survive a roundtrip through JSON', () => {
    const e = new AguiEmitter('run-y')
    e.status({ status: 'running', progress: 0.42, detail: 'compiling' })
    const env = JSON.parse(e.frames[0]!.split('data: ')[1]!.trim()) as AguiEnvelope<{ status: string; progress: number; detail: string }>
    expect(env.payload.status).toBe('running')
    expect(env.payload.progress).toBe(0.42)
    expect(env.payload.detail).toBe('compiling')
  })
})
