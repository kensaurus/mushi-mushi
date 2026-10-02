/**
 * FILE: _shared/reporter-copy.ts
 * PURPOSE: What a reporter is shown about their own report, rendered on the
 *          server from fixed templates (Plan 018 §2.2, §2.3, §3 copy rule).
 *
 * OVERVIEW:
 * - Pipeline events render from the template for their kind, never from the
 *   stored `payload.message`: the 18 historic `classified` rows still say
 *   "classified as bug/high" in their payload, and old SDKs show it verbatim.
 * - The English strings here mirror `@mushi-mushi/core/reporter-ui` (the SDKs
 *   localise from `kind`); packages/server/src/__tests__/reporter-copy.test.ts
 *   pins them to core's `en` table so the two can not drift.
 * - Only the developer's own words (replies, questions) pass through verbatim.
 * - Pure module: no Deno globals, no I/O, safe to import from deno test.
 */

export type ReporterTimelineKind =
  | 'received'
  | 'reviewing'
  | 'duplicate_linked'
  | 'info_requested'
  | 'comment'
  | 'reporter_comment'
  | 'fix_started'
  | 'fixed'
  | 'released'
  | 'verified'
  | 'reopened'
  | 'closed'

/** English copy; pinned to core's `en` table by a test. */
export const REPORTER_COPY_EN = {
  timeline: {
    received: 'You reported this',
    reviewing: 'The developer is looking into it',
    duplicate_linked: "Same as an existing report — we'll update you there",
    info_requested: 'The developer asked: {text}',
    reporter_comment: 'You',
    fix_started: 'A fix is in progress',
    fixed: 'Fixed — coming in the next update',
    released: 'Shipped in v{version} — update to get it',
    verified: "You confirmed it's fixed",
    reopened: 'Reopened',
  },
  closedReason: {
    duplicate: "Same as an earlier report — we'll update you there.",
    not_reproducible: "We couldn't reproduce it. Reply if it happens again.",
    wont_fix: 'We decided not to change this.',
    working_as_intended: 'This is expected behaviour.',
    none: 'Closed.',
  },
  ui: {
    developerReplied: 'Developer replied: “{text}”',
  },
} as const

const PREVIEW_MAX = 140

function fill(template: string, params: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? '')
}

