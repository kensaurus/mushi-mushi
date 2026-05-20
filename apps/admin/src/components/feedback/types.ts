/**
 * FILE: apps/admin/src/components/feedback/types.ts
 * PURPOSE: My feedback shell stats — banner + KPI strip.
 */

export type FeedbackTabId = 'overview' | 'active' | 'shipped' | 'all'

export type FeedbackTopPriority = 'reply' | 'active' | 'clear' | 'first_submit'

export interface FeedbackStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  totalTickets: number
  activeTickets: number
  awaitingReply: number
  shippedTickets: number
  bugTickets: number
  featureTickets: number
  billingTickets: number
  resolvedTickets: number
  lastSubmittedAt: string | null
  lastShippedAt: string | null
  latestReplyAt: string | null
  topTicketId: string | null
  topTicketSubject: string | null
  topTicketCategory: string | null
  topPriority: FeedbackTopPriority
  topPriorityLabel: string | null
}

export const EMPTY_FEEDBACK_STATS: FeedbackStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  totalTickets: 0,
  activeTickets: 0,
  awaitingReply: 0,
  shippedTickets: 0,
  bugTickets: 0,
  featureTickets: 0,
  billingTickets: 0,
  resolvedTickets: 0,
  lastSubmittedAt: null,
  lastShippedAt: null,
  latestReplyAt: null,
  topTicketId: null,
  topTicketSubject: null,
  topTicketCategory: null,
  topPriority: 'first_submit',
  topPriorityLabel: null,
}
