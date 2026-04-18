/**
 * FILE: apps/admin/src/components/integrations/HealthSparkline.tsx
 * PURPOSE: Tiny inline sparkline for an integration's last 14 health probes.
 *          One bar per probe, tinted by status, oldest-on-the-left so eyes
 *          read time the way they expect.
 */

import type { HealthRow } from './types'

interface Props {
  rows: HealthRow[]
}

const HEIGHT_BY_STATUS: Record<HealthRow['status'], string> = {
  ok: 'h-3',
  degraded: 'h-2',
  down: 'h-3',
  unknown: 'h-1',
}

const BG_BY_STATUS: Record<HealthRow['status'], string> = {
  ok: 'bg-ok',
  degraded: 'bg-warning',
  down: 'bg-danger',
  unknown: 'bg-fg-faint/30',
}

export function HealthSparkline({ rows }: Props) {
  const ordered = [...rows].reverse()
  return (
    <span className="inline-flex items-end gap-px h-3" aria-label="Recent health history">
      {ordered.map((r) => (
        <span
          key={r.id}
          className={`w-1 rounded-sm ${HEIGHT_BY_STATUS[r.status]} ${BG_BY_STATUS[r.status]}`}
          title={`${r.status} · ${r.checked_at}`}
        />
      ))}
    </span>
  )
}
