/**
 * FILE: _shared/reporter-settings.ts
 * PURPOSE: The console's "Updates to reporters" settings (Plan 018 §5):
 *          validate an update, and summarise the delivery ledger so the
 *          console can say why email or push did not go out.
 *
 * Pure module: no Deno globals, no I/O.
 */

import { scanForSecrets } from './secret-scan.ts'
import { TEMPLATABLE_TYPES, templateError, type TemplatableType } from './reporter-email.ts'

export interface ReporterSettingsPatch {
  reporter_updates_mode?: 'auto' | 'review'
  reporter_email_enabled?: boolean
  reporter_push_enabled?: boolean
  reporter_templates?: Partial<Record<TemplatableType, string>>
}

export type ParsedSettingsUpdate =
  | { ok: true; patch: ReporterSettingsPatch }
  | { ok: false; code: 'VALIDATION_ERROR' | 'SECRET_DETECTED'; message: string; field?: string }

/**
 * Validate a PUT body. `templates` replaces the stored set: a key set to
 * null or '' goes back to the built-in wording.
 */
export function parseReporterSettingsUpdate(body: Record<string, unknown>): ParsedSettingsUpdate {
  const patch: ReporterSettingsPatch = {}
  if (body.mode !== undefined) {
    if (body.mode !== 'auto' && body.mode !== 'review') {
      return { ok: false, code: 'VALIDATION_ERROR', field: 'mode', message: "mode must be 'auto' or 'review'" }
    }
    patch.reporter_updates_mode = body.mode
  }
  for (const [key, column] of [
    ['email_enabled', 'reporter_email_enabled'],
    ['push_enabled', 'reporter_push_enabled'],
  ] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return { ok: false, code: 'VALIDATION_ERROR', field: key, message: `${key} must be true or false` }
    patch[column] = body[key] as boolean
  }
  if (body.templates !== undefined) {
    if (!body.templates || typeof body.templates !== 'object' || Array.isArray(body.templates)) {
      return { ok: false, code: 'VALIDATION_ERROR', field: 'templates', message: 'templates must be an object' }
    }
    const raw = body.templates as Record<string, unknown>
    const out: Partial<Record<TemplatableType, string>> = {}
    for (const key of Object.keys(raw)) {
      if (!(TEMPLATABLE_TYPES as readonly string[]).includes(key)) {
        return { ok: false, code: 'VALIDATION_ERROR', field: `templates.${key}`, message: `Unknown message "${key}"` }
      }
      const value = raw[key]
      if (value === null || (typeof value === 'string' && value.trim() === '')) continue
      const err = templateError(value)
      if (err) return { ok: false, code: 'VALIDATION_ERROR', field: `templates.${key}`, message: `"${key}" ${err}` }
      const leaked = scanForSecrets(value as string)
      if (leaked) {
        return {
          ok: false,
          code: 'SECRET_DETECTED',
          field: `templates.${key}`,
          message: `"${key}" looks like it contains a ${leaked}. Reporters see this text — remove it.`,
        }
      }
      out[key as TemplatableType] = (value as string).trim()
    }
    patch.reporter_templates = out
  }
  return { ok: true, patch }
}

export interface DeliveryCount {
  channel: 'email' | 'push'
  status: string
  reason: string | null
  count: number
}

/** Ledger rows (email / push) → counts by channel, status and reason, largest first. */
export function summarizeDeliveries(
  rows: Array<{ channel: string; status: string; error_message: string | null }>,
): DeliveryCount[] {
  const counts = new Map<string, DeliveryCount>()
  for (const r of rows) {
    if (r.channel !== 'email' && r.channel !== 'push') continue
    // Free-text send errors are grouped as "error" so no provider message leaks into the console list.
    const known = r.status === 'skipped' || r.status === 'deferred' || (r.status === 'sent' && r.error_message === 'digest')
    const reason = known ? r.error_message : r.status === 'failed' ? 'error' : null
    const key = `${r.channel}|${r.status}|${reason ?? ''}`
    const entry = counts.get(key) ?? { channel: r.channel as 'email' | 'push', status: r.status, reason, count: 0 }
    entry.count++
    counts.set(key, entry)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}
