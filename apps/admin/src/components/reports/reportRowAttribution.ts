/**
 * Pure helpers for compact triage-row attribution — layer, path, who, capture.
 */

import type { ReportRow } from './types'

export type ReportLayer = 'frontend' | 'backend' | 'server' | 'mobile'

export function locationLabel(env: ReportRow['environment']): string | null {
  if (!env) return null
  if (env.route) return env.route
  if (env.url) {
    try {
      const u = new URL(env.url)
      return u.pathname || u.hostname
    } catch {
      return env.url.slice(0, 60)
    }
  }
  return null
}

/** FE / BE / API / RN from inventory path or SDK family. */
export function inferReportLayer(row: ReportRow): ReportLayer | null {
  const comp = row.component?.toLowerCase() ?? ''
  if (comp.startsWith('frontend/') || comp.startsWith('fe/')) return 'frontend'
  if (comp.startsWith('backend/') || comp.startsWith('be/')) return 'backend'
  if (comp.startsWith('mobile/') || comp.startsWith('rn/')) return 'mobile'

  const pkg = row.sdk_package?.toLowerCase() ?? ''
  if (pkg.includes('node')) return 'server'
  if (pkg.includes('react-native')) return 'mobile'
  if (pkg.includes('web') || pkg.includes('react')) return 'frontend'

  const trigger = row.proactive_trigger ?? ''
  if (trigger.startsWith('node-') || trigger === 'captureException' || trigger === 'captureMessage') {
    return 'server'
  }

  return null
}

const LAYER_PREFIX_RE = /^(frontend|backend|fe|be)\//i

function stripLayerPrefix(path: string): string {
  return path.replace(LAYER_PREFIX_RE, '').trim()
}

function normalizeSlug(value: string): string {
  return value.replace(/^\//, '').trim().toLowerCase()
}

/** Pick one path string — avoids `frontend/foo` + `/foo` on adjacent lines. */
export function resolveReportPath(row: ReportRow): { path: string | null; fullTitle: string | null } {
  const comp = row.component?.trim() ?? null
  const route = locationLabel(row.environment)

  if (comp) {
    const slug = stripLayerPrefix(comp)
    const routeNorm = route ? normalizeSlug(route) : null
    const slugNorm = normalizeSlug(slug)

    if (routeNorm && (slugNorm === routeNorm || slugNorm.startsWith(`${routeNorm}/`) || routeNorm.startsWith(slugNorm))) {
      return { path: slug || comp, fullTitle: comp }
    }

    return { path: slug || comp, fullTitle: comp }
  }

  if (route) {
    return { path: route, fullTitle: row.environment?.url ?? route }
  }

  return { path: null, fullTitle: null }
}

export type CaptureMode = { label: string; tone: string; tooltip: string }

export function captureMode(trigger: string | null | undefined): CaptureMode {
  if (!trigger) {
    return {
      label: 'user',
      tone: 'bg-brand/10 text-brand border-brand/30',
      tooltip: 'User opened the widget and described what they felt.',
    }
  }
  if (trigger === 'window-error' || trigger === 'unhandled-rejection') {
    return {
      label: 'auto',
      tone: 'bg-info-muted text-info-foreground border-info/30',
      tooltip: `Auto-captured on ${trigger === 'window-error' ? 'JS error' : 'unhandled rejection'}.`,
    }
  }
  if (trigger === 'captureException' || trigger === 'captureMessage' || trigger.startsWith('node-')) {
    return {
      label: 'server',
      tone: 'bg-warn-muted/50 text-warning-foreground border-warn/30',
      tooltip: 'Forwarded from a backend service via the Node SDK.',
    }
  }
  if (trigger === 'shake') {
    return {
      label: 'shake',
      tone: 'bg-accent-muted/60 text-[var(--color-accent-foreground)] border-accent/35',
      tooltip: 'Shake-to-report from mobile.',
    }
  }
  return {
    label: trigger.slice(0, 8),
    tone: 'bg-surface-overlay text-fg-muted border-edge-subtle',
    tooltip: `Custom trigger: ${trigger}`,
  }
}

export function reporterWho(row: ReportRow): { label: string; tooltip: string; verified?: boolean } {
  if (row.reporter_display_name) {
    return {
      label: row.reporter_display_name,
      tooltip: row.reporter_jwt_verified
        ? 'Identity verified via signed JWT'
        : 'Reporter identity (unverified)',
      verified: row.reporter_jwt_verified,
    }
  }
  if (row.reporter_user_id) {
    const id = row.reporter_user_id
    const short = id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
    return { label: short, tooltip: `Identified user: ${id}` }
  }
  if (row.reporter_token_hash) {
    const hex = row.reporter_token_hash.slice(0, 6)
    return {
      label: `anon·${hex}`,
      tooltip: `Anonymous device fingerprint ·${hex}`,
    }
  }
  return { label: 'anon', tooltip: 'Anonymous reporter' }
}

export const LAYER_PILL: Record<
  ReportLayer,
  { label: string; tone: string; tooltip: string }
> = {
  frontend: {
    label: 'FE',
    tone: 'bg-info-muted/45 text-info-foreground border-info/35',
    tooltip: 'Frontend / browser surface',
  },
  backend: {
    label: 'BE',
    tone: 'bg-warn-muted/45 text-warning-foreground border-warn/35',
    tooltip: 'Backend inventory surface',
  },
  server: {
    label: 'API',
    tone: 'bg-warn-muted/45 text-warning-foreground border-warn/35',
    tooltip: 'Server-side SDK capture',
  },
  mobile: {
    label: 'RN',
    tone: 'bg-accent-muted/50 text-[var(--color-accent-foreground)] border-accent/35',
    tooltip: 'React Native mobile surface',
  },
}
