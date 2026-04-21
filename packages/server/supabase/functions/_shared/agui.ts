/**
 * FILE: packages/server/supabase/functions/_shared/agui.ts
 * PURPOSE: AG-UI (Agent-User Interaction) protocol envelopes layered over SSE.
 * V5.3 §2.14, B3.
 *
 * BACKGROUND:
 *   The bare SSE format we shipped in V5.3.1 just sends `data: {status, prUrl}`
 *   and lets the client guess what each frame means. AG-UI standardises this:
 *   every event has a `type`, a monotonically-increasing `id`, a `runId`, and
 *   a typed payload, so any AG-UI-compliant frontend can render the agent run
 *   without bespoke code.
 *
 *   We implement a small, dependency-free subset of the public AG-UI schema
 *   (https://docs.ag-ui.com/) that covers the events we actually emit today:
 *
 *     - run.started        — once at connect
 *     - run.status         — periodic status updates (queued/running/etc.)
 *     - run.tool_call      — when a tool/agent is invoked
 *     - run.message        — human-readable progress text
 *     - run.text_delta     — incremental token / log streaming
 *     - run.completed      — terminal success
 *     - run.failed         — terminal failure
 *     - run.heartbeat      — keep-alive (also emitted as SSE comment)
 *
 *   Frames are written through the existing SSE sanitiser so CVE-2026-29085
 *   protection still applies.
 */

import { toSseEvent } from './sse.ts'

export const AGUI_PROTOCOL_VERSION = '0.4'

export type AguiEventType =
  | 'run.started'
  | 'run.status'
  | 'run.tool_call'
  | 'run.message'
  | 'run.text_delta'
  | 'run.completed'
  | 'run.failed'
  | 'run.heartbeat'

export interface AguiEnvelope<T = unknown> {
  type: AguiEventType
  id: string
  ts: string
  runId: string
  protocol: typeof AGUI_PROTOCOL_VERSION
  payload: T
}

export interface AguiRunStartedPayload {
  resource: string
  resourceId: string
  attributes?: Record<string, string | number | boolean | null>
}

export interface AguiRunStatusPayload {
  status: string
  detail?: string
  progress?: number
}

export interface AguiToolCallPayload {
  toolName: string
  args?: Record<string, unknown>
  result?: unknown
  error?: string
}

export interface AguiMessagePayload {
  role: 'system' | 'agent' | 'tool'
  text: string
}

export interface AguiTextDeltaPayload {
  delta: string
  channel?: 'log' | 'reasoning' | 'output'
}

export interface AguiCompletedPayload {
  output?: unknown
  durationMs?: number
}

export interface AguiFailedPayload {
  code: string
  message: string
  retryable?: boolean
}

export class AguiEmitter {
  private seq = 0
  private readonly runId: string
  private readonly write: (frame: string) => Promise<void> | void

  constructor(opts: { runId: string; write: (frame: string) => Promise<void> | void }) {
    this.runId = opts.runId
    this.write = opts.write
  }

  private nextId(): string {
    this.seq += 1
    return `${this.runId}:${this.seq}`
  }

  private async emit<T>(type: AguiEventType, payload: T): Promise<void> {
    const env: AguiEnvelope<T> = {
      type,
      id: this.nextId(),
      ts: new Date().toISOString(),
      runId: this.runId,
      protocol: AGUI_PROTOCOL_VERSION,
      payload,
    }
    const frame = toSseEvent(env, { event: type, id: env.id })
    await this.write(frame)
  }

  started(payload: AguiRunStartedPayload): Promise<void> {
    return this.emit('run.started', payload)
  }

  status(payload: AguiRunStatusPayload): Promise<void> {
    return this.emit('run.status', payload)
  }

  toolCall(payload: AguiToolCallPayload): Promise<void> {
    return this.emit('run.tool_call', payload)
  }

  message(payload: AguiMessagePayload): Promise<void> {
    return this.emit('run.message', payload)
  }

  textDelta(payload: AguiTextDeltaPayload): Promise<void> {
    return this.emit('run.text_delta', payload)
  }

  completed(payload: AguiCompletedPayload): Promise<void> {
    return this.emit('run.completed', payload)
  }

  failed(payload: AguiFailedPayload): Promise<void> {
    return this.emit('run.failed', payload)
  }

  async heartbeat(): Promise<void> {
    await this.write(`: agui-heartbeat ${Date.now()}\n\n`)
  }
}

/**
 * Validate an envelope coming back from a client (e.g. cancel signal).
 * Throws on schema violation. Used by routers that accept AG-UI control frames.
 */
export function assertAguiEnvelope(value: unknown): asserts value is AguiEnvelope {
  if (!value || typeof value !== 'object') throw new Error('AGUI: envelope must be object')
  const v = value as Partial<AguiEnvelope>
  if (typeof v.type !== 'string' || !v.type.startsWith('run.')) throw new Error('AGUI: invalid type')
  if (typeof v.id !== 'string') throw new Error('AGUI: missing id')
  if (typeof v.runId !== 'string') throw new Error('AGUI: missing runId')
  if (v.protocol !== AGUI_PROTOCOL_VERSION) throw new Error(`AGUI: unsupported protocol ${v.protocol}`)
}
