import { CHIP_TONE } from '../../lib/chipTone'
/**
 * Six-state inventory status (whitepaper §3.3) — semantic tokens match /graph health language.
 */

const STATUS_CLASS: Record<string, string> = {
  stub: CHIP_TONE.dangerSubtle,
  mocked: CHIP_TONE.warnSubtle + ' border border-warn/20',
  wired: CHIP_TONE.infoSubtle + ' border border-info/20',
  verified: CHIP_TONE.okSubtle,
  regressed: CHIP_TONE.dangerSubtle + ' border border-danger/30',
  unknown: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
}

const GLYPH: Record<string, string> = {
  stub: '🔴',
  mocked: '🟠',
  wired: '🟡',
  verified: '🟢',
  regressed: '⚫',
  unknown: '⚪',
}

export function InventoryStatusPill({
  status,
  className = '',
}: {
  status: string | null | undefined
  className?: string
}) {
  const s = (status ?? 'unknown').toLowerCase()
  const tone = STATUS_CLASS[s] ?? STATUS_CLASS.unknown
  const g = GLYPH[s] ?? GLYPH.unknown
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap ${tone} ${className}`}
      title={s}
    >
      <span aria-hidden="true">{g}</span>
      <span className="capitalize">{s}</span>
    </span>
  )
}
