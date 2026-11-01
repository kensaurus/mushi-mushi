/**
 * Shared posture banner shell — Reports, Fixes, and other PDCA pages.
 */

import type { ReactNode } from 'react'
import { SpringChromeEnter } from './motion/SpringChromeEnter'

export type StatusBannerTone = 'info' | 'brand' | 'danger' | 'warn' | 'ok'

// Titles use the *-foreground tokens: raw `text-warn` is L=0.68 amber in light
// mode (~2.3:1 on the white banner), `text-danger` ~4:1.
const BANNER_SHELL: Record<StatusBannerTone, { border: string; bg: string; dot: string; title: string }> = {
  info: { border: 'border-info/30', bg: 'bg-surface-raised', dot: 'bg-info', title: 'text-info-foreground' },
  brand: { border: 'border-brand/30', bg: 'bg-surface-raised', dot: 'bg-brand', title: 'text-brand-foreground' },
  danger: { border: 'border-danger/30', bg: 'bg-surface-raised', dot: 'bg-danger', title: 'text-danger-foreground' },
  warn: { border: 'border-warn/30', bg: 'bg-surface-raised', dot: 'bg-warn', title: 'text-warning-foreground' },
  ok: { border: 'border-ok/30', bg: 'bg-surface-raised', dot: 'bg-ok', title: 'text-ok-foreground' },
}

export function StatusBannerShell({
  tone,
  title,
  subtitle,
  action,
  pulseDot,
}: {
  tone: StatusBannerTone
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  pulseDot?: boolean
}) {
  const shell = BANNER_SHELL[tone]
  return (
    <SpringChromeEnter>
    <div
      className={`flex flex-col gap-3 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${shell.border} ${shell.bg}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${shell.dot} ${pulseDot ? 'motion-safe:animate-pulse' : ''}`}
          aria-hidden
        />
        <div className="min-w-0 space-y-1">
          <p className={`text-xs font-medium ${shell.title}`}>{title}</p>
          {/* Plain supporting copy. It was an InlineProof label chip, which
              wrapped a whole sentence in a grey pill inside the banner. */}
          {subtitle ? <p className="text-2xs leading-snug text-fg-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    </SpringChromeEnter>
  )
}
