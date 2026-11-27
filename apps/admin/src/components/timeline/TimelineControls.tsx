/**
 * FILE: apps/admin/src/components/timeline/TimelineControls.tsx
 * PURPOSE: The Timeline's role-aware controls (ADR 0072):
 *          - a viewer sees Pin and Keep forever disabled, with the reason as a
 *            tooltip, instead of a click that ends in a 403;
 *          - a run links to /ux-runs only for an operator (that page is
 *            operator-only); a builder gets the run's screens on this page.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { formatCost, type TimelinePoint } from '../../lib/timeline'

export const VIEWER_EDIT_HINT = 'Viewers can look but not change the timeline. Ask a member, admin or owner of this team.'

/** A known viewer cannot pin or keep shots; an unknown role (still loading) lets the server decide. */
export function canEditTimeline(role: string | null | undefined): boolean {
  return role !== 'viewer'
}

export function KeepForeverButton({ pinned, canEdit, onToggle }: { pinned: boolean; canEdit: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      disabled={!canEdit}
      onClick={canEdit ? onToggle : undefined}
      className="self-start text-2xs text-fg-secondary underline underline-offset-2 hover:text-fg disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
      title={!canEdit ? VIEWER_EDIT_HINT : pinned ? 'Kept forever. Click to let the retention setting remove it.' : 'Keep this shot beyond the retention setting.'}
    >
      {pinned ? 'Kept forever' : 'Keep forever'}
    </button>
  )
}

export function PinButton({ label, canEdit, busy, disabled, onPin }: { label: string; canEdit: boolean; busy: boolean; disabled?: boolean; onPin: () => void }) {
  return (
    <span title={!canEdit ? VIEWER_EDIT_HINT : undefined}>
      <Btn variant="primary" size="sm" loading={busy} onClick={onPin} disabled={!canEdit || disabled}>
        {label}
      </Btn>
    </span>
  )
}

/** The runs behind a stop: links for an operator, the run's screens on this page for a builder. */
export function RunLinks({ runs, isOperator, onShowScreens }: { runs: TimelinePoint['runs']; isOperator: boolean; onShowScreens: () => void }) {
  if (!runs.length) return <span className="text-xs text-fg-secondary">No UX run in this window</span>
  return (
    <ul className="flex flex-col gap-0.5">
      {runs.slice(0, 4).map((r) => {
        const label = `${r.kind === 'scorecard' ? 'Scorecard' : 'UX run'} ${r.local_run_id.slice(0, 8)}`
        return (
          <li key={r.id} className="text-xs">
            {isOperator ? (
              <Link
                className="text-brand underline underline-offset-2"
                to={r.kind === 'scorecard' ? `/ux-runs?view=scorecard&run=${encodeURIComponent(r.local_run_id)}` : `/ux-runs?run=${encodeURIComponent(r.local_run_id)}`}
              >
                {label}
              </Link>
            ) : (
              <span className="text-fg">{label}</span>
            )}
            <span className="text-fg-muted"> · {formatCost(r.cost_usd)}</span>
          </li>
        )
      })}
      {runs.length > 4 && <li className="text-2xs text-fg-muted">and {runs.length - 4} more</li>}
      {!isOperator && (
        <li>
          <button type="button" onClick={onShowScreens} className="text-2xs text-brand underline underline-offset-2">
            See their screens below
          </button>
        </li>
      )}
    </ul>
  )
}
