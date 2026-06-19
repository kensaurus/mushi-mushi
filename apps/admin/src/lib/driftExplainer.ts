/**
 * Plain-language schema / contract drift guide.
 */

export interface DriftFindingSeverityDefinition {
  id: 'critical' | 'warn' | 'info'
  label: string
  plain: string
  example: string
}

export const DRIFT_SEVERITY_DEFINITIONS: DriftFindingSeverityDefinition[] = [
  {
    id: 'critical',
    label: 'Critical',
    plain: 'Breaking mismatch — API response shape, RLS policy, or inventory node disappeared since last snapshot.',
    example: 'Dropped column your mobile client still reads',
  },
  {
    id: 'warn',
    label: 'Warning',
    plain: 'Likely regression or undocumented change that should be reviewed before the next release.',
    example: 'New required field not reflected in OpenAPI spec',
  },
  {
    id: 'info',
    label: 'Info',
    plain: 'Informational diff — safe to dismiss after confirming intentional.',
    example: 'Renamed internal enum value with no client impact',
  },
]

export const DRIFT_EXPLAINER_SUMMARY =
  'Drift compares your live Supabase schema, OpenAPI contracts, and inventory graph against the last saved snapshot. Critical findings mean something your app relies on changed without you noticing.'

export function isDriftGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'critical_findings' ||
    topPriority === 'warn_findings' ||
    topPriority === 'never_scanned' ||
    topPriority === 'stale_scan'
  )
}
