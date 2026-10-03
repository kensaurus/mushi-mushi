/**
 * FILE: packages/server/supabase/functions/_shared/release-publish.ts
 * PURPOSE: Publish one draft release: mark it published, ship the support
 *          tickets it fulfils, tell each reporter it fixed (one `released`
 *          message per report), and stamp the credits that were delivered.
 *
 * Shared by POST /v1/admin/releases/:id/publish (a person) and the opt-in
 * auto-release (`auto-release.ts`, actor `system`), so both paths reach
 * reporters the same way.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { notifyReleaseReporters, stampDeliveredReleaseCredits, type ReleaseDelivery } from './release-reporters.ts'
import type { TransitionActor } from './report-transition.ts'

export interface PublishedRelease {
  id: string
  project_id: string
  version: string
  published_at: string | null
  fulfilled_ticket_ids?: string[] | null
  fixed_report_ids?: string[] | null
  [key: string]: unknown
}

export type PublishReleaseResult =
  | {
      ok: true
      release: PublishedRelease
      /** Credits whose reporter actually received the release message. */
      notified: number
      ticketsFulfilled: number
      delivery: ReleaseDelivery & { credits_stamped: number; credits_pending: number }
    }
  | {
      ok: false
      status: 404 | 500
      error: string
      /** True when the release went live before the failure (support tickets,
       *  reporter messages or credits failed part-way); false when it is
       *  still a draft. */
      published: boolean
    }

export async function publishRelease(
  db: SupabaseClient,
  releaseId: string,
  actor: TransitionActor,
): Promise<PublishReleaseResult> {
  const { data: release, error } = await db
    .from('releases')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', releaseId)
    .eq('status', 'draft')
    .select()
    .maybeSingle()

  if (error) return { ok: false, status: 500, error: error.message, published: false }
  if (!release) return { ok: false, status: 404, error: 'Release not found or already published', published: false }
  const rel = release as PublishedRelease

  const publishedAt = rel.published_at ?? new Date().toISOString()
  const ticketIds = (rel.fulfilled_ticket_ids ?? []) as string[]
  if (ticketIds.length > 0) {
    const { error: ticketsError } = await db
      .from('support_tickets')
      .update({ shipped_in_release_id: rel.id, shipped_at: publishedAt, status: 'resolved' })
      .in('id', ticketIds)
      // fulfilled_ticket_ids is caller-supplied: only this project's tickets.
      .eq('project_id', rel.project_id)
      .is('shipped_in_release_id', null)
    if (ticketsError) {
      return {
        ok: false,
        status: 500,
        error: `release published, but linking ${ticketIds.length} support ticket(s) failed: ${ticketsError.message}`,
        published: true,
      }
    }
  }

  // One `released` message per reporter (held in review mode); verified
  // reports keep their status, dismissed ones are skipped. Credits are
  // stamped only where a delivered ledger row exists.
  const linked = await notifyReleaseReporters(db, rel, actor)
  if (!linked.ok) return { ok: false, status: 500, error: `release published, but ${linked.error}`, published: true }
  const credits = await stampDeliveredReleaseCredits(db, rel.id)
  if (!credits.ok) return { ok: false, status: 500, error: `release published, but ${credits.error}`, published: true }

  return {
    ok: true,
    release: rel,
    notified: credits.stamped,
    ticketsFulfilled: ticketIds.length,
    delivery: { ...linked.delivery, credits_stamped: credits.stamped, credits_pending: credits.pending },
  }
}
