/**
 * FILE: apps/admin/src/components/compliance/types.ts
 */

import type { ComplianceTopPriority } from '../../lib/complianceExplainer'

export type { ComplianceTopPriority }

export type ComplianceTabId = 'overview' | 'evidence' | 'retention' | 'dsars' | 'residency'

export interface ComplianceStats {
  projectId: string | null
  projectName: string | null
  soc2Entitlement: boolean
  planId: string
  planDisplayName: string
  projectCount: number
  controlsTotal: number
  controlsPass: number
  controlsWarn: number
  controlsFail: number
  openDsars: number
  overdueDsars: number
  atRiskDsars: number
  legalHoldCount: number
  policiesCount: number
  latestEvidenceAt: string | null
  evidenceNeverGenerated: boolean
  currentRegion: string
  activeProjectRegion: string | null
  topPriority: ComplianceTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_COMPLIANCE_STATS: ComplianceStats = {
  projectId: null,
  projectName: null,
  soc2Entitlement: false,
  planId: 'hobby',
  planDisplayName: 'Hobby',
  projectCount: 0,
  controlsTotal: 0,
  controlsPass: 0,
  controlsWarn: 0,
  controlsFail: 0,
  openDsars: 0,
  overdueDsars: 0,
  atRiskDsars: 0,
  legalHoldCount: 0,
  policiesCount: 0,
  latestEvidenceAt: null,
  evidenceNeverGenerated: true,
  currentRegion: 'us',
  activeProjectRegion: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}

