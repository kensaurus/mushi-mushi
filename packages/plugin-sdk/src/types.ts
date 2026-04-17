/**
 * Event taxonomy for Mushi plugins.
 *
 * The taxonomy is *additive*: server may emit new event types without bumping
 * the SDK major. Plugins should treat unknown events as no-ops, not errors.
 */

export type MushiEventName =
  | 'report.created'
  | 'report.classified'
  | 'report.status_changed'
  | 'report.commented'
  | 'report.dedup_grouped'
  | 'fix.proposed'
  | 'fix.applied'
  | 'fix.failed'
  | 'judge.score_recorded'
  | 'sla.breached'

export interface MushiEventEnvelope<T = unknown> {
  /** Event name; one of `MushiEventName`. */
  event: MushiEventName | string
  /** Per-delivery UUID; safe to use as an idempotency key. */
  deliveryId: string
  /** ISO 8601 timestamp. */
  occurredAt: string
  /** Project UUID this event belongs to. */
  projectId: string
  /** Slug of the plugin row that subscribed (`project_plugins.plugin_slug`). */
  pluginSlug: string
  /** Event-specific payload; see `Mushi*Event` types below. */
  data: T
}

// ----------------------------------------------------------------------------
// Per-event data shapes. Kept narrow on purpose — plugin authors should rely
// on the canonical Mushi REST API for the full report object when they need
// more fields than what the event includes.
// ----------------------------------------------------------------------------

export interface MushiReportRef {
  id: string
  status: string
  category?: string
  severity?: string
  title?: string
}

export interface MushiReportCreatedEvent {
  report: MushiReportRef
  source?: string
}

export interface MushiReportClassifiedEvent {
  report: MushiReportRef
  classification: {
    category: string
    severity: string
    confidence: number
    tags?: string[]
  }
}

export interface MushiReportStatusChangedEvent {
  report: MushiReportRef
  previousStatus: string
  newStatus: string
  actorUserId?: string | null
}

export interface MushiReportCommentedEvent {
  report: MushiReportRef
  comment: {
    id: string
    authorUserId: string | null
    body: string
    visibleToReporter: boolean
  }
}

export interface MushiFixEvent {
  report: MushiReportRef
  fix: {
    id: string
    status: string
    branch?: string
    pullRequestUrl?: string
    summary?: string
  }
}

export interface MushiJudgeScoreEvent {
  report: MushiReportRef
  judge: {
    score: number
    rationale: string
    promptVersion: string
  }
}

export interface MushiSlaBreachedEvent {
  report: MushiReportRef
  sla: {
    severity: string
    targetSeconds: number
    elapsedSeconds: number
  }
}
