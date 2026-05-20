/**
 * Multi-select admin feedback tickets to credit when publishing a release.
 */

import { useMemo, useState } from 'react'
import { usePageData } from '../../lib/usePageData'
import { CATEGORY_EMOJI, CATEGORY_LABEL } from '../../lib/supportTickets'
import { Badge, Btn, RelativeTime } from '../ui'

export interface LinkableTicket {
  id: string
  subject: string
  category: string
  status: string
  user_email: string
  created_at: string
}

interface FulfilledTicketsPickerProps {
  projectId: string
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}

export function FulfilledTicketsPicker({
  projectId,
  selectedIds,
  onChange,
  disabled,
}: FulfilledTicketsPickerProps) {
  const [expanded, setExpanded] = useState(selectedIds.length > 0)
  const query = usePageData<{ tickets: LinkableTicket[] }>(
    `/v1/admin/projects/${projectId}/support-tickets/linkable?limit=50`,
    { deps: [projectId] },
  )

  const tickets = query.data?.tickets ?? []
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  function toggle(id: string) {
    if (disabled) return
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  if (query.loading) {
    return <p className="text-2xs text-fg-muted">Loading linkable feedback…</p>
  }

  if (tickets.length === 0) {
    return (
      <p className="text-2xs text-fg-muted leading-relaxed">
        No open bug reports or feature requests for this project that are not already linked to a release.
        Users file these from <span className="font-medium text-fg-secondary">My feedback</span> or the beta banner.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-fg">Credit admin feedback</h3>
          <p className="text-2xs text-fg-muted mt-0.5">
            On publish, selected submitters see <span className="font-mono text-fg-secondary">Shipped in v…</span> on My feedback.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedIds.length > 0 && (
            <Badge className="bg-ok-muted text-ok font-mono tabular-nums">
              {selectedIds.length} selected
            </Badge>
          )}
          <Btn size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Collapse' : 'Choose tickets'}
          </Btn>
        </div>
      </div>

      {expanded && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-edge-subtle divide-y divide-edge-subtle">
          {tickets.map((t) => {
            const checked = selectedSet.has(t.id)
            return (
              <li key={t.id}>
                <label className="flex items-start gap-2 px-2 py-2 cursor-pointer hover:bg-surface-overlay/40">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(t.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs" aria-hidden>{CATEGORY_EMOJI[t.category] ?? '💬'}</span>
                      <span className="text-xs font-medium text-fg truncate">{t.subject}</span>
                    </span>
                    <span className="text-2xs text-fg-faint block truncate">
                      {CATEGORY_LABEL[t.category] ?? t.category} · {t.user_email} ·{' '}
                      <RelativeTime value={t.created_at} />
                    </span>
                  </span>
                  <Badge className="shrink-0 text-[0.6rem] capitalize">{t.status.replace('_', ' ')}</Badge>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
