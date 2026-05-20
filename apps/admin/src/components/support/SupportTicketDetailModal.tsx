/**
 * Customer-facing ticket detail — replies, shipped-in-release callout, cancel.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import {
  type SupportTicket,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  CATEGORY_LABEL,
  releaseForTicket,
  isCancellable,
} from '../../lib/supportTickets'
import { Modal } from '../Modal'
import { Badge, Btn, DetailRows, RelativeTime } from '../ui'

interface SupportTicketDetailModalProps {
  ticket: SupportTicket | null
  projectName: string
  onClose: () => void
  onChanged: () => void
}

export function SupportTicketDetailModal({
  ticket,
  projectName,
  onClose,
  onChanged,
}: SupportTicketDetailModalProps) {
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const ticketId = ticket?.id ?? null
  useEffect(() => {
    setConfirming(false)
    setCancelling(false)
  }, [ticketId])

  const handleCancel = useCallback(async () => {
    if (!ticket) return
    setCancelling(true)
    const res = await apiFetch<{ ticket_id: string; status: string }>(
      `/v1/admin/support/tickets/${ticket.id}/cancel`,
      { method: 'POST' },
    )
    setCancelling(false)
    if (!res.ok) {
      toast.error('Could not cancel', res.error?.message)
      return
    }
    toast.success('Ticket cancelled', 'You can open a new one anytime.')
    onChanged()
  }, [ticket, toast, onChanged])

  if (!ticket) return null

  const release = releaseForTicket(ticket)
  const cancellable = isCancellable(ticket.status)
  const statusLine =
    ticket.status === 'cancelled' && ticket.cancelled_at
      ? <>Cancelled <RelativeTime value={ticket.cancelled_at} /></>
      : ticket.status === 'resolved' && ticket.resolved_at
        ? <>Resolved <RelativeTime value={ticket.resolved_at} /></>
        : <>Last updated <RelativeTime value={ticket.updated_at} /></>

  return (
    <Modal
      open={Boolean(ticket)}
      onClose={onClose}
      size="md"
      ariaLabel={`Support ticket: ${ticket.subject}`}
      title={<span className="truncate">{ticket.subject}</span>}
      headerAction={
        <Badge className={TICKET_STATUS_TONE[ticket.status]}>
          {TICKET_STATUS_LABEL[ticket.status]}
        </Badge>
      }
      footer={
        <>
          <Btn size="sm" variant="ghost" onClick={onClose}>
            Close
          </Btn>
          {cancellable && !confirming && (
            <Btn size="sm" variant="danger" onClick={() => setConfirming(true)}>
              Cancel ticket
            </Btn>
          )}
          {cancellable && confirming && (
            <>
              <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={cancelling}>
                Keep ticket
              </Btn>
              <Btn size="sm" variant="danger" onClick={() => void handleCancel()} loading={cancelling}>
                Confirm cancel
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3 text-xs">
        {release && release.status === 'published' && (
          <section className="rounded-md border border-ok/30 bg-ok-muted/20 p-2.5 space-y-1">
            <p className="text-2xs font-semibold text-ok uppercase tracking-wider">
              Shipped in release
            </p>
            <p className="text-sm font-mono font-bold text-ok tabular-nums">
              v{release.version}
            </p>
            <p className="text-fg-secondary leading-snug">{release.title}</p>
            {ticket.shipped_note?.trim() && (
              <p className="text-fg-muted leading-relaxed">{ticket.shipped_note}</p>
            )}
            {release.published_at && (
              <p className="text-2xs text-fg-faint">
                Published <RelativeTime value={release.published_at} />
              </p>
            )}
            <Link
              to="/releases"
              className="inline-block text-2xs text-brand hover:text-brand-hover font-medium"
            >
              View all releases →
            </Link>
          </section>
        )}

        <DetailRows
          dense
          items={[
            { label: 'Project', value: projectName, tone: 'muted' },
            { label: 'Category', value: CATEGORY_LABEL[ticket.category] ?? ticket.category, tone: 'muted' },
            { label: 'Submitted', value: <RelativeTime value={ticket.created_at} />, tone: 'muted' },
            { label: 'Status', value: statusLine, tone: 'muted' },
          ]}
        />

        <section>
          <h4 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Your message</h4>
          <p className="text-fg-secondary leading-relaxed whitespace-pre-wrap break-words border border-edge-subtle/60 rounded-md bg-surface-raised/30 p-2.5">
            {ticket.body?.trim() || <span className="italic text-fg-faint">No message recorded.</span>}
          </p>
        </section>

        {ticket.admin_response?.trim() ? (
          <section>
            <h4 className="text-2xs uppercase tracking-wider text-brand mb-1.5 flex items-center gap-2">
              <span aria-hidden>↩</span>
              <span>Reply from the team</span>
              {ticket.admin_responded_at && (
                <span className="text-fg-faint normal-case tracking-normal">
                  · <RelativeTime value={ticket.admin_responded_at} />
                </span>
              )}
            </h4>
            <p className="text-fg leading-relaxed whitespace-pre-wrap break-words border border-brand/30 rounded-md bg-brand/5 p-2.5">
              {ticket.admin_response}
            </p>
          </section>
        ) : ticket.status === 'open' || ticket.status === 'in_progress' ? (
          <p className="text-2xs text-fg-faint italic">
            No reply yet. You will see updates here when we respond or ship your request.
          </p>
        ) : null}

        <p className="text-3xs text-fg-faint font-mono">Ticket {ticket.id.slice(0, 8)}…</p>
      </div>
    </Modal>
  )
}
