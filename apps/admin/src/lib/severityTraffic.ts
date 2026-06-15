/**
 * Traffic-light severity palette — red → amber → yellow → green.
 * Single source of truth for charts, legends, swatches, and badges.
 */

export const SEVERITY_TRAFFIC = {
  critical: { bg: 'bg-danger', text: 'text-danger-foreground', label: 'Critical' },
  high: { bg: 'bg-warn', text: 'text-warning-foreground', label: 'High' },
  medium: { bg: 'bg-brand', text: 'text-brand', label: 'Medium' },
  low: { bg: 'bg-ok', text: 'text-ok-foreground', label: 'Low' },
  unscored: { bg: 'bg-fg-faint/45', text: 'text-fg-muted', label: 'Unscored' },
} as const

export type SeverityTrafficKey = keyof typeof SEVERITY_TRAFFIC

export const SEVERITY_TRAFFIC_ORDER: SeverityTrafficKey[] = [
  'critical',
  'high',
  'medium',
  'low',
  'unscored',
]

export function severityTrafficBg(severity: string | null | undefined): string | null {
  if (!severity) return null
  const key = severity as SeverityTrafficKey
  return SEVERITY_TRAFFIC[key]?.bg ?? null
}

export function severityTrafficLabel(severity: string | null | undefined): string | null {
  if (!severity) return null
  const key = severity as SeverityTrafficKey
  return SEVERITY_TRAFFIC[key]?.label ?? severity
}

/** Badge chrome aligned to traffic-light fills — AA foreground on muted bg. */
export const SEVERITY_TRAFFIC_BADGE: Record<string, string> = {
  critical: 'bg-danger-muted/70 text-danger-foreground border border-danger/25',
  high: 'bg-warn-muted/70 text-warning-foreground border border-warn/25',
  medium: 'bg-brand-subtle/85 text-brand border border-brand/25',
  low: 'bg-ok-muted/70 text-ok-foreground border border-ok/25',
}
