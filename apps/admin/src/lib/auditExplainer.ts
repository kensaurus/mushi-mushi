/**
 * Plain-language guide for the append-only audit log.
 */

export const AUDIT_EXPLAINER_SUMMARY =
  'Audit is the forensic trail of every human and agent mutation in your org — who changed what, when, and with which resource ID. Use it for compliance evidence and post-incident review.'

export const AUDIT_TABS = [
  {
    id: 'log',
    label: 'Event log',
    plain: 'Filterable table of create/update/delete actions with expandable metadata JSON.',
    redMeans: 'Clusters of fix.failed or api_key.revoked in 24h warrant immediate review.',
  },
  {
    id: 'actors',
    label: 'Actors',
    plain: 'Breakdown of human vs agent vs system actors so you can spot automation runaway.',
    redMeans: 'A single agent actor dominating writes may indicate a stuck pipeline loop.',
  },
  {
    id: 'actions',
    label: 'Actions',
    plain: 'Top action verbs (report.classified, fix.merged, settings.updated) ranked by volume.',
    redMeans: 'Unexpected action types often mean a new integration or agent was enabled without review.',
  },
] as const

export function isAuditGuideExpanded(failCount24h: number): boolean {
  return failCount24h > 0
}
