/**
 * Traffic-light severity palette — red → amber → yellow → green.
 * Single source of truth for charts, legends, swatches, and badges.
 *
 * Medium used `brand` until 2026-10-04 — the same red as critical in the
 * light theme — so a chart could not tell the two apart. It is now its own
 * yellow token (`sev-medium`).
 */

export const SEVERITY_TRAFFIC = {
  critical: { bg: 'bg-danger', text: 'text-danger-foreground', label: 'Critical' },
  high: { bg: 'bg-warn', text: 'text-warn-foreground', label: 'High' },
  medium: { bg: 'bg-sev-medium', text: 'text-fg-secondary', label: 'Medium' },
  low: { bg: 'bg-ok', text: 'text-ok-foreground', label: 'Low' },
  unscored: { bg: 'bg-fg-faint/45', text: 'text-fg-muted', label: 'Unscored' },
} as const

type SeverityTrafficKey = keyof typeof SEVERITY_TRAFFIC

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
