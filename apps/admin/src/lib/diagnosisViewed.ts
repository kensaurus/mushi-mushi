/**
 * FILE: apps/admin/src/lib/diagnosisViewed.ts
 * PURPOSE: The one place the console records "a diagnosis became visible".
 *          Every surface that renders a diagnosed report calls
 *          `recordDiagnosisViewed` — the first-diagnosis screen (onboarding),
 *          its inline variant (Overview / Reports empty states) and the report
 *          detail page, which is where the toast-only "Send test report"
 *          buttons send people.
 *
 * Two writes, two dedup rules:
 *
 *   product_events `diagnosis_viewed` (taxonomy, via trackSelf) — once per
 *     report per browser session, with `surface` and `sample`. Sample and
 *     real views both count, so the path from the sample diagnosis to the
 *     user's own first report is one event read two ways.
 *
 *   setup_funnel_events `diagnosis_viewed` (the onboarding step, through
 *     POST /v1/admin/projects/:id/setup-funnel/diagnosis-viewed) — sample
 *     views only, at most one request per project per page load. The server
 *     keeps one row per project; a failed request is forgotten so the next
 *     diagnosis retries. Real-report views stay out of it, otherwise every
 *     existing project would be stamped the first time its owner opened a
 *     report after this shipped.
 *
 * Fire-and-forget: never throws, never blocks the screen.
 */

import { apiFetch } from './supabase'
import { trackSelf } from './track'

/** Where the diagnosis was on screen. Closed so a new caller has to pick one. */
export type DiagnosisSurface = 'onboarding' | 'overview' | 'reports' | 'report_detail'

/**
 * `custom_metadata.source` values that mark a synthetic report. Mirrors
 * NON_REAL_REPORT_SOURCES in packages/server/supabase/functions/_shared/first-report.ts.
 */
const SAMPLE_REPORT_SOURCES: ReadonlySet<string> = new Set(['admin_test_report', 'mushi-marketing-seed'])

/** True for the console test report and the marketing demo seed. */
export function isSampleReport(customMetadata: Record<string, unknown> | null | undefined): boolean {
  const source = customMetadata?.source
  return typeof source === 'string' && SAMPLE_REPORT_SOURCES.has(source)
}

const SESSION_KEY = 'mushi:diagnosis-viewed'
/** Fallback when sessionStorage is blocked; also the per-page-load floor. */
const viewedThisLoad = new Set<string>()

function readSessionViewed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Marks `key` as viewed; false when it already was this session. */
function claimView(key: string): boolean {
  if (viewedThisLoad.has(key)) return false
  const stored = readSessionViewed()
  if (stored.has(key)) {
    viewedThisLoad.add(key)
    return false
  }
  viewedThisLoad.add(key)
  stored.add(key)
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify([...stored]))
  } catch {
    /* blocked storage: the in-memory set still dedups this page load */
  }
  return true
}

const setupFunnelSent = new Set<string>()

function postSetupFunnelStep(projectId: string, reportId: string): void {
  if (setupFunnelSent.has(projectId)) return
  setupFunnelSent.add(projectId)
  void apiFetch<{ ok: true }>(`/v1/admin/projects/${encodeURIComponent(projectId)}/setup-funnel/diagnosis-viewed`, {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify({ reportId }),
  })
    .then((res) => {
      if (!res.ok) setupFunnelSent.delete(projectId)
    })
    .catch(() => {
      setupFunnelSent.delete(projectId)
    })
}

export interface DiagnosisViewed {
  projectId: string
  reportId: string
  surface: DiagnosisSurface
  /** The report is synthetic (console test report / demo seed). */
  sample: boolean
}

export function recordDiagnosisViewed({ projectId, reportId, surface, sample }: DiagnosisViewed): void {
  if (!projectId || !reportId) return
  try {
    if (claimView(`${projectId}:${reportId}`)) {
      trackSelf('diagnosis_viewed', { report_id: reportId, project_id: projectId, surface, sample })
    }
    if (sample) postSetupFunnelStep(projectId, reportId)
  } catch {
    /* analytics must never surface as an app error */
  }
}
