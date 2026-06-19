/**
 * Plain-language triage severity + workflow for the Reports page.
 */

export interface SeverityDefinition {
  id: 'critical' | 'high' | 'medium' | 'low'
  label: string
  plain: string
  triageHint: string
}

export const TRIAGE_SEVERITY_DEFINITIONS: SeverityDefinition[] = [
  {
    id: 'critical',
    label: 'Critical',
    plain: 'Users cannot complete a core workflow — treat as production outage.',
    triageHint: 'Confirm severity, dispatch a fix immediately, and notify the team in Slack.',
  },
  {
    id: 'high',
    label: 'High',
    plain: 'Important feature is broken but a workaround may exist.',
    triageHint: 'Schedule a fix before the next release; merge only after QA passes.',
  },
  {
    id: 'medium',
    label: 'Medium',
    plain: 'Annoyance or polish issue — painful but not blocking revenue paths.',
    triageHint: 'Batch-triage weekly; good candidate for auto-fix when backlog is clear.',
  },
  {
    id: 'low',
    label: 'Low',
    plain: 'Visual nit, copy tweak, or edge case few users hit.',
    triageHint: 'Dismiss noise or park for a cleanup sprint — still useful as a quality signal.',
  },
]

export const REPORTS_TRIAGE_SUMMARY =
  'Every bug lands here after the SDK sends it. The classifier assigns severity automatically — your job is to confirm, dismiss noise, or dispatch a fix. Critical and high items should not sit untriaged for more than an hour.'

export function severityDefinition(id: string): SeverityDefinition | undefined {
  return TRIAGE_SEVERITY_DEFINITIONS.find((s) => s.id === id)
}

/** Show banner when queue needs attention (not clear/healthy). */
export function isReportsBannerVisible(stats: {
  hasAnyProject?: boolean
  hasIngest?: boolean
  topPriority?: string
}): boolean {
  if (!stats.hasAnyProject) return true
  if (!stats.hasIngest) return true
  return stats.topPriority !== 'clear'
}
