/**
 * FILE: packages/server/supabase/functions/_shared/ux-captures.ts
 * PURPOSE: UX captures from any driver (ADR 0073, Plan 025 P2), with no I/O.
 *          `POST /v1/ux/captures` takes the pages a Maestro flow, adb, the iOS
 *          simulator, an SDK's debug screenshot or a browser wrote (PNG +
 *          facts.json, the scorecard's own capture layout) and opens a
 *          scorecard run for them, so the rubric, its probes and the judge
 *          score a phone screen exactly as they score a web page. Native runs
 *          carry a platform and a device for the UX runs list.
 *
 *          The wire shape, the run row, the page rows and the upload names.
 *
 * Pure apart from zod: vitest imports it directly.
 */

import { z } from 'npm:zod@3'
import { scorecardPageKey, UX_SCORECARD_PROMPT_VERSION } from './ux-scorecard.ts'
import { parseViewport, scorecardShotPath, scorecardSurfaceKey, scorecardSurfaceRow, UxScorecardFacts, UX_SCORECARD_RUN_ID_RE } from './ux-scorecard-io.ts'

export const UX_CAPTURE_PLATFORMS = ['web', 'ios', 'android', 'flutter', 'react_native', 'capacitor', 'other'] as const
export type UxCapturePlatform = (typeof UX_CAPTURE_PLATFORMS)[number]
export const UX_CAPTURE_SOURCES = ['playwright', 'maestro', 'adb', 'simctl', 'sdk', 'other'] as const
export type UxCaptureSource = (typeof UX_CAPTURE_SOURCES)[number]

/** Pages one upload may hold (each is one model call when scored on the server). */
export const UX_CAPTURES_MAX_PAGES = 60
/** Bytes one screenshot may be; the client checks before it asks, the bucket enforces its own limit too. */
export const UX_CAPTURE_MAX_PNG_BYTES = 8 * 1024 * 1024

const Shot = z.enum(['early', 'settled'])

export const UxCapturesBody = z
  .object({
    /** The app, when the key or session does not name one. */
    projectId: z.string().uuid().optional(),
    /** Add the pages to this run (a retry); omit to open a new one. */
    runId: z.string().regex(UX_SCORECARD_RUN_ID_RE).optional(),
    platform: z.enum(UX_CAPTURE_PLATFORMS),
    device: z.string().trim().min(1).max(120).optional(),
    source: z.enum(UX_CAPTURE_SOURCES).optional(),
    /** What to call the app in the run's line ("glot.it Android"). */
    app: z.string().trim().min(1).max(120).optional(),
    /** WIDTHxHEIGHT in points; default the first page's viewport. */
    viewport: z.string().optional(),
    /** The most this run may spend on server scoring (default: its pages' estimate). */
    maxCostUsd: z.number().min(0.05).max(20).optional(),
    pages: z
      .array(z.object({ facts: UxScorecardFacts, shots: z.array(Shot).min(1).max(2) }))
      .min(1)
      .max(UX_CAPTURES_MAX_PAGES),
  })
  .strict()
export type UxCapturesBody = z.infer<typeof UxCapturesBody>

/** Pure: the run's one-line description (ux_runs.detail). */
export function capturesDetail(b: Pick<UxCapturesBody, 'platform' | 'device' | 'app'>, viewport: string): string {
  const label: Record<UxCapturePlatform, string> = { web: 'Web', ios: 'iOS', android: 'Android', flutter: 'Flutter', react_native: 'React Native', capacitor: 'Capacitor', other: 'App' }
  return [b.app, label[b.platform], b.device, `viewport ${viewport}`].filter(Boolean).join(' · ').slice(0, 300)
}

/** Pure: the viewport the run records, or null when neither the body nor the pages give a valid one. */
export function capturesViewport(b: Pick<UxCapturesBody, 'viewport' | 'pages'>): string | null {
  if (b.viewport !== undefined) {
    const v = parseViewport(b.viewport)
    return v ? `${v.width}x${v.height}` : null
  }
  const first = b.pages[0]?.facts.viewport
  return first ? `${first.width}x${first.height}` : null
}

/** Pure: the ux_runs row a new captures run opens (kind scorecard, scored later by the server). */
export function capturesRunRow(b: UxCapturesBody, ctx: { projectId: string; localRunId: string; userId: string; viewport: string; now: Date }): Record<string, unknown> {
  const at = ctx.now.toISOString()
  return {
    project_id: ctx.projectId,
    local_run_id: ctx.localRunId,
    created_by: ctx.userId,
    kind: 'scorecard',
    mode: 'local',
    agent: 'ux-scorecard',
    model: 'server',
    status: 'running',
    start_url: null,
    platform: b.platform,
    device: b.device ?? null,
    capture_source: b.source ?? (b.platform === 'web' ? 'playwright' : 'other'),
    detail: capturesDetail(b, ctx.viewport),
    counts: { pages: b.pages.length, scored: 0, failed: 0, mean: null, causes: 0, prompt: UX_SCORECARD_PROMPT_VERSION },
    started_at: at,
    finished_at: null,
    updated_at: at,
  }
}

/** Pure: the upload name of one page's shot, as the score route and the console read it (`<surface-key>/<early|settled>.png`). */
export function captureShotName(pageKey: string, shot: 'early' | 'settled'): string {
  return `${scorecardSurfaceKey(scorecardPageKey(pageKey))}/${shot}.png`
}

/** Pure: the page rows (unscored) and the uploads a captures body asks for, or the first bad page key. */
export function capturesPlan(
  b: UxCapturesBody,
  ctx: { projectId: string; runRowId: string; now: Date },
): { ok: true; surfaces: Array<Record<string, unknown>>; uploads: Array<{ page: string; name: string; path: string }> } | { ok: false; message: string } {
  const seen = new Set<string>()
  const surfaces: Array<Record<string, unknown>> = []
  const uploads: Array<{ page: string; name: string; path: string }> = []
  for (const p of b.pages) {
    const key = scorecardPageKey(p.facts.key)
    const surfaceKey = scorecardSurfaceKey(key)
    if (seen.has(surfaceKey)) return { ok: false, message: `Two pages have the key "${key.slice(0, 80)}". Give each screen its own key.` }
    seen.add(surfaceKey)
    const names = [...new Set(p.shots)].map((s) => captureShotName(p.facts.key, s))
    for (const name of names) {
      const path = scorecardShotPath(ctx.projectId, ctx.runRowId, name)
      if (!path) return { ok: false, message: `The page key "${key.slice(0, 80)}" makes no valid screenshot name.` }
      uploads.push({ page: key, name, path })
    }
    // Shot names go on the row now; the score route reads the screenshots by them once uploaded.
    surfaces.push(scorecardSurfaceRow({ facts: { ...p.facts, key }, shots: names }, ctx))
  }
  return { ok: true, surfaces, uploads }
}
