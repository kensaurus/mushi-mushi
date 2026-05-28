/**
 * FILE: apps/admin/src/lib/statTooltips/compliance.ts
 * PURPOSE: Human-readable StatCard tooltips for the Compliance snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { ComplianceStats } from '../../components/compliance/types'
import { metricTip } from '../metricTooltipBuilder'

export function controlsTooltip(stats: ComplianceStats): MetricTooltipData {
  const takeaway =
    stats.controlsFail > 0
      ? `${stats.controlsFail} control${stats.controlsFail === 1 ? '' : 's'} failing · ${stats.controlsWarn} warning${stats.controlsWarn === 1 ? '' : 's'}. Open Evidence tab for SOC2 checklist detail.`
      : stats.controlsWarn > 0
        ? `${stats.controlsPass}/${stats.controlsTotal} controls pass with ${stats.controlsWarn} warning${stats.controlsWarn === 1 ? '' : 's'}.`
        : stats.controlsTotal > 0
          ? `All ${stats.controlsPass} evaluated controls pass — maintain evidence freshness.`
          : stats.soc2Entitlement
            ? 'No controls evaluated yet — generate evidence pack on Evidence tab.'
            : 'SOC2 compliance pack requires plan entitlement.'

  return metricTip(
    'SOC2 control evaluation pass count vs total, with fail and warn breakdown.',
    'controlsPass / controlsTotal from compliance_controls evaluation. controlsFail and controlsWarn count non-pass statuses.',
    takeaway,
    stats.controlsFail > 0
      ? { tone: 'warn', text: `${stats.controlsFail} failing control${stats.controlsFail === 1 ? '' : 's'} — remediate before audit.` }
      : stats.controlsWarn > 0
        ? { tone: 'info', text: `${stats.controlsWarn} warning${stats.controlsWarn === 1 ? '' : 's'} — review Evidence tab.` }
        : undefined,
  )
}

export function controlsDetail(stats: ComplianceStats): string {
  return `${stats.controlsFail} fail · ${stats.controlsWarn} warn`
}

export function openDsarsTooltip(stats: ComplianceStats): MetricTooltipData {
  const takeaway =
    stats.overdueDsars > 0
      ? `${stats.overdueDsars} overdue DSAR${stats.overdueDsars === 1 ? '' : 's'} · ${stats.atRiskDsars} at risk · ${stats.openDsars} open total.`
      : stats.openDsars > 0
        ? `${stats.openDsars} open data-subject request${stats.openDsars === 1 ? '' : 's'}${stats.atRiskDsars > 0 ? ` (${stats.atRiskDsars} approaching deadline).` : '.'}`
        : 'No open DSARs — privacy queue is clear.'

  return metricTip(
    'Open data-subject access requests (DSARs) and overdue/at-risk counts.',
    'openDsars = dsar_requests with status open. overdueDsars past SLA; atRiskDsars within warning window before SLA.',
    takeaway,
    stats.overdueDsars > 0
      ? { tone: 'warn', text: `${stats.overdueDsars} overdue DSAR${stats.overdueDsars === 1 ? '' : 's'} — legal SLA breach risk.` }
      : stats.atRiskDsars > 0
        ? { tone: 'info', text: `${stats.atRiskDsars} DSAR${stats.atRiskDsars === 1 ? '' : 's'} at risk of missing deadline.` }
        : undefined,
  )
}

export function openDsarsDetail(stats: ComplianceStats): string {
  return `${stats.overdueDsars} overdue · ${stats.atRiskDsars} at risk`
}

export function legalHoldsTooltip(stats: ComplianceStats): MetricTooltipData {
  const takeaway =
    stats.legalHoldCount > 0
      ? `${stats.legalHoldCount} active legal hold${stats.legalHoldCount === 1 ? '' : 's'} · ${stats.policiesCount} retention polic${stats.policiesCount === 1 ? 'y' : 'ies'} configured.`
      : stats.policiesCount > 0
        ? `No legal holds · ${stats.policiesCount} retention polic${stats.policiesCount === 1 ? 'y' : 'ies'} active.`
        : 'No legal holds or retention policies — configure on Retention tab.'

  return metricTip(
    'Active legal holds blocking data deletion, and count of retention policies.',
    'legalHoldCount from legal_holds where active. policiesCount from data_retention_policies for the cluster/project.',
    takeaway,
    stats.legalHoldCount > 0
      ? { tone: 'info', text: `${stats.legalHoldCount} legal hold${stats.legalHoldCount === 1 ? '' : 's'} — deletion blocked for affected users.` }
      : undefined,
  )
}

export function legalHoldsDetail(stats: ComplianceStats): string {
  return `${stats.policiesCount} retention polic${stats.policiesCount === 1 ? 'y' : 'ies'}`
}

export function clusterRegionTooltip(stats: ComplianceStats): MetricTooltipData {
  const region = (stats.activeProjectRegion ?? stats.currentRegion).toUpperCase()
  const takeaway =
    stats.activeProjectRegion
      ? `Project pinned to ${region} — data residency enforced for this project.`
      : `Using cluster default region ${region} — pin a project region on Residency tab for GDPR alignment.`

  return metricTip(
    'Effective data residency region for the active project or cluster default.',
    'activeProjectRegion from project.data_residency_region when set; otherwise currentRegion from deployment config.',
    takeaway,
    !stats.activeProjectRegion
      ? { tone: 'info', text: 'Default deployment region — set project pin for residency compliance.' }
      : undefined,
  )
}

export function clusterRegionDetail(stats: ComplianceStats): string {
  return stats.activeProjectRegion ? 'Project pinned region' : 'Default deployment region'
}
