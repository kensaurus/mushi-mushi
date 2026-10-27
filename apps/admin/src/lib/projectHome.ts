/**
 * FILE: apps/admin/src/lib/projectHome.ts
 * PURPOSE: The shape of GET /v1/admin/projects/:id/home (the per-app Home,
 *          server: api/routes/project-home.ts + _shared/project-home.ts),
 *          and small display helpers its sections share.
 */

export type SectionStatus = 'ok' | 'not_connected' | 'error'

export interface ConnectHint {
  label: string
  to: string
}

export interface HomeSection<T> {
  status: SectionStatus
  data: T | null
  connect: ConnectHint | null
  error: string | null
}

export type Light = 'good' | 'warn' | 'bad' | 'busy' | 'off'
export type HealthId = 'site' | 'errors' | 'sdk' | 'ci'

export interface HealthSignal {
  id: HealthId
  label: string
  status: SectionStatus
  light: Light
  headline: string
  detail: string | null
  at: string | null
  href: string
  connect: ConnectHint | null
}

export type Platform = 'web' | 'ios' | 'android'

export interface HomeApp {
  name: string
  slug: string | null
  iconUrl: string | null
  liveUrl: string | null
  platforms: Platform[]
  version: { value: string; at: string } | null
  sdkOrigin: string | null
  repoUrl: string | null
  thumbnail: { url: string; capturedAt: string | null; pageUrl: string | null } | null
  thumbnailState: {
    available: boolean
    canRefresh: boolean
    reason: string | null
    lastError: string | null
    lastAttemptAt: string | null
  }
}

export interface NeedsYouItem {
  id: string
  impact: number
  text: string
  action: ConnectHint
}

export type StationId = 'fix' | 'ci' | 'train' | 'merged' | 'deployed'

export interface Station {
  id: StationId
  label: string
  count: number
  stuck: number
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unrated'] as const
export type SeverityKey = (typeof SEVERITIES)[number]

export interface HomeRelease {
  stations: Station[]
  train: { state: string; prNumber: number | null; members: number; createdAt: string; repo: string; active: boolean } | null
  lastDeploy: { at: string; version: string | null; ok: boolean } | null
  waiting: { counts: Record<SeverityKey, number>; total: number } | null
  waitingError: string | null
}

export interface SitemapNode {
  path: string
  label: string
  depth: number
  views: number
  bugs: number
  broken: boolean
}

export interface HomeSitemap {
  pages: SitemapNode[]
  totalPages: number
  sampled: boolean
}

export interface WeekRow {
  id: 'reports' | 'critical' | 'merged' | 'sessions'
  label: string
  thisWeek: number
  lastWeek: number
  moreIsBetter: boolean
  href: string
}

export interface ActivityLine {
  id: string
  text: string
  to: string
}

export type SdkFreshness = 'up-to-date' | 'outdated' | 'deprecated' | 'unknown'

export interface HomeAccess {
  projectId: string
  createdAt: string
  repo: { url: string; branch: string | null } | null
  members: { total: number; people: Array<{ name: string | null; avatarUrl: string | null; role: string }> }
  sdk: { package: string | null; version: string | null; latest: string | null; status: SdkFreshness }
  keys: Array<{ label: string; kind: 'sdk' | 'mcp' | 'other'; lastUsedAt: string | null; createdAt: string }>
  keysTotal: number
  keysReadable: boolean
}

export interface ProjectHome {
  generatedAt: string
  projectId: string
  app: HomeSection<HomeApp>
  health: HomeSection<HealthSignal[]>
  needsYou: HomeSection<NeedsYouItem[]>
  release: HomeSection<HomeRelease>
  sitemap: HomeSection<HomeSitemap>
  week: HomeSection<WeekRow[]>
  activity: HomeSection<ActivityLine[]>
  access: HomeSection<HomeAccess>
  /** Reads Needs you could not use; the list may be incomplete. */
  partial: string[]
}

/** Dot colour for a traffic light (with a text label beside it, never colour alone). */
export const LIGHT_DOT: Record<Light, string> = {
  good: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-danger',
  busy: 'bg-info motion-safe:animate-pulse',
  off: 'bg-fg-faint',
}

export const LIGHT_WORD: Record<Light, string> = {
  good: 'Good',
  warn: 'Check',
  bad: 'Problem',
  busy: 'Running',
  off: 'No signal',
}

export const SEVERITY_BAR: Record<SeverityKey, { label: string; bar: string }> = {
  critical: { label: 'Critical', bar: 'bg-danger' },
  high: { label: 'High', bar: 'bg-warn' },
  medium: { label: 'Medium', bar: 'bg-sev-medium' },
  low: { label: 'Low', bar: 'bg-info' },
  unrated: { label: 'Not rated yet', bar: 'bg-fg-faint' },
}

/** Initials for an avatar with no picture. */
export function initialsOf(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** "+3", "−2" or "same" for a week row. */
export function weekDelta(row: Pick<WeekRow, 'thisWeek' | 'lastWeek' | 'moreIsBetter'>): { text: string; tone: 'ok' | 'warn' | 'neutral' } {
  const d = row.thisWeek - row.lastWeek
  if (d === 0) return { text: 'same', tone: 'neutral' }
  const better = d > 0 === row.moreIsBetter
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)}`, tone: better ? 'ok' : 'warn' }
}
