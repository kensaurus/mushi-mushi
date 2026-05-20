/**
 * FILE: apps/admin/src/components/iterate/ScoreBar.tsx
 * PURPOSE: Compact score visualization with semantic tone colors.
 */

import { scoreBarClass } from './types'

interface Props {
  score: number | null
  className?: string
}

export function ScoreBar({ score, className = '' }: Props) {
  if (score == null) {
    return <span className={`text-2xs text-fg-faint ${className}`}>—</span>
  }
  const pct = Math.round(score * 100)
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={`h-full rounded-full ${scoreBarClass(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-2xs tabular-nums text-fg-secondary">{pct}%</span>
    </div>
  )
}
