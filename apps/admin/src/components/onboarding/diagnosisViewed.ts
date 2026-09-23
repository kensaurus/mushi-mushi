/**
 * FILE: apps/admin/src/components/onboarding/diagnosisViewed.ts
 * PURPOSE: Record the activation-funnel step `diagnosis_viewed`
 *          (setup_funnel_events) when the first diagnosis renders, through
 *          POST /v1/admin/projects/:id/setup-funnel/diagnosis-viewed.
 *
 * The server keeps one row per project (dedup_key = project id); this module
 * also sends at most one request per project per page load, and forgets a
 * project whose request failed so the next diagnosis retries. Fire-and-
 * forget: never throws, never blocks the screen.
 */

import { apiFetch } from '../../lib/supabase'

const sent = new Set<string>()

export function reportDiagnosisViewed(projectId: string, reportId: string): void {
  if (!projectId || sent.has(projectId)) return
  sent.add(projectId)
  void apiFetch<{ ok: true }>(`/v1/admin/projects/${encodeURIComponent(projectId)}/setup-funnel/diagnosis-viewed`, {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify({ reportId }),
  })
    .then((res) => {
      if (!res.ok) sent.delete(projectId)
    })
    .catch(() => {
      sent.delete(projectId)
    })
}
