/**
 * FILE: packages/server/supabase/functions/_shared/setup-gap-followup.ts
 * PURPOSE: The review follow-up key setup gap (setup-gaps.ts `followupKeyGap`)
 *          with its two reads: the organization's follow-up settings and the
 *          chosen key's status. Moved here from api/routes/setup-gaps.ts so
 *          the setup-gaps route and the health gate (health-gate.ts) read it
 *          the same way, without the gate importing a route module.
 *
 *          Two small reads, no GitHub: cheap enough for a dispatcher tick.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { loadFollowupSettings } from './review-followup-db.ts'
import { followupKeyGap, type SetupGap } from './setup-gaps.ts'

export interface FollowupGapProject {
  id: string
  organization_id: string | null
}

export interface FollowupGapOptions {
  /** Wraps each read with a deadline (the route's `within`); none by default. */
  within?: <T>(p: PromiseLike<T>, what: string) => Promise<T>
  /** The reason in plain words for a failed read (the route's `why`). */
  why?: (err: unknown) => string
}

const plain = <T>(p: PromiseLike<T>): Promise<T> => Promise.resolve(p)
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 160)

/** The gap line; a failed read is `unknown` with the reason, never a missing line. */
export async function readFollowupKeyGap(db: SupabaseClient, project: FollowupGapProject, opts: FollowupGapOptions = {}): Promise<SetupGap> {
  const within = opts.within ?? plain
  const why = opts.why ?? message
  try {
    if (!project.organization_id) {
      return followupKeyGap({ projectId: project.id, settings: { enabled: false, offReason: null, keyId: null } })
    }
    const settings = await within(loadFollowupSettings(db, project.organization_id), 'follow-up settings')
    let keyStatus: string | null | undefined
    if (settings.enabled && settings.keyId) {
      const { data, error } = await within(db.from('byok_keys').select('status').eq('id', settings.keyId).maybeSingle(), 'follow-up key')
      if (error) throw new Error(error.message)
      keyStatus = (data as { status: string } | null)?.status ?? null
    }
    return followupKeyGap({ projectId: project.id, settings, keyStatus })
  } catch (err) {
    return { ...followupKeyGap({ projectId: project.id, settings: null }), summary: `Mushi could not read the review follow-up settings (${why(err)}).` }
  }
}
