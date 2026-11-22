/**
 * FILE: apps/admin/src/components/signal/StatusGlyph.tsx
 * PURPOSE: The shape that carries a status beside its colour (2026-11-18). Red/green fails
 *          colour-vision deficiency, so every status mark on the console also has a shape:
 *          ▲ critical / failed, ◆ serious / slow / waiting, ● ok / passed, ■ running / info,
 *          ○ off / not set up. Decorative by default (the text next to it names the state);
 *          pass `label` when the glyph stands alone.
 */

export type SignalTone = 'danger' | 'warn' | 'ok' | 'info' | 'off'

const TONE_FILL: Record<SignalTone, string> = {
  danger: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ok',
  info: 'text-info',
  off: 'text-fg-faint',
}

/** Deep text colour for a tone (status ink beside the bright mark). */
export const TONE_INK: Record<SignalTone, string> = {
  danger: 'text-danger-foreground',
  warn: 'text-warn-foreground',
  ok: 'text-ok-foreground',
  info: 'text-info-foreground',
  off: 'text-fg-secondary',
}

/** The glyph a tone uses, for plain-text contexts (titles, aria labels, table cells). */
export const TONE_CHAR: Record<SignalTone, string> = {
  danger: '▲',
  warn: '◆',
  ok: '●',
  info: '■',
  off: '○',
}

const PATHS: Record<SignalTone, string> = {
  danger: 'M6 1 11.5 11H.5z',
  warn: 'M6 .5 11.5 6 6 11.5.5 6z',
  ok: 'M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1z',
  info: 'M1.5 1.5h9v9h-9z',
  off: 'M6 1.75a4.25 4.25 0 1 1 0 8.5 4.25 4.25 0 0 1 0-8.5z',
}

export function StatusGlyph({
  tone,
  pulse = false,
  label,
  className = '',
}: {
  tone: SignalTone
  /** A soft ping behind the mark (critical cards). Off under prefers-reduced-motion. */
  pulse?: boolean
  /** Accessible name when the glyph is the only thing saying the state. */
  label?: string
  className?: string
}) {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }
  const svg = (
    <svg
      viewBox="0 0 12 12"
      className={`relative h-3 w-3 shrink-0 ${TONE_FILL[tone]} ${pulse ? '' : className}`}
      fill={tone === 'off' ? 'none' : 'currentColor'}
      stroke={tone === 'off' ? 'currentColor' : undefined}
      strokeWidth={tone === 'off' ? 1.5 : undefined}
      data-tone={tone}
      {...(pulse ? { 'aria-hidden': true as const } : a11y)}
    >
      <path d={PATHS[tone]} />
    </svg>
  )
  if (!pulse) return svg
  return (
    <span className={`relative inline-flex h-3 w-3 shrink-0 items-center justify-center ${className}`} {...a11y}>
      <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping ${tone === 'danger' ? 'bg-danger' : 'bg-warn'}`} />
      {svg}
    </span>
  )
}
