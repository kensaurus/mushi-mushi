/**
 * Plain-language compliance concepts for SOC 2 and GDPR tooling.
 */

export interface ComplianceConceptDefinition {
  id: string
  label: string
  plain: string
  operatorAction: string
}

export const COMPLIANCE_CONCEPT_DEFINITIONS: ComplianceConceptDefinition[] = [
  {
    id: 'soc2',
    label: 'SOC 2 evidence',
    plain:
      'Automated checks that prove controls like access logging, encryption, and change management are working. Each control gets pass / warn / fail from nightly sweeps.',
    operatorAction: 'Open Evidence → expand failing rows → remediate → Refresh evidence.',
  },
  {
    id: 'dsar',
    label: 'DSAR (data subject request)',
    plain:
      'A user asked to export or delete their personal data. GDPR expects a response within 30 days — overdue requests show in red.',
    operatorAction: 'Open DSARs tab → assign owner → mark completed when fulfilled.',
  },
  {
    id: 'retention',
    label: 'Retention & legal hold',
    plain:
      'How long bug reports and attachments are kept before purge jobs run. Legal hold pauses deletion for litigation or audit.',
    operatorAction: 'Set per-project retention on Retention tab; toggle legal hold only when counsel asks.',
  },
  {
    id: 'residency',
    label: 'Data residency',
    plain:
      'Which region stores project data (US/EU). Shown for audit packets — changing region may require migration support.',
    operatorAction: 'Confirm active project region matches your DPA before exporting PDF evidence.',
  },
]

export const COMPLIANCE_EXPLAINER_SUMMARY =
  'The compliance console collects SOC 2 control evidence, tracks GDPR data-subject requests (DSARs), and documents retention/residency posture — so you can answer auditor questions without spreadsheet archaeology.'

export type ComplianceTopPriority =
  | 'no_project'
  | 'upgrade_required'
  | 'failing_controls'
  | 'dsar_overdue'
  | 'no_evidence'
  | 'at_risk'
  | 'healthy'

export function isComplianceGuideExpanded(topPriority: ComplianceTopPriority | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'upgrade_required' ||
    topPriority === 'failing_controls' ||
    topPriority === 'dsar_overdue' ||
    topPriority === 'no_evidence' ||
    topPriority === 'at_risk'
  )
}

export function complianceConceptDefinition(id: string): ComplianceConceptDefinition | undefined {
  return COMPLIANCE_CONCEPT_DEFINITIONS.find((c) => c.id === id)
}
