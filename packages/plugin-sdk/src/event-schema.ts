/**
 * Wave G3 — narrowly-typed event schemas for compile-time validation.
 *
 * Existing `types.ts` defines the event envelope. This file adds runtime
 * validators so plugin devs can `parseEvent(rawJson)` and get either a
 * typed envelope or a descriptive error. We keep the shape permissive
 * (extra fields pass through) because the server is free to add fields in
 * minor releases — a strict schema would break older plugins on every
 * server upgrade.
 */

import type { MushiEventEnvelope, MushiEventName } from './types.js'

export type ParseResult<T> =
  | { ok: true; envelope: T }
  | { ok: false; reason: string }

const KNOWN_EVENTS = new Set<MushiEventName>([
  'report.created',
  'report.classified',
  'report.status_changed',
  'report.commented',
  'report.dedup_grouped',
  'fix.proposed',
  'fix.applied',
  'fix.failed',
  'judge.score_recorded',
  'sla.breached',
])

export function isKnownEvent(name: string): name is MushiEventName {
  return KNOWN_EVENTS.has(name as MushiEventName)
}

export function parseEvent(raw: string | unknown): ParseResult<MushiEventEnvelope> {
  let obj: unknown
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return { ok: false, reason: 'invalid_json' } }
  } else {
    obj = raw
  }
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'not_an_object' }
  const env = obj as Partial<MushiEventEnvelope>
  if (typeof env.event !== 'string') return { ok: false, reason: 'missing_event_name' }
  if (typeof env.deliveryId !== 'string') return { ok: false, reason: 'missing_delivery_id' }
  if (typeof env.occurredAt !== 'string') return { ok: false, reason: 'missing_occurred_at' }
  if (typeof env.projectId !== 'string') return { ok: false, reason: 'missing_project_id' }
  if (typeof env.pluginSlug !== 'string') return { ok: false, reason: 'missing_plugin_slug' }
  if (env.data === undefined || env.data === null) return { ok: false, reason: 'missing_data' }
  return { ok: true, envelope: env as MushiEventEnvelope }
}
