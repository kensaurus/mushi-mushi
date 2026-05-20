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

export function countChangedFields(
  pairs: Array<{ current: unknown; saved: unknown }>,
): number {
  return pairs.filter(({ current, saved }) => !valuesEqual(current, saved)).length
}
