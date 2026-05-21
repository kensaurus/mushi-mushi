/**
 * Customer-facing ticket detail — replies, shipped-in-release callout, cancel.
 */

import { useCallback, useEffect, useState } from 'react'
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
import { Btn, DetailRows, RelativeTime } from '../ui'
import { ActionPill, ContainedBlock, InlineProof } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'

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
        <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-2xs font-medium ${TICKET_STATUS_TONE[ticket.status]}`}>
          {TICKET_STATUS_LABEL[ticket.status]}
        </span>
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
          <ContainedBlock tone="info" className="space-y-1 text-ok border-ok/30 bg-ok-muted/20">
            <p className="text-2xs font-semibold uppercase tracking-wider">
              Shipped in release
            </p>
            <p className="text-sm font-mono font-bold tabular-nums">
              v{release.version}
            </p>
            <p className="text-fg-secondary leading-snug">{release.title}</p>
            {ticket.shipped_note?.trim() && (
              <p className="text-fg-muted leading-relaxed">{ticket.shipped_note}</p>
            )}
            {release.published_at && (
              <InlineProof className="border-ok/20 bg-ok-muted/10">
                Published <RelativeTime value={release.published_at} />
              </InlineProof>
            )}
            <ActionPill to="/releases" tone="brand">
              View all releases →
            </ActionPill>
          </ContainedBlock>
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
          <ContainedBlock tone="muted">
            <p className="text-fg-secondary leading-relaxed whitespace-pre-wrap break-words">
              {ticket.body?.trim() || <span className="italic text-fg-faint">No message recorded.</span>}
            </p>
          </ContainedBlock>
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
            <ContainedBlock tone="info" className="border-brand/30 bg-brand/5">
              <p className="text-fg leading-relaxed whitespace-pre-wrap break-words">
                {ticket.admin_response}
              </p>
            </ContainedBlock>
          </section>
        ) : ticket.status === 'open' || ticket.status === 'in_progress' ? (
          <EmptySectionMessage text="No reply yet. You will see updates here when we respond or ship your request." />
        ) : null}

        <InlineProof className="font-mono border-0 bg-transparent px-0 py-0">
          Ticket {ticket.id.slice(0, 8)}…
        </InlineProof>
      </div>
    </Modal>
  )
}
