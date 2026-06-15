/**
 * Shared types + labels for customer support tickets (/feedback, /billing).
 */

export type SupportTicketStatus =
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'cancelled'

export type SupportTicketCategory = 'billing' | 'bug' | 'feature' | 'other'

export interface ShippedRelease {
  id: string
  version: string
  title: string
  status: 'draft' | 'published'
  published_at: string | null
}

export interface SupportTicket {
  id: string
  project_id: string | null
  subject: string
  body?: string
  category: SupportTicketCategory | string
  status: SupportTicketStatus
  plan_id: string | null
  admin_response?: string | null
  admin_responded_at?: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  cancelled_at?: string | null
  shipped_in_release_id?: string | null
  shipped_at?: string | null
  shipped_note?: string | null
  release?: ShippedRelease | ShippedRelease[] | null
}

export function releaseForTicket(ticket: SupportTicket): ShippedRelease | null {
  const r = ticket.release
  if (!r) return null
  return Array.isArray(r) ? (r[0] ?? null) : r
}

export const TICKET_STATUS_TONE: Record<SupportTicketStatus, string> = {
  open: 'bg-warn-muted/50 text-warning-foreground',
  in_progress: 'bg-brand-subtle text-brand',
  resolved: 'bg-ok-muted text-ok',
  closed: 'bg-surface-overlay text-fg-muted',
  cancelled: 'bg-surface-overlay text-fg-faint border border-edge-subtle',
}

export const TICKET_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

export const CATEGORY_LABEL: Record<string, string> = {
  bug: 'Bug report',
  feature: 'Feature request',
  billing: 'Billing',
  other: 'Other',
}

export const CATEGORY_EMOJI: Record<string, string> = {
  bug: '🐛',
  feature: '✨',
  billing: '💳',
  other: '💬',
}

export function isCancellable(status: SupportTicketStatus): boolean {
  return status === 'open' || status === 'in_progress'
}

export function hasUnreadReply(ticket: SupportTicket): boolean {
  return Boolean(ticket.admin_response?.trim())
}

export function isShipped(ticket: SupportTicket): boolean {
  return Boolean(ticket.shipped_in_release_id ?? releaseForTicket(ticket)?.id)
}
