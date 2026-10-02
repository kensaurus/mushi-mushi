/**
 * Helpers for comparing settings draft vs saved server values.
 */

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.000_1
  }
  return String(a ?? '') === String(b ?? '')
}

export function maskSecret(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  if (!v) return '(empty)'
  if (v.length <= 8) return '••••••••'
  return `${v.slice(0, 4)}…${v.slice(-4)}`
}

export function formatSettingValue(
  value: unknown,
  opts?: { kind?: 'text' | 'secret' | 'bool' | 'number' | 'url' },
): string {
  const kind = opts?.kind ?? 'text'
  if (kind === 'bool') return value ? 'On' : 'Off'
  if (kind === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n.toFixed(2) : '—'
  }
  if (kind === 'secret') return maskSecret(typeof value === 'string' ? value : '')
  const s = String(value ?? '').trim()
  if (!s) return '(empty)'
  if (kind === 'url' && s.length > 48) return `${s.slice(0, 32)}…`
  return s
}

/**
 * Form base for a `/v1/admin/settings` payload. The server masks every stored
 * secret and adds a `<column>_set` flag beside it; the form starts those
 * fields empty so the mask is never shown as a value or sent back.
 */
export function settingsFormBase<T extends object>(data: T | null | undefined): T {
  const out = { ...(data ?? {}) } as Record<string, unknown>
  for (const key of Object.keys(out)) {
    if (key.endsWith('_set') && typeof out[key] === 'boolean') {
      const column = key.slice(0, -'_set'.length)
      if (column in out) out[column] = ''
    }
  }
  return out as T
}

/** Only the fields the user changed: a save never echoes untouched values. */
export function changedSettings<T extends object>(current: T, saved: T): Partial<T> {
  const cur = current as Record<string, unknown>
  const prev = saved as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(cur)) {
    if (!valuesEqual(cur[key], prev[key])) out[key] = cur[key]
  }
  return out as Partial<T>
}

export function countChangedFields(
  pairs: Array<{ current: unknown; saved: unknown }>,
): number {
  return pairs.filter(({ current, saved }) => !valuesEqual(current, saved)).length
}
