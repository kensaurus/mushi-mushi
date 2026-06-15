/**
 * FILE: apps/admin/src/lib/resolveProjectDomain.ts
 * PURPOSE: Resolve a hostname for fetching a project's app favicon.
 *          Priority: live SDK origin (canonical "where is this app?") →
 *          slug hints for known dogfood projects → null (caller shows initials).
 */

import type { SetupProject, SetupStepDiagnostic } from './useSetupStatus'

export interface ProjectFaviconSource {
  project_id: string
  project_name: string
  project_slug: string
  /** e.g. https://kensaur.us — from SDK heartbeat or API key last_seen_origin */
  sdk_origin?: string | null
}

/**
 * Slug → production domain hints for projects whose SDK hasn't heartbeated
 * yet (fresh project, localhost-only dev, etc.). Keep this tiny and
 * high-confidence — wrong hints are worse than initials fallback.
 */
const SLUG_DOMAIN_HINTS: Record<string, string> = {
  'glot-it': 'kensaur.us',
  'glotit': 'kensaur.us',
  'yen-yen': 'kensaur.us',
  'yenyen': 'kensaur.us',
  'solo-boss-cloud': 'soloboss.cloud',
  'mushi-mushi': 'mushimushi.dev',
}

function originToDomain(origin: string): string | null {
  const trimmed = origin.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const host = url.hostname.toLowerCase()
    // Google's favicon CDN can't resolve localhost — fall back to initials.
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
      return null
    }
    return host
  } catch {
    return null
  }
}

export function resolveProjectDomain(source: ProjectFaviconSource): string | null {
  if (source.sdk_origin) {
    const fromOrigin = originToDomain(source.sdk_origin)
    if (fromOrigin) return fromOrigin
  }
  const hinted = SLUG_DOMAIN_HINTS[source.project_slug.toLowerCase()]
  if (hinted) return hinted
  return null
}

/** Pull the SDK heartbeat origin off the setup checklist payload. */
export function sdkOriginFromSetupProject(project: SetupProject): string | null {
  return sdkDiagnosticFromSetupProject(project)?.last_sdk_origin ?? null
}

export function sdkDiagnosticFromSetupProject(project: SetupProject): SetupStepDiagnostic | null {
  const sdkStep = project.steps.find((s) => s.id === 'sdk_installed')
  return sdkStep?.diagnostic ?? null
}

/** Compact relative time for dense chrome (switcher rows, chips). */
export function formatHeartbeatAgo(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return null
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds < 30) return 'just now'
  if (seconds < 90) return '1m ago'
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 60 * 90) return '1h ago'
  if (seconds < 60 * 60 * 24) return `${Math.round(seconds / 3600)}h ago`
  if (seconds < 60 * 60 * 36) return '1d ago'
  return `${Math.round(seconds / 86400)}d ago`
}

/** Human-readable origin for heartbeat rows — host + optional path. */
export function formatHeartbeatOrigin(origin: string | null | undefined): string | null {
  if (!origin?.trim()) return null
  try {
    const url = new URL(origin.includes('://') ? origin : `https://${origin}`)
    const path = url.pathname && url.pathname !== '/' ? url.pathname : ''
    return `${url.hostname}${path}`
  } catch {
    const trimmed = origin.trim()
    return trimmed.length > 36 ? `${trimmed.slice(0, 36)}…` : trimmed
  }
}

export type HeartbeatTone = 'live' | 'stale' | 'mismatch' | 'none'

export function heartbeatTone(
  diagnostic: SetupStepDiagnostic | null,
  adminEndpointHost?: string | null,
): HeartbeatTone {
  if (!diagnostic?.last_sdk_seen_at) return 'none'
  const ts = Date.parse(diagnostic.last_sdk_seen_at)
  if (!Number.isFinite(ts)) return 'none'
  if (
    adminEndpointHost &&
    diagnostic.last_sdk_endpoint_host &&
    adminEndpointHost !== diagnostic.last_sdk_endpoint_host
  ) {
    return 'mismatch'
  }
  const hours = (Date.now() - ts) / 3_600_000
  if (hours > 48) return 'stale'
  return 'live'
}

export interface ProjectHeartbeatSummary {
  tone: HeartbeatTone
  ago: string | null
  origin: string | null
  endpointHost: string | null
  tooltip: string
}

export function summarizeProjectHeartbeat(
  project: SetupProject,
  adminEndpointHost?: string | null,
): ProjectHeartbeatSummary {
  const diagnostic = sdkDiagnosticFromSetupProject(project)
  const tone = heartbeatTone(diagnostic, adminEndpointHost)
  const ago = formatHeartbeatAgo(diagnostic?.last_sdk_seen_at)
  const origin = formatHeartbeatOrigin(diagnostic?.last_sdk_origin)
  const endpointHost = diagnostic?.last_sdk_endpoint_host ?? null

  if (tone === 'none') {
    return {
      tone,
      ago: null,
      origin: null,
      endpointHost: null,
      tooltip: 'SDK has not heartbeated yet — load a page with the widget installed.',
    }
  }

  if (tone === 'mismatch') {
    return {
      tone,
      ago,
      origin,
      endpointHost,
      tooltip: `SDK last reached ${endpointHost ?? 'another backend'} but this admin reads ${adminEndpointHost ?? 'a different host'}.`,
    }
  }

  const parts = [`SDK seen ${ago ?? 'recently'}`]
  if (origin) parts.push(`from ${origin}`)
  if (endpointHost) parts.push(`via ${endpointHost}`)

  return {
    tone,
    ago,
    origin,
    endpointHost,
    tooltip: parts.join(' · '),
  }
}

/** Best-effort origin from project API keys (projects list endpoint). */
export function sdkOriginFromApiKeys(
  keys: Array<{ is_active?: boolean; revoked?: boolean; last_seen_origin?: string | null }> | undefined,
): string | null {
  if (!keys?.length) return null
  const live = keys.find((k) => k.is_active && !k.revoked && k.last_seen_origin)
  if (live?.last_seen_origin) return live.last_seen_origin
  const any = keys.find((k) => k.last_seen_origin)
  return any?.last_seen_origin ?? null
}

/** Two-letter initials for favicon fallback chips. */
export function projectInitials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
  }
  const compact = name.replace(/[^a-zA-Z0-9]/g, '')
  return (compact.slice(0, 2) || name.slice(0, 2) || '?').toUpperCase()
}

const INITIALS_CHIP_THEMES = [
  'bg-info/15 text-info border-info/35',
  'bg-brand/15 text-brand border-brand/35',
  'bg-warn-muted/50 text-warning-foreground border-warn/35',
  'bg-ok/15 text-ok border-ok/35',
  'bg-accent-muted/55 text-accent-foreground border-accent/35',
] as const

/** Stable accent so the same project always gets the same initials colour. */
export function projectInitialsChipClass(projectId: string): string {
  let hash = 0
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash + projectId.charCodeAt(i)) % INITIALS_CHIP_THEMES.length
  }
  return INITIALS_CHIP_THEMES[hash]!
}
