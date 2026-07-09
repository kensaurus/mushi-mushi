/**
 * Billing support tab — ticket composer and history.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Card,
  Btn,
  Badge,
  RelativeTime,
  Input,
  Textarea,
  SelectField,
  DetailRows,
} from '../ui'
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { Modal } from '../Modal'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { useActiveProjectId } from '../ProjectSwitcher'
import { apiFetch } from '../../lib/supabase'
import { TICKET_STATUS_TONE, TICKET_STATUS_LABEL, isCancellable } from '../../lib/supportTickets'
import type { BillingProject, SupportInfo, SupportTicket } from './types'

export function BillingSupportPanel({ projects }: { projects: BillingProject[] }) {
  const infoQuery = usePageData<SupportInfo>('/v1/admin/support/info')
  const ticketsQuery = usePageData<{ tickets: SupportTicket[] }>('/v1/admin/support/tickets?limit=10')
  const info = infoQuery.data
  const tickets = ticketsQuery.data?.tickets ?? []
  const [composing, setComposing] = useState(false)

  if (infoQuery.loading) return null
  if (!info) return null

  return (
    <Card className="p-3 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">Need help?</h3>
          <ContainedBlock tone="muted" className="mt-0.5">
            <p className="text-2xs text-fg-muted">
              Direct line to a human. We reply within one business day for paid plans, two for free.
            </p>
          </ContainedBlock>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={`mailto:${info.email}?subject=${encodeURIComponent('[Mushi Mushi support]')}`}
            className="text-2xs text-accent-foreground hover:text-accent font-mono"
          >
            {info.email}
          </a>
          <Btn size="sm" onClick={() => setComposing((v) => !v)}>
            {composing ? 'Cancel' : 'Open ticket'}
          </Btn>
        </div>
      </header>

      {composing && (
        <SupportComposer
          projects={projects}
          supportEmail={info.email}
          onSubmitted={() => {
            setComposing(false)
            ticketsQuery.reload()
          }}
        />
      )}

      {tickets.length > 0 && (
        <TicketHistory
          tickets={tickets}
          projects={projects}
          onTicketsChanged={() => ticketsQuery.reload()}
        />
      )}
    </Card>
  )
}

interface ComposerProps {
  projects: BillingProject[]
  supportEmail: string
  onSubmitted: () => void
}

function SupportComposer({ projects, supportEmail, onSubmitted }: ComposerProps) {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const initialProjectId = useMemo(() => {
    if (activeProjectId && projects.some((p) => p.project_id === activeProjectId)) {
      return activeProjectId
    }
    return projects[0]?.project_id ?? ''
  }, [activeProjectId, projects])

  const [projectId, setProjectId] = useState(initialProjectId)
  const [category, setCategory] = useState('billing')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const res = await apiFetch<{ ticket_id: string; delivered_to_operator: boolean }>(
      '/v1/support/contact',
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId || null,
          subject: subject.trim(),
          body: body.trim(),
          category,
        }),
      },
    )
    setSubmitting(false)
    if (!res.ok) {
      if (res.error?.code === 'RATE_LIMITED') {
        toast.error('Slow down', `${res.error.message} Or email ${supportEmail} directly.`)
      } else {
        toast.error('Could not send', res.error?.message)
      }
      return
    }
    toast.success(
      'Ticket received',
      res.data?.delivered_to_operator
        ? 'A human is on it. Reply will land in your inbox.'
        : `Saved. Email ${supportEmail} for urgent issues.`,
    )
    setSubject('')
    setBody('')
    onSubmitted()
  }, [projectId, subject, body, category, supportEmail, toast, onSubmitted])

  return (
    <form onSubmit={handleSubmit} className="border border-edge-subtle rounded-md p-3 bg-surface-raised space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label="Project (optional)"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">No specific project</option>
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
          ))}
        </SelectField>
        <SelectField
          label="Category"
          helpId="billing.support_category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="billing">Billing</option>
          <option value="bug">Bug</option>
          <option value="feature">Feature request</option>
          <option value="other">Other</option>
        </SelectField>
      </div>
      <Input
        label="Subject"
        helpId="billing.support_subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="One-line summary"
        required
        minLength={3}
        maxLength={200}
      />
      <Textarea
        label="What's going on?"
        helpId="billing.support_body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="Steps to reproduce, what you expected vs. what happened, project ID if relevant…"
        required
        minLength={10}
        maxLength={5000}
      />
      <div className="flex items-center justify-between">
        <InlineProof className="border-0 bg-transparent px-0 py-0">
          Sent to <span className="font-mono">{supportEmail}</span>. Don't include passwords or API keys.
        </InlineProof>
        <Btn
          type="submit"
          size="sm"
          disabled={submitting || subject.length < 3 || body.length < 10}
          loading={submitting}
        >
          Send ticket
        </Btn>
      </div>
    </form>
  )
}

function TicketHistory({
  tickets,
  projects,
  onTicketsChanged,
}: {
  tickets: SupportTicket[]
  projects: BillingProject[]
  onTicketsChanged: () => void
}) {
  const projectName = useCallback(
    (id: string | null) => projects.find((p) => p.project_id === id)?.project_name ?? '—',
    [projects],
  )
  // Single source of truth for which ticket is expanded. A modal reads
  // straight from `tickets` instead of cloning state so the row stays in
  // sync if a realtime push (or explicit reload) updates the ticket while
  // the modal is open.
  const [openTicketId, setOpenTicketId] = useState<string | null>(null)
  const openTicket = tickets.find((t) => t.id === openTicketId) ?? null

  return (
    <section className="border-t border-edge-subtle pt-2">
      <SignalChip tone="neutral" className="mb-1.5 uppercase tracking-wider">
        Recent tickets
      </SignalChip>
      <ul className="divide-y divide-edge-subtle">
        {tickets.map((t) => {
          // Surface "you have a reply waiting" right on the row so users
          // don't have to open every ticket to find the one with news.
          const hasReply = Boolean(t.admin_response?.trim())
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenTicketId(t.id)}
                className="w-full py-1.5 flex items-center justify-between gap-2 text-2xs text-left hover:bg-surface-overlay/40 motion-safe:transition-colors rounded-sm px-1 -mx-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                aria-label={`View ticket ${t.subject}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-fg truncate font-medium">{t.subject}</p>
                    {hasReply && (
                      <Badge className="border border-edge-subtle bg-surface-raised text-fg-secondary shrink-0 text-3xs">
                        Reply
                      </Badge>
                    )}
                  </div>
                  <InlineProof className="mt-0.5 border-0 bg-transparent px-0 py-0 truncate">
                    <SignalChip tone="neutral">{projectName(t.project_id)}</SignalChip>
                    <SignalChip tone="neutral" className="capitalize">{t.category}</SignalChip>
                    <RelativeTime value={t.created_at} />
                  </InlineProof>
                </div>
                <Badge className={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
              </button>
            </li>
          )
        })}
      </ul>

      <TicketDetailModal
        ticket={openTicket}
        projectName={openTicket ? projectName(openTicket.project_id) : ''}
        onClose={() => setOpenTicketId(null)}
        onCancelled={() => {
          setOpenTicketId(null)
          onTicketsChanged()
        }}
      />
    </section>
  )
}

function TicketDetailModal({
  ticket,
  projectName,
  onClose,
  onCancelled,
}: {
  ticket: SupportTicket | null
  projectName: string
  onClose: () => void
  onCancelled: () => void
}) {
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Reset transient confirm/cancel state every time the modal points at a
  // different ticket. Without this, opening ticket A → clicking "Cancel
  // ticket" → closing → opening ticket B would leave B pre-armed for
  // cancel, which is a footgun.
  //
  // Side-effects must live in `useEffect`, never `useMemo` — `useMemo` runs
  // during render, which makes `setState` calls inside it warn under
  // StrictMode and risk render loops. The `useMemo` form was a copilot-flagged
  // bug from the original wave; this is the fix.
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
    toast.success('Ticket cancelled', 'Operators have been notified.')
    onCancelled()
  }, [ticket, toast, onCancelled])

  if (!ticket) return null

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
      title={
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">{ticket.subject}</span>
        </span>
      }
      headerAction={
        <Badge className={TICKET_STATUS_TONE[ticket.status]}>
          {TICKET_STATUS_LABEL[ticket.status]}
        </Badge>
      }
      footer={
        <>
          <Btn size="sm" variant="cancel" onClick={onClose}>
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
              <Btn size="sm" variant="danger" onClick={handleCancel} loading={cancelling} disabled={cancelling}>
                Confirm cancel
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <DetailRows
          dense
          items={[
            { label: 'Project', value: projectName, tone: 'muted' },
            { label: 'Category', value: <span className="capitalize">{ticket.category}</span>, tone: 'muted' },
            { label: 'Submitted', value: <RelativeTime value={ticket.created_at} />, tone: 'muted' },
            { label: 'Status', value: statusLine, tone: 'muted' },
          ]}
        />

        <section>
          <SignalChip tone="neutral" className="mb-1.5 uppercase tracking-wider">
            Your message
          </SignalChip>
          <ContainedBlock tone="muted" className="text-fg-secondary leading-relaxed whitespace-pre-wrap break-words">
            {ticket.body?.trim() || (
              <EmptySectionMessage text="No message recorded." />
            )}
          </ContainedBlock>
        </section>

        {ticket.admin_response?.trim() ? (
          <section>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <SignalChip tone="brand" className="uppercase tracking-wider">
                Reply from support
              </SignalChip>
              {ticket.admin_responded_at && (
                <SignalChip tone="neutral">
                  <RelativeTime value={ticket.admin_responded_at} />
                </SignalChip>
              )}
            </div>
            <ContainedBlock tone="info" className="text-fg leading-relaxed whitespace-pre-wrap break-words border-brand/40 bg-surface-raised">
              {ticket.admin_response}
            </ContainedBlock>
          </section>
        ) : ticket.status === 'open' || ticket.status === 'in_progress' ? (
          <EmptySectionMessage text="No reply yet. We aim for one business day on paid plans, two on free. You'll see the response here and in the original email thread." />
        ) : null}

        {ticket.status === 'cancelled' && (
          <EmptySectionMessage text="You cancelled this ticket. If the issue resurfaces, send a fresh ticket and link to this id." />
        )}
      </div>
    </Modal>
  )
}
