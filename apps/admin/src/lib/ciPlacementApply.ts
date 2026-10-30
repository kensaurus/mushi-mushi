/**
 * FILE: apps/admin/src/lib/ciPlacementApply.ts
 * PURPOSE: "Apply now" on /ci "Where CI runs" for a team owner or admin
 *          (ADR 0037): one click after the preview files the change,
 *          approves exactly that payload and runs it, in their own console
 *          session. The server keeps every step (request row, approval with
 *          the payload hash, run, audit), so this is the same change as
 *          request → approve → run, without three separate clicks.
 */

import { apiFetch } from './supabase'

export interface PlacementChangeBody {
  projectId: string
  repo: string
  variable: string
  value: string | null
  revertAfterHours?: number
}

export type ApplyResult =
  | { ok: true; detail: string }
  | { ok: false; step: 'request' | 'approve' | 'execute'; code: string | null; message: string; requestId: string | null }

/** Where GitHub asks the account to accept the Mushi App's new permissions. */
export const GITHUB_INSTALLATIONS_URL = 'https://github.com/settings/installations'

export async function applyPlacementNow(body: PlacementChangeBody): Promise<ApplyResult> {
  const req = await apiFetch<{ id: string; payloadSha256: string }>('/v1/admin/ci/placement/requests', { method: 'POST', body: JSON.stringify(body) })
  if (!req.ok || !req.data) {
    return { ok: false, step: 'request', code: req.error?.code ?? null, message: req.error?.message ?? 'Mushi could not save the change.', requestId: null }
  }
  const id = encodeURIComponent(req.data.id)
  const approved = await apiFetch<unknown>(`/v1/admin/ci/placement/requests/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ payloadSha256: req.data.payloadSha256 }),
  })
  if (!approved.ok) {
    return { ok: false, step: 'approve', code: approved.error?.code ?? null, message: approved.error?.message ?? 'Mushi could not approve the change.', requestId: req.data.id }
  }
  const ran = await apiFetch<{ detail?: string }>(`/v1/admin/ci/placement/requests/${id}/execute`, { method: 'POST' })
  if (!ran.ok) {
    return { ok: false, step: 'execute', code: ran.error?.code ?? null, message: ran.error?.message ?? 'GitHub did not take the change.', requestId: req.data.id }
  }
  return { ok: true, detail: ran.data?.detail ?? 'Done.' }
}