function clip(text: string, max = PREVIEW_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Closed-reason copy; spam and unknown reasons read as plain "Closed." */
export function closedReasonText(reason: string | null | undefined): string {
  const table = REPORTER_COPY_EN.closedReason as Record<string, string>
  return reason && reason !== 'spam' && table[reason] ? table[reason] : table.none
}

/**
 * The timeline kind a stored notification type renders as, or null when the
 * type is not part of the reporter's thread (points, reply rows — the reply
 * itself comes from report_comments).
 */
export function timelineKindForNotification(type: string): ReporterTimelineKind | null {
  switch (type) {
    case 'classified':
    case 'reviewing':
      return 'reviewing'
    case 'confirmed':
    case 'fix_started':
      return 'fix_started'
    case 'fixed':
      return 'fixed'
    case 'released':
      return 'released'
    case 'verified':
      return 'verified'
    case 'reopened':
      return 'reopened'
    case 'dismissed':
    case 'closed':
      return 'closed'
    case 'duplicate_linked':
      return 'duplicate_linked'
    default:
      return null
  }
}

/** Render one event. `text` is the developer's verbatim words where the kind carries them. */
export function renderReporterEventText(
  kind: ReporterTimelineKind,
  params: { text?: string | null; version?: string | null; closedReason?: string | null } = {},
): string {
  if (kind === 'comment') return params.text ?? ''
  if (kind === 'reporter_comment') return params.text ?? REPORTER_COPY_EN.timeline.reporter_comment
  if (kind === 'closed') return closedReasonText(params.closedReason)
  if (kind === 'released' && !params.version) return 'Shipped — update to get it'
  return fill(REPORTER_COPY_EN.timeline[kind], { text: params.text ?? '', version: params.version ?? '' })
}

/** Notification row as the reporter routes read it. */
export interface ReporterNotificationRow {
  id: string
  report_id?: string | null
  notification_type: string
  payload: Record<string, unknown> | null
  read_at?: string | null
  created_at: string
  body_override?: string | null
}

/**
 * The payload an SDK may show for a notification: internal labels dropped,
 * pipeline text re-rendered from the template, developer words verbatim.
 * Applied on every read, so rows written before Plan 018 are covered too.
 */
export function reporterSafePayload(row: ReporterNotificationRow): Record<string, unknown> {
  const p = row.payload ?? {}
  const reportId = typeof p.reportId === 'string' ? p.reportId : (row.report_id ?? null)
  const version = typeof p.version === 'string' ? p.version : null
  const closedReason = typeof p.closedReason === 'string' ? p.closedReason : null
  const verbatim = typeof p.message === 'string' ? p.message : ''
  const kind = timelineKindForNotification(row.notification_type)
  let message: string
  if (row.body_override) message = row.body_override
  else if (row.notification_type === 'comment_reply' || row.notification_type === 'info_requested') message = verbatim
  else if (row.notification_type === 'points_awarded') message = verbatim
  else if (kind) message = renderReporterEventText(kind, { version, closedReason })
  else message = 'Your report has been updated'
  const safe: Record<string, unknown> = { reportId, message }
  if (version) safe.version = version
  if (closedReason) safe.closedReason = closedReason
  if (typeof p.points === 'number') safe.points = p.points
  if (typeof p.commentId === 'number' || typeof p.commentId === 'string') safe.commentId = p.commentId
  if (typeof p.canonicalReportId === 'string') safe.canonicalReportId = p.canonicalReportId
  return safe
}

/** One-line list preview of the latest event ("Developer replied: “…”", "Fixed in v1.4"). */
export function reporterEventPreview(row: ReporterNotificationRow): string {
  const safe = reporterSafePayload(row)
  const message = typeof safe.message === 'string' ? safe.message : ''
  if (row.notification_type === 'comment_reply') {
    return fill(REPORTER_COPY_EN.ui.developerReplied, { text: clip(message, 80) })
  }
  return clip(message)
}

/** Bucketed duplicate count: never a raw number (Plan 018 §2.1). */
export function groupBucket(reportCount: number | null | undefined): 'none' | 'few' | 'many' {
  const n = typeof reportCount === 'number' ? reportCount : 0
  if (n >= 10) return 'many'
  if (n >= 2) return 'few'
  return 'none'
}

/** Reporter-safe title: the summary, else the first line of what they wrote. */
export function reporterTitle(report: { title?: string | null; summary?: string | null; description?: string | null }): string {
  const candidate = report.summary?.trim() || report.title?.trim() || report.description?.split('\n')[0]?.trim() || ''
  return clip(candidate, 120)
}

/** Page path from the captured environment (no query string, no host). */
export function reporterPagePath(environment: unknown): string | null {
  const env = (environment ?? {}) as Record<string, unknown>
  const raw = typeof env.url === 'string' ? env.url : typeof env.pageUrl === 'string' ? env.pageUrl : null
  if (!raw) return null
  try {
    return new URL(raw).pathname || '/'
  } catch {
    return raw.startsWith('/') ? raw.split('?')[0] : null
  }
}

export interface ReporterCommentRow {
  id: number | string
  author_kind: 'admin' | 'reporter' | string
  body: string
  created_at: string
}

export interface ReporterTimelineItem {
  kind: ReporterTimelineKind
  at: string
  /** Rendered English text; SDKs re-render pipeline kinds in the reporter's locale. */
  text: string
  /** Verbatim words for comment / info_requested / reporter_comment. */
  body?: string
  version?: string
  closed_reason?: string
  comment_id?: number | string
}

/**
 * Merge the reporter-visible notifications (status 'sent') and comments into
 * one chronological thread. Reply notifications are dropped in favour of the
 * comment itself; a comment that was posted as a question renders as
 * `info_requested`.
 */
export function buildReporterTimeline(input: {
  reportCreatedAt: string
  notifications: ReporterNotificationRow[]
  comments: ReporterCommentRow[]
}): ReporterTimelineItem[] {
  const questionCommentIds = new Set<string>()
  for (const n of input.notifications) {
    const cid = n.payload?.commentId
    if (n.notification_type === 'info_requested' && (typeof cid === 'number' || typeof cid === 'string')) {
      questionCommentIds.add(String(cid))
    }
  }

  const items: ReporterTimelineItem[] = [
    { kind: 'received', at: input.reportCreatedAt, text: renderReporterEventText('received') },
  ]
  for (const n of input.notifications) {
    const kind = timelineKindForNotification(n.notification_type)
    if (!kind) continue
    const safe = reporterSafePayload(n)
    const version = typeof safe.version === 'string' ? safe.version : undefined
    const closed = typeof safe.closedReason === 'string' ? safe.closedReason : undefined
    items.push({
      kind,
      at: n.created_at,
      text: n.body_override ?? renderReporterEventText(kind, { version, closedReason: closed }),
      ...(version ? { version } : {}),
      ...(closed ? { closed_reason: closed } : {}),
    })
  }
  for (const c of input.comments) {
    if (c.author_kind === 'reporter') {
      items.push({ kind: 'reporter_comment', at: c.created_at, text: c.body, body: c.body, comment_id: c.id })
    } else if (questionCommentIds.has(String(c.id))) {
      items.push({
        kind: 'info_requested',
        at: c.created_at,
        text: renderReporterEventText('info_requested', { text: c.body }),
        body: c.body,
        comment_id: c.id,
      })
    } else {
      items.push({ kind: 'comment', at: c.created_at, text: c.body, body: c.body, comment_id: c.id })
    }
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
