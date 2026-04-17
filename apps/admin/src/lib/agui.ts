/**
 * FILE: apps/admin/src/lib/agui.ts
 * PURPOSE: Client-side AG-UI envelope parser. V5.3 §2.14, B3.
 *
 * The admin SSE endpoint emits AG-UI-protocol events (`run.started`,
 * `run.status`, `run.completed`, `run.failed`, …) alongside legacy
 * `event: status` / `event: done` / `event: error` frames for
 * back-compat. This helper normalises them into a single typed callback so
 * pages can subscribe once and let the helper handle protocol coexistence.
 */

import type { SseEvent } from './sseClient'

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

export type AguiHandler = (env: AguiEnvelope) => void

const AGUI_TYPES = new Set<AguiEventType>([
  'run.started',
  'run.status',
  'run.tool_call',
  'run.message',
  'run.text_delta',
  'run.completed',
  'run.failed',
  'run.heartbeat',
])

export function parseAguiEvent(e: SseEvent): AguiEnvelope | null {
  if (!AGUI_TYPES.has(e.event as AguiEventType)) return null
  try {
    const env = JSON.parse(e.data) as AguiEnvelope
    if (env.protocol !== AGUI_PROTOCOL_VERSION) return null
    return env
  } catch {
    return null
  }
}

/**
 * Wrap an `onEvent` callback so AG-UI envelopes are dispatched to `onAgui`,
 * and any non-AG-UI frames fall through to `onLegacy`.
 */
export function withAguiHandler(
  onAgui: AguiHandler,
  onLegacy: (e: SseEvent) => void,
): (e: SseEvent) => void {
  return (e) => {
    const env = parseAguiEvent(e)
    if (env) onAgui(env)
    else onLegacy(e)
  }
}
