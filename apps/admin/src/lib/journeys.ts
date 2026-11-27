/**
 * FILE: apps/admin/src/lib/journeys.ts
 * PURPOSE: Types and wording for the Journey optimizer (/journeys, ADR 0058).
 *          The shapes mirror GET /v1/admin/projects/:id/journeys
 *          (packages/server/supabase/functions/api/routes/journeys.ts and
 *          _shared/journey-map.ts).
 */

import type { BadgeTone } from '../components/ui/layout'

export type JourneyFindingKind =
  | 'broken'
  | 'dead_end'
  | 'high_exit'
  | 'loop'
  | 'reload'
  | 'duplicate_page'
  | 'route_variant'
  | 'duplicate_title'
  | 'orphan'
  | 'deep_page'
  | 'unvisited'

export type JourneySeverity = 'high' | 'medium' | 'low'

export interface JourneyFinding {
  id: string
  kind: JourneyFindingKind
  severity: JourneySeverity
  pages: string[]
  title: string
  detail: string
  suggestion: string
  prompt: string
}

export interface JourneyNode {
  path: string
  label: string
  visits: number
  entries: number
  exits: number
  exitRate: number | null
  inScan: boolean
  inbound: number | null
  outbound: number | null
  depth: number | null
  broken: boolean
  issues: JourneyFindingKind[]
}

interface JourneyEdge {
  from: string
  to: string
  moves: number
  linked: boolean
}

interface JourneyFlow {
  pages: string[]
  sessions: number
}

export interface JourneyMap {
  stats: {
    sessions: number
    pageViews: number
    pages: number
    avgPagesPerSession: number | null
    bounceRate: number | null
    sampled: boolean
  }
  score: number
  rootPath: string
  nodes: JourneyNode[]
  edges: JourneyEdge[]
  flows: JourneyFlow[]
  findings: JourneyFinding[]
}

export interface JourneyScan {
  id: string
  status: 'running' | 'done' | 'failed'
  baseUrl: string
  pageCount: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export interface JourneysData {
  days: number
  liveUrl: string | null
  scan: JourneyScan | null
  mapScan: JourneyScan | null
  /** On-demand visit recording window (SDK `trackSessions: 'on-demand'`); `until` null = off. */
  recording: { until: string | null; sampleRate: number }
  map: JourneyMap
}

export const JOURNEY_DAYS = ['7', '30', '90'] as const
export type JourneyDays = (typeof JOURNEY_DAYS)[number]

export const journeysPath = (projectId: string, days: JourneyDays) => `/v1/admin/projects/${projectId}/journeys?days=${days}`
export const journeyScanPath = (projectId: string) => `/v1/admin/projects/${projectId}/journeys/scan`
export const journeyRecordingPath = (projectId: string) => `/v1/admin/projects/${projectId}/journeys/recording`

export const RECORDING_HOURS = [
  { id: '1', label: '1 hour' },
  { id: '24', label: '1 day' },
  { id: '168', label: '1 week' },
] as const
export const RECORDING_SAMPLES = [
  { id: '0.1', label: '10%' },
  { id: '0.5', label: '50%' },
  { id: '1', label: 'Everyone' },
] as const

/** The live address with the tab opt-in for `trackSessions: 'on-demand'`. */
export function testLink(liveUrl: string | null): string | null {
  if (!liveUrl) return null
  try {
    const u = new URL(liveUrl)
    u.searchParams.set('mushi_journeys', '1')
    return u.toString()
  } catch {
    return null
  }
}

/** Short names for each kind of finding, used on chips and filters. */
export const KIND_LABEL: Record<JourneyFindingKind, string> = {
  broken: 'Broken page',
  dead_end: 'Dead end',
  high_exit: 'People leave',
  loop: 'Wrong door',
  reload: 'Reloaded',
  duplicate_page: 'Duplicate pages',
  route_variant: 'Same page, two addresses',
  duplicate_title: 'Same title',
  orphan: 'Nothing links here',
  deep_page: 'Too deep',
  unvisited: 'Never opened',
}

/** Which source a kind needs, so the empty state can say what to turn on. */
export const KIND_SOURCE: Record<JourneyFindingKind, 'visits' | 'scan' | 'watch'> = {
  broken: 'watch',
  dead_end: 'visits',
  high_exit: 'visits',
  loop: 'visits',
  reload: 'visits',
  duplicate_page: 'scan',
  route_variant: 'scan',
  duplicate_title: 'scan',
  orphan: 'scan',
  deep_page: 'scan',
  unvisited: 'scan',
}

export const SEVERITY_TONE: Record<JourneySeverity, BadgeTone> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
}

