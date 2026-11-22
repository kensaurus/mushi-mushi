/**
 * FILE: apps/admin/src/lib/auditView.ts
 * PURPOSE: Pure view logic for the audit log (round-2 review 2026-11-18):
 *          consecutive identical rows collapse into one ("settings.updated ×4"),
 *          the Overview shows only the newest few groups, the pager hides when
 *          there is one page, and a zero count is drawn neutral, not red.
 */

export interface AuditRowLike {
  id: string
  action: string
  resource_type: string
  resource_id: string | null
  actor_id: string | null
  actor_email: string | null
  actor_name?: string | null
  actor_display_email?: string | null
  created_at: string
}

/** A name or email, never a raw id ("Unnamed actor" when only an id exists). */
export function auditActorLabel(e: AuditRowLike): string {
  return e.actor_name ?? e.actor_display_email ?? e.actor_email ?? (e.actor_id ? 'Unnamed actor' : 'system')
}

export interface AuditGroup<T extends AuditRowLike> {
  /** The newest entry's id: stable while the group's head row stays the same. */
  id: string
  /** The newest entry; its action, actor and resource stand for the group. */
  first: T
  /** Newest first, as the server sent them. */
  entries: T[]
}

function sameRun(a: AuditRowLike, b: AuditRowLike): boolean {
  return (
    a.action === b.action &&
    a.resource_type === b.resource_type &&
    (a.resource_id ?? '') === (b.resource_id ?? '') &&
    auditActorLabel(a) === auditActorLabel(b)
  )
}

/**
 * Collapse runs of consecutive rows with the same action, resource and actor.
 * Only neighbours merge: the same change made again after something else
 * happened stays a separate row, so the order of events is never rewritten.
 */
export function groupAuditRuns<T extends AuditRowLike>(logs: readonly T[]): AuditGroup<T>[] {
  const groups: AuditGroup<T>[] = []
  for (const entry of logs) {
    const last = groups[groups.length - 1]
    if (last && sameRun(last.first, entry)) last.entries.push(entry)
    else groups.push({ id: entry.id, first: entry, entries: [entry] })
  }
  return groups
}

/** How many groups the Overview tab shows before "Open the full log". */
export const AUDIT_OVERVIEW_ROWS = 5

/** The pager only earns its place when there is more than one page. */
export function auditPagerVisible(totalPages: number): boolean {
  return totalPages > 1
}

/** Failure / warning counts: coloured only when there is something to see. */
export function auditCountTone(kind: 'failure' | 'warning', count: number): 'danger' | 'warn' | 'neutral' {
  if (count <= 0) return 'neutral'
  return kind === 'failure' ? 'danger' : 'warn'
}
