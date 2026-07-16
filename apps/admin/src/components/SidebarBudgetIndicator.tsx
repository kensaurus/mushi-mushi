/**
 * Sidebar spend signal for /cost — thin budget bar when spend spikes,
 * otherwise a muted call-count inventory badge.
 */

interface Props {
  spendSpike24h: boolean
  calls24h: number
  spend24hUsd: number
  label: string
}

export function SidebarBudgetIndicator({
  spendSpike24h,
  calls24h,
  spend24hUsd,
  label,
}: Props) {
  if (spendSpike24h) {
    const pct = Math.min(100, Math.round(spend24hUsd * 100))
    return (
      <span
        className="ml-auto flex items-center gap-1"
        aria-label={label}
        title={label}
      >
        <span className="relative h-1.5 w-8 overflow-hidden rounded-full bg-warn-muted">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-warn motion-safe:transition-[transform,opacity]"
            style={{ width: `${Math.max(pct, 12)}%` }}
          />
        </span>
        <span className="text-2xs font-medium tabular-nums text-warn">!</span>
      </span>
    )
  }
  if (calls24h <= 0) return null
  return (
    <span
      aria-label={label}
      title={label}
      className="ml-auto text-2xs font-medium tabular-nums text-fg-muted"
    >
      {calls24h > 99 ? '99+' : calls24h}
    </span>
  )
}