export const SEVERITY_LABEL: Record<JourneySeverity, string> = {
  high: 'Fix first',
  medium: 'Worth fixing',
  low: 'Tidy up',
}

/** The worst severity among a node's issues, for its colour on the map. */
export function nodeSeverity(node: JourneyNode, findings: JourneyFinding[]): JourneySeverity | null {
  let worst: JourneySeverity | null = null
  for (const f of findings) {
    if (!f.pages.includes(node.path)) continue
    if (f.severity === 'high') return 'high'
    if (f.severity === 'medium') worst = 'medium'
    else if (!worst) worst = 'low'
  }
  return worst
}

function scoreTone(score: number): 'ok' | 'warn' | 'danger' {
  if (score >= 80) return 'ok'
  if (score >= 50) return 'warn'
  return 'danger'
}

/**
 * The Journey score card. The score is 100 minus the problems found, so before
 * a site scan it read "100 · no problems found" beside "Not scanned yet"
 * (owner, 2026-11-18). It says "not scanned yet" until a scan exists.
 */
export function journeyScoreStat(
  score: number,
  findingCount: number,
  hasScan: boolean,
): { value: string; detail: string; tone: 'ok' | 'warn' | 'danger' | 'off' } {
  if (!hasScan) return { value: '—', detail: 'not scanned yet', tone: 'off' }
  return {
    value: String(score),
    detail: findingCount === 0 ? 'no problems found' : `${findingCount} to look at`,
    tone: scoreTone(score),
  }
}

/** The most common paths, most visits first, each with its share of all visits (0–1). */
export function rankedPaths(
  flows: ReadonlyArray<{ pages: string[]; sessions: number }>,
  totalSessions: number,
  limit = 8,
): Array<{ pages: string[]; sessions: number; share: number | null }> {
  return [...flows]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit)
    .map((f) => ({ ...f, share: totalSessions > 0 ? Math.min(1, f.sessions / totalSessions) : null }))
}

export function percent(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

/** Every finding as one paste for a coding agent, worst first. */
export function allFindingsPrompt(findings: JourneyFinding[], appUrl: string | null): string {
  const head = `Improve the user journeys of this app${appUrl ? ` (${appUrl})` : ''}. Mushi Mushi's Journey optimizer found ${findings.length} ${findings.length === 1 ? 'problem' : 'problems'}. Fix them in order, one small change each, and keep the existing design.`
  const items = findings.map((f, i) => `${i + 1}. ${f.title}\n   Pages: ${f.pages.join(', ')}\n   ${f.detail}\n   Change: ${f.suggestion}`)
  return [head, '', ...items, '', 'For each one, find the route or page component in this repo, make the change, and tell me what you changed and how to check it.'].join('\n')
}

/**
 * What the Journey optimizer knows about the app's SDK from /v1/admin/setup
 * (the `sdk_installed` step and its last check-in). The empty state said
 * "Install the Mushi Mushi SDK" to an app whose SDK was installed and
 * sending, and the address field sat empty though the SDK's origin was known
 * (round-2 review).
 */
export interface JourneySdkState {
  installed: boolean
  /** The http(s) origin the SDK last checked in from, never a localhost or app-scheme one. */
  origin: string | null
}

interface SetupStepLike {
  id: string
  complete: boolean
  diagnostic?: { last_sdk_seen_at: string | null; last_sdk_origin: string | null } | null
}

export function journeySdkState(steps: readonly SetupStepLike[] | null | undefined): JourneySdkState {
  const step = steps?.find((s) => s.id === 'sdk_installed')
  const installed = Boolean(step?.complete || step?.diagnostic?.last_sdk_seen_at)
  return { installed, origin: publicOrigin(step?.diagnostic?.last_sdk_origin ?? null) }
}

function publicOrigin(origin: string | null): string | null {
  if (!origin) return null
  try {
    const u = new URL(origin)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || u.hostname.endsWith('.local')) return null
    return u.origin
  } catch {
    return null
  }
}

/** The two "how to get a map" lines of the empty state, true to what is already done. */
export function journeyStartHints(input: { hasScan: boolean; hasVisits: boolean; sdkInstalled: boolean }): string[] {
  return [
    input.hasScan ? 'Site scan: done.' : 'Optional: Scan my site above also maps pages nobody has visited yet. Only the scan needs a key (your own Firecrawl key, in Settings, AI keys); the map from real visits needs none.',
    input.hasVisits
      ? 'Visits: arriving.'
      : input.sdkInstalled
        ? "Turn on session tracking: your SDK is installed but sends no visits. Set trackSessions: true (the default), or start a window under Record visits on demand if it is on 'on-demand'."
        : 'Install the Mushi Mushi SDK with session tracking on (trackSessions: true, the default) to see where real people go.',
  ]
}

