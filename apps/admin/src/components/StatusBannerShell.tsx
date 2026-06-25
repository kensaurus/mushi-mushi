/**
 * Shared posture banner shell — Reports, Fixes, and other PDCA pages.
 */

import type { ReactNode } from 'react'
import { InlineProof } from './report-detail/ReportSurface'
import { SpringChromeEnter } from './motion/SpringChromeEnter'

export type StatusBannerTone = 'info' | 'brand' | 'danger' | 'warn' | 'ok'

const BANNER_SHELL: Record<StatusBannerTone, { border: string; bg: string; dot: string; title: string }> = {
  info: { border: 'border-info/30', bg: 'bg-surface-raised', dot: 'bg-info', title: 'text-info' },
  brand: { border: 'border-brand/30', bg: 'bg-surface-raised', dot: 'bg-brand', title: 'text-brand' },
  danger: { border: 'border-danger/30', bg: 'bg-surface-raised', dot: 'bg-danger', title: 'text-danger' },
  warn: { border: 'border-warn/30', bg: 'bg-surface-raised', dot: 'bg-warn', title: 'text-warn' },
  ok: { border: 'border-ok/30', bg: 'bg-surface-raised', dot: 'bg-ok', title: 'text-ok' },
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
          {subtitle ? <InlineProof>{subtitle}</InlineProof> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    </SpringChromeEnter>
  )
}
