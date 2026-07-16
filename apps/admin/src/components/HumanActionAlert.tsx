/**
 * FILE: apps/admin/src/components/HumanActionAlert.tsx
 * PURPOSE: Reusable human-centric alert — plain headline, explanation, primary
 *          CTA, and optional deep-linked preview rows. Used on Projects,
 *          Fixes, Dashboard, and other surfaces where operators need to know
 *          what went wrong and what to do next.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ContainedBlock } from './report-detail/ReportSurface'

export interface HumanActionPreviewItem {
  id: string
  title: string
  subtitle?: string | null
  href: string
}

export interface HumanActionAlertProps {
  tone?: 'muted' | 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral'
  badge?: ReactNode
  headline: string
  hint: string
  actionLabel: string
  actionHref: string
  preview?: HumanActionPreviewItem[]
  compact?: boolean
  className?: string
}

export function HumanActionAlert({
  tone = 'warn',
  badge,
  headline,
  hint,
  actionLabel,
  actionHref,
  preview,
  compact = false,
  className = '',
}: HumanActionAlertProps) {
  const items = preview?.slice(0, 3) ?? []
  const primaryCta = tone === 'danger' || tone === 'warn'

  return (
    <ContainedBlock tone={tone} className={`space-y-2.5 ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {badge}
            <p className="text-sm font-semibold text-fg">{headline}</p>
          </div>
          {!compact ? <p className="text-xs leading-relaxed text-fg-secondary">{hint}</p> : null}
        </div>
        <Link
          to={actionHref}
          className={`inline-flex shrink-0 items-center justify-center rounded-sm border px-3 py-1.5 text-xs font-medium motion-safe:transition-[transform,opacity] ${
            primaryCta
              ? 'border-brand/40 bg-brand text-brand-fg hover:bg-brand/90'
              : 'border-edge bg-surface-raised text-fg hover:bg-surface-overlay'
          }`}
        >
          {actionLabel}
        </Link>
      </div>

      {items.length > 0 ? (
        <ul className="space-y-1.5 border-t border-edge-subtle/50 pt-2">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-start gap-2 text-xs">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
              <div className="min-w-0 flex-1">
                <Link
                  to={item.href}
                  className="font-medium text-fg hover:text-accent-foreground underline underline-offset-2 motion-safe:transition-opacity"
                >
                  {item.title}
                </Link>
                {item.subtitle ? (
                  <p className="mt-0.5 truncate text-2xs text-fg-muted" title={item.subtitle}>
                    {item.subtitle}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {compact ? <p className="text-2xs text-fg-muted">{hint}</p> : null}
    </ContainedBlock>
  )
}
