import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useMergedErrors } from '../lib/useMergedErrors'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  ErrorAlert,
  EmptyState,
  Input,
  SelectField,
  FilterChip,
  Badge,
  Section,
  StatCard,
  SegmentedControl,
  type FilterChipTone,
} from '../components/ui'
import { ConfigHelp } from '../components/ConfigHelp'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { ResponsiveTable, TableDensityToggle } from '../components/ResponsiveTable'
import { Modal } from '../components/Modal'
import { PromptDialog } from '../components/ConfirmDialog'
import { IconEye } from '../components/icons'
import { useToast } from '../lib/toast'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { SetupNudge } from '../components/SetupNudge'
import { PageActionBar } from '../components/PageActionBar'
import { useNextBestAction } from '../lib/useNextBestAction'
import { PageHero } from '../components/PageHero'
import { ComplianceStatusBanner } from '../components/compliance/ComplianceStatusBanner'
import {
  EMPTY_COMPLIANCE_STATS,
  type ComplianceStats,
  type ComplianceTabId,
} from '../components/compliance/types'
import {
  clusterRegionDetail,
  clusterRegionTooltip,
  controlsDetail,
  controlsTooltip,
  legalHoldsDetail,
  legalHoldsTooltip,
  openDsarsDetail,
  openDsarsTooltip,
} from '../lib/statTooltips/compliance'

interface RetentionPolicy {
  project_id: string
  reports_retention_days: number
  audit_retention_days: number
  llm_traces_retention_days: number
  byok_audit_retention_days: number
  legal_hold: boolean
  legal_hold_reason: string | null
  updated_at: string
}

interface Dsar {
  id: string
  project_id: string
  request_type: 'access' | 'export' | 'deletion' | 'rectification'
  subject_email: string
  subject_id: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'rejected'
  fulfilled_at: string | null
  rejection_reason: string | null
  evidence_url: string | null
  notes: string | null
  created_at: string
}

interface ResidencyProject {
  id: string
  name: string
  slug: string
  data_residency_region: 'us' | 'eu' | 'jp' | 'self' | null
  created_at: string
}

interface Evidence {
  id: string
  project_id: string
  control: string
  control_label: string
  status: 'pass' | 'warn' | 'fail'
  payload: Record<string, unknown>
  generated_at: string
}

const STATUS_CHIP: Record<Evidence['status'], string> = {
  pass: 'bg-ok/15 text-ok border border-ok/30',
  warn: 'bg-warn/15 text-warn border border-warn/30',
  fail: 'bg-danger/15 text-danger border border-danger/30',
}

const DSAR_STATUS_CHIP: Record<Dsar['status'], string> = {
  pending: 'bg-warn/15 text-warn border border-warn/30',
  in_progress: 'bg-info/15 text-info border border-info/30',
  completed: 'bg-ok/15 text-ok border border-ok/30',
  rejected: 'bg-fg-faint/20 text-fg-muted border border-edge-subtle',
}

/**
 * Severity-led filter chips. The page reads `?status=` from the URL so
 * deep links from the dashboard hero (e.g. `/compliance?status=open`) and
 * the Next-Best-Action CTA actually land on a filtered view rather than
 * the firehose. The chips are stable identifiers — never change without
 * also updating useNextBestAction.ts.
 */
type ComplianceFilter = 'all' | 'open' | 'fail' | 'warn' | 'legal_hold'
const FILTER_VALUES: ComplianceFilter[] = ['all', 'open', 'fail', 'warn', 'legal_hold']
function parseFilter(raw: string | null): ComplianceFilter {
  return FILTER_VALUES.includes(raw as ComplianceFilter) ? (raw as ComplianceFilter) : 'all'
}

const FILTER_TONES: Record<ComplianceFilter, FilterChipTone> = {
  all: 'default',
  open: 'warn',
  fail: 'danger',
  warn: 'warn',
  legal_hold: 'info',
}

const FILTER_LABELS: Record<ComplianceFilter, string> = {
  all: 'All',
  open: 'Open',
  fail: 'Failing',
  warn: 'At risk',
  legal_hold: 'Legal hold',
}

const FILTER_HINTS: Record<ComplianceFilter, string> = {
  all: 'Show every section — controls, DSARs, retention, residency.',
  open: 'Failing or warning controls plus pending / in-progress DSARs.',
  fail: 'Only controls failing evidence and DSARs overdue past 21 days.',
  warn: 'Controls flagged with warnings — investigate before they escalate.',
  legal_hold: 'Projects placed on legal hold — retention sweeps are paused.',
}

const COMPLIANCE_TABS: Array<{ id: ComplianceTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture summary, severity filters, and cross-section audit trail.',
  },
  {
    id: 'evidence',
    label: 'Evidence',
    description: 'Latest SOC 2 control snapshots — expand payload JSON for auditors.',
  },
  {
    id: 'retention',
    label: 'Retention',
    description: 'Per-project retention windows and legal-hold toggles.',
  },
  {
    id: 'dsars',
    label: 'DSARs',
    description: 'GDPR / CCPA subject requests — file, fulfil, or reject within 30 days.',
  },
  {
    id: 'residency',
    label: 'Residency',
    description: 'Pin projects to US / EU / JP clusters before data lands.',
  },
]

function isComplianceTab(value: string | null): value is ComplianceTabId {
  return COMPLIANCE_TABS.some((t) => t.id === value)
}

const GDPR_SLA_DAYS = 30

function dsarIsOpen(d: Dsar): boolean {
  return d.status !== 'completed' && d.status !== 'rejected'
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

export function CompliancePage() {
  const copy = usePageCopy('/compliance')
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const statsPath = activeProjectId ? '/v1/admin/compliance/stats' : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt,
    isValidating,
  } = usePageData<ComplianceStats>(statsPath)
  const stats = statsData ?? EMPTY_COMPLIANCE_STATS

  const policiesQuery = usePageData<{ policies: RetentionPolicy[] }>('/v1/admin/compliance/retention')
  const dsarsQuery = usePageData<{ requests: Dsar[] }>('/v1/admin/compliance/dsars')
  const evidenceQuery = usePageData<{ evidence: Evidence[] }>('/v1/admin/compliance/evidence')
  const residencyQuery = usePageData<{ projects: ResidencyProject[]; currentRegion: string }>(
    '/v1/admin/residency',
  )

  const policies = useMemo(() => policiesQuery.data?.policies ?? [], [policiesQuery.data])
  const dsars = useMemo(() => dsarsQuery.data?.requests ?? [], [dsarsQuery.data])
  const evidence = useMemo(() => evidenceQuery.data?.evidence ?? [], [evidenceQuery.data])
  const residency = useMemo(() => residencyQuery.data?.projects ?? [], [residencyQuery.data])
  const currentRegion = residencyQuery.data?.currentRegion ?? 'us'

  const merged = useMergedErrors([
    { ...policiesQuery, label: 'retention policies' },
    { ...dsarsQuery, label: 'DSAR queue' },
    { ...evidenceQuery, label: 'evidence vault' },
    { ...residencyQuery, label: 'residency map' },
  ])
  const loading = merged.loading
  const error = merged.error
  const reloadAll = useCallback(() => {
    reloadStats()
    policiesQuery.reload()
    dsarsQuery.reload()
    evidenceQuery.reload()
    residencyQuery.reload()
  }, [reloadStats, policiesQuery, dsarsQuery, evidenceQuery, residencyQuery])

  useRealtimeReload(
    ['soc2_evidence', 'data_subject_requests', 'project_retention_policies'],
    reloadAll,
  )

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: ComplianceTabId = isComplianceTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = COMPLIANCE_TABS.find((t) => t.id === activeTab) ?? COMPLIANCE_TABS[0]

  const setActiveTab = useCallback(
    (id: ComplianceTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const filter = parseFilter(searchParams.get('status'))
  const effectiveFilter: ComplianceFilter = activeTab === 'overview' ? filter : 'all'
  const setFilter = useCallback(
    (next: ComplianceFilter) => {
      const params = new URLSearchParams(searchParams)
      if (next === 'all') params.delete('status')
      else params.set('status', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const setFilterFromBanner = useCallback(
    (status: 'fail' | 'open' | 'legal_hold') => {
      const params = new URLSearchParams(searchParams)
      params.set('status', status)
      if (activeTab !== 'overview') params.delete('tab')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams, activeTab],
  )

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of residency) map.set(p.id, p.name)
    return map
  }, [residency])

  const [refreshing, setRefreshing] = useState(false)
  const [filing, setFiling] = useState(false)
  const [payloadModalEvidence, setPayloadModalEvidence] = useState<Evidence | null>(null)
  const [rejectingDsar, setRejectingDsar] = useState<Dsar | null>(null)
  const [rejectingBusy, setRejectingBusy] = useState(false)
  const [dsarForm, setDsarForm] = useState<{
    requestType: Dsar['request_type']
    subjectEmail: string
    subjectId: string
    notes: string
  }>({
    requestType: 'access',
    subjectEmail: '',
    subjectId: '',
    notes: '',
  })

  const setProjectRegion = async (projectId: string, region: ResidencyProject['data_residency_region']) => {
    if (!region) return
    const res = await apiFetch<{ ok: boolean }>(`/v1/admin/residency/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ region }),
    })
    if (!res.ok) {
      toast.error('Failed to update region', res.error?.message)
      return
    }
    toast.success(`Region pinned to ${region.toUpperCase()}`)
    reloadAll()
  }

  // De-duplicate evidence rows so we only render the latest snapshot per
  // (project, control). A non-trivial DB can hold weeks of history under
  // the same control id; rendering all of them on this page would drown
  // the auditor in noise. Sorted by control then project for stable scan.
  const latestEvidenceByControl = useMemo(() => {
    const map = new Map<string, Evidence>()
    for (const ev of evidence) {
      const key = `${ev.project_id}:${ev.control}`
      const existing = map.get(key)
      if (!existing || existing.generated_at < ev.generated_at) map.set(key, ev)
    }
    // Sort fail → warn → pass so the most actionable rows scan first.
    const STATUS_RANK: Record<Evidence['status'], number> = { fail: 0, warn: 1, pass: 2 }
    return [...map.values()].sort((a, b) => {
      const r = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (r !== 0) return r
      return a.control.localeCompare(b.control) || a.project_id.localeCompare(b.project_id)
    })
  }, [evidence])

  const refreshEvidence = async () => {
    setRefreshing(true)
    try {
      const res = await apiFetch('/v1/admin/compliance/evidence/refresh', { method: 'POST' })
      if (!res.ok) {
        toast.error('Could not refresh evidence', res.error?.message)
        return
      }
      toast.success('Evidence snapshot generated')
      reloadAll()
    } finally {
      setRefreshing(false)
    }
  }

  const updatePolicy = async (projectId: string, patch: Partial<RetentionPolicy>) => {
    const res = await apiFetch(`/v1/admin/compliance/retention/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      toast.error('Could not update retention policy', res.error?.message)
      return
    }
    toast.success('Retention policy updated')
    reloadAll()
  }

  const setDsarStatus = async (
    id: string,
    status: Dsar['status'],
    extra: { rejection_reason?: string } = {},
  ) => {
    const res = await apiFetch(`/v1/admin/compliance/dsars/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...extra }),
    })
    if (!res.ok) {
      toast.error('Could not update DSAR', res.error?.message)
      return false
    }
    toast.success(`DSAR marked ${status.replace('_', ' ')}`)
    dsarsQuery.reload()
    return true
  }

  const confirmRejection = async (reason: string) => {
    if (!rejectingDsar) return
    if (!reason) {
      toast.error('A rejection reason is required for the audit trail')
      return
    }
    setRejectingBusy(true)
    const ok = await setDsarStatus(rejectingDsar.id, 'rejected', { rejection_reason: reason })
    setRejectingBusy(false)
    if (ok) setRejectingDsar(null)
  }

  const fileDsar = async () => {
    if (!dsarForm.subjectEmail.trim()) {
      toast.error('Subject email is required')
      return
    }
    if (!setup.activeProject) {
      toast.error('No project selected', 'Pick a project in the header switcher before filing a DSAR.')
      return
    }
    setFiling(true)
    const res = await apiFetch('/v1/admin/compliance/dsars', {
      method: 'POST',
      body: JSON.stringify({
        projectId: setup.activeProject.project_id,
        request_type: dsarForm.requestType,
        subject_email: dsarForm.subjectEmail.trim(),
        subject_id: dsarForm.subjectId.trim() || undefined,
        notes: dsarForm.notes.trim() || undefined,
      }),
    })
    setFiling(false)
    if (!res.ok) {
      toast.error('Could not file DSAR', res.error?.message)
      return
    }
    toast.success('DSAR filed', 'Auditor evidence row was created')
    setDsarForm({ requestType: 'access', subjectEmail: '', subjectId: '', notes: '' })
    dsarsQuery.reload()
  }

  // ── Derivations used by the hero, the chip rail, and the cards ──────────
  const failEvidenceCount = latestEvidenceByControl.filter((e) => e.status === 'fail').length
  const warnEvidenceCount = latestEvidenceByControl.filter((e) => e.status === 'warn').length
  const openDsars = useMemo(() => dsars.filter(dsarIsOpen), [dsars])
  const overdueDsars = useMemo(
    () => openDsars.filter((d) => daysSince(d.created_at) >= GDPR_SLA_DAYS - 9),
    [openDsars],
  )
  const legalHoldPolicies = useMemo(() => policies.filter((p) => p.legal_hold), [policies])
  const latestEvidenceTs = latestEvidenceByControl.reduce<string | null>(
    (acc, e) => (!acc || e.generated_at > acc ? e.generated_at : acc),
    null,
  )

  // Counts shown next to each chip — these read live from the *unfiltered*
  // server data so the user always knows how much work is hiding behind a
  // chip before they click.
  const filterCounts: Record<ComplianceFilter, number | null> = {
    all: null,
    open: openDsars.length + failEvidenceCount + warnEvidenceCount,
    fail: failEvidenceCount + overdueDsars.length,
    warn: warnEvidenceCount,
    legal_hold: legalHoldPolicies.length,
  }

  // Per-card row filtering. We split the predicates per section so a single
  // chip can reshape the page without each table reaching for its own copy
  // of the rules.
  const visibleEvidence = useMemo(() => {
    if (effectiveFilter === 'fail') return latestEvidenceByControl.filter((e) => e.status === 'fail')
    if (effectiveFilter === 'warn') return latestEvidenceByControl.filter((e) => e.status === 'warn')
    if (effectiveFilter === 'open') return latestEvidenceByControl.filter((e) => e.status !== 'pass')
    if (effectiveFilter === 'legal_hold') return []
    return latestEvidenceByControl
  }, [effectiveFilter, latestEvidenceByControl])

  const visibleDsars = useMemo(() => {
    if (effectiveFilter === 'fail') return overdueDsars
    if (effectiveFilter === 'warn')
      return openDsars.filter((d) => {
        const age = daysSince(d.created_at)
        return age >= 14 && age < GDPR_SLA_DAYS - 9
      })
    if (effectiveFilter === 'open') return openDsars
    if (effectiveFilter === 'legal_hold') return []
    return dsars
  }, [effectiveFilter, dsars, openDsars, overdueDsars])

  const visiblePolicies = useMemo(() => {
    if (effectiveFilter === 'legal_hold') return legalHoldPolicies
    if (effectiveFilter === 'fail' || effectiveFilter === 'warn' || effectiveFilter === 'open') return []
    return policies
  }, [effectiveFilter, policies, legalHoldPolicies])

  const showEvidenceSection =
    activeTab === 'overview' || activeTab === 'evidence'
      ? effectiveFilter === 'all' ||
        effectiveFilter === 'open' ||
        effectiveFilter === 'fail' ||
        effectiveFilter === 'warn'
      : false
  const showResidencyCard =
    (activeTab === 'overview' || activeTab === 'residency') && effectiveFilter === 'all'
  const showRetentionSection =
    (activeTab === 'overview' || activeTab === 'retention') &&
    (effectiveFilter === 'all' || effectiveFilter === 'legal_hold')
  const showDsarsSection =
    activeTab === 'overview' || activeTab === 'dsars'
      ? effectiveFilter === 'all' ||
        effectiveFilter === 'open' ||
        effectiveFilter === 'fail' ||
        effectiveFilter === 'warn'
      : false

  const criticalCount =
    (stats.soc2Entitlement ? 0 : 1) +
    stats.controlsFail +
    stats.overdueDsars +
    (stats.evidenceNeverGenerated && stats.soc2Entitlement ? 1 : 0)

  usePublishPageContext({
    route: '/compliance',
    title: `${activeTabMeta.label} · Compliance`,
    summary: activeTabMeta.description,
    filters: {
      tab: activeTab,
      status: filter !== 'all' ? filter : undefined,
      project_id: activeProjectId ?? undefined,
    },
    criticalCount,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'evidence' as const,
        label: 'Evidence',
        count: stats.controlsFail > 0 ? stats.controlsFail : stats.controlsTotal > 0 ? stats.controlsTotal : undefined,
      },
      {
        id: 'retention' as const,
        label: 'Retention',
        count: stats.legalHoldCount > 0 ? stats.legalHoldCount : undefined,
      },
      {
        id: 'dsars' as const,
        label: 'DSARs',
        count: stats.openDsars > 0 ? stats.openDsars : undefined,
      },
      { id: 'residency' as const, label: 'Residency' },
    ],
    [stats.controlsFail, stats.controlsTotal, stats.legalHoldCount, stats.openDsars],
  )

  const complianceAction = useNextBestAction({
    scope: 'compliance',
    openControls: openDsars.length,
    nextReviewInDays: null,
  })
  const complianceSeverity: 'ok' | 'warn' | 'crit' =
    failEvidenceCount > 0 || overdueDsars.length > 0
      ? 'crit'
      : warnEvidenceCount > 0 || openDsars.length > 0
        ? 'warn'
        : 'ok'

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={copy?.title ?? 'Compliance'}
          description={
            copy?.description ??
            'Track GDPR, SOC 2, retention, residency, and DSAR obligations for the active project.'
          }
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Compliance evidence and DSAR queues are scoped to the active project — pick mushi-mushi (or your app) first."
        />
      </div>
    )
  }

  if (statsLoading && !statsData) {
    return <PanelSkeleton rows={6} label="Loading compliance" />
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load compliance stats: ${statsError}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Compliance'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        description={
          copy?.description ??
          'Track GDPR, SOC 2, retention, residency, and DSAR obligations for the active project.'
        }
      >
        {stats.soc2Entitlement ? (
          <Badge className="bg-ok-muted text-ok">SOC 2 enabled</Badge>
        ) : (
          <Badge className="bg-warn/10 text-warn">{stats.planDisplayName} — upgrade for compliance</Badge>
        )}
        <Btn onClick={refreshEvidence} disabled={refreshing} loading={refreshing} data-dav-anchor="compliance:act">
          Refresh evidence
        </Btn>
        <Btn variant="ghost" onClick={() => window.print()} title="Renders the page via @media print so you can save as PDF">
          Export PDF
        </Btn>
        <TableDensityToggle />
      </PageHeader>

      <ComplianceStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onFilter={setFilterFromBanner}
        onRefreshEvidence={refreshEvidence}
        refreshing={refreshing}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Compliance sections"
        size="sm"
      />

      <Section title="Compliance snapshot" freshness={{ at: lastFetchedAt, isValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeTabMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Controls"
            value={`${stats.controlsPass}/${stats.controlsTotal}`}
            accent={stats.controlsFail > 0 ? 'text-danger' : stats.controlsWarn > 0 ? 'text-warn' : stats.controlsTotal > 0 ? 'text-ok' : undefined}
            tooltip={controlsTooltip(stats)}
            detail={controlsDetail(stats)}
          />
          <StatCard
            label="Open DSARs"
            value={stats.openDsars}
            accent={stats.overdueDsars > 0 ? 'text-danger' : stats.atRiskDsars > 0 ? 'text-warn' : undefined}
            tooltip={openDsarsTooltip(stats)}
            detail={openDsarsDetail(stats)}
          />
          <StatCard
            label="Legal holds"
            value={stats.legalHoldCount}
            accent={stats.legalHoldCount > 0 ? 'text-info' : undefined}
            tooltip={legalHoldsTooltip(stats)}
            detail={legalHoldsDetail(stats)}
          />
          <StatCard
            label="Cluster"
            value={(stats.activeProjectRegion ?? stats.currentRegion).toUpperCase()}
            accent="text-brand"
            tooltip={clusterRegionTooltip(stats)}
            detail={clusterRegionDetail(stats)}
          />
        </div>
      </Section>

      {activeTab === 'overview' && (
      <>
      <PageHero
        scope="compliance"
        title="Compliance"
        kicker="SOC 2 · GDPR · residency"
        decide={{
          label:
            failEvidenceCount > 0
              ? `${failEvidenceCount} control${failEvidenceCount === 1 ? '' : 's'} failing evidence`
              : overdueDsars.length > 0
                ? `${overdueDsars.length} DSAR${overdueDsars.length === 1 ? '' : 's'} approaching 30-day SLA`
                : warnEvidenceCount > 0
                  ? `${warnEvidenceCount} WARN${warnEvidenceCount === 1 ? '' : 's'} to triage`
                  : openDsars.length > 0
                    ? `${openDsars.length} open DSAR${openDsars.length === 1 ? '' : 's'}`
                    : 'Compliant',
          metric:
            failEvidenceCount > 0
              ? `${failEvidenceCount} fail`
              : overdueDsars.length > 0
                ? `${overdueDsars.length} overdue`
                : warnEvidenceCount > 0
                  ? `${warnEvidenceCount} warn`
                  : openDsars.length > 0
                    ? `${openDsars.length} open`
                    : `${latestEvidenceByControl.length} green`,
          summary:
            failEvidenceCount > 0
              ? 'One or more controls missed their evidence check — remediate before the next audit.'
              : overdueDsars.length > 0
                ? 'Open DSARs are within 9 days of the 30-day GDPR fulfilment deadline.'
                : warnEvidenceCount > 0
                  ? 'Evidence rows flagged with warnings — investigate before they escalate.'
                  : openDsars.length > 0
                    ? 'DSARs must resolve within 30 days under GDPR / CCPA.'
                    : 'Controls, DSARs, and retention windows are all green.',
          severity: complianceSeverity,
          anchor: 'compliance:decide',
          evidence: {
            kind: 'metric-breakdown',
            items: [
              { label: 'Controls green', value: latestEvidenceByControl.length - failEvidenceCount - warnEvidenceCount, tone: 'ok' },
              { label: 'Controls warn', value: warnEvidenceCount, tone: warnEvidenceCount > 0 ? 'warn' : 'neutral' },
              { label: 'Controls fail', value: failEvidenceCount, tone: failEvidenceCount > 0 ? 'crit' : 'ok' },
              { label: 'Open DSARs', value: openDsars.length, tone: overdueDsars.length > 0 ? 'crit' : openDsars.length > 0 ? 'warn' : 'ok' },
            ],
          },
          missingConfigIds: failEvidenceCount > 0 || overdueDsars.length > 0 ? ['compliance.legal_hold'] : [],
        }}
        act={complianceAction}
        actAnchor="compliance:act"
        actEvidence={complianceAction ? { kind: 'rule-trace', why: complianceAction.reason ?? complianceAction.title } : undefined}
        verify={{
          label: 'Latest evidence snapshot',
          detail: latestEvidenceTs ? new Date(latestEvidenceTs).toLocaleString() : 'no snapshot yet',
          to: '/audit?scope=compliance',
          secondaryTo: '/compliance?status=fail',
          secondaryLabel: failEvidenceCount > 0 ? 'Open failing controls' : undefined,
          anchor: 'compliance:verify',
          evidence: latestEvidenceTs ? {
            kind: 'last-event',
            at: latestEvidenceTs,
            by: 'evidence-sweep cron',
            payloadSummary: `${latestEvidenceByControl.length} controls · ${failEvidenceCount} fail · ${warnEvidenceCount} warn`,
            status: failEvidenceCount > 0 ? 'error' : warnEvidenceCount > 0 ? 'warn' : 'ok',
          } : undefined,
        }}
      />

      <PageActionBar scope="compliance" action={complianceAction} />

      <PageHelp
        title={copy?.help?.title ?? 'About Compliance'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'SOC 2 Type 1 readiness — control evidence, retention windows, and Data Subject Access Request (DSAR) audit trail.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Demonstrate per-control evidence to your auditor at a single glance',
            'Tune per-project data retention windows and place projects on legal hold',
            'Track and fulfil GDPR/CCPA data subject requests within 30 days',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Evidence is auto-generated nightly at 04:30 UTC. Retention sweeps run nightly at 03:30 UTC. Click Refresh evidence to take an on-demand snapshot.'
        }
      />

      {/* URL-driven status filter. Deep links from the Next-Best-Action
          (e.g. /compliance?status=open) drop the user straight onto the
          relevant view. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_VALUES.map((f) => (
          <FilterChip
            key={f}
            label={FILTER_LABELS[f]}
            count={filterCounts[f] ?? undefined}
            active={filter === f}
            tone={FILTER_TONES[f]}
            hint={FILTER_HINTS[f]}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>
      </>
      )}

      {activeTab !== 'overview' ? (
        <PageHelp
          title={copy?.help?.title ?? 'About Compliance'}
          whatIsIt={activeTabMeta.description}
          useCases={copy?.help?.useCases ?? []}
          howToUse={copy?.help?.howToUse ?? 'Use Refresh evidence for on-demand SOC 2 snapshots.'}
        />
      ) : null}

      {loading ? <PanelSkeleton rows={5} label="Loading compliance data" /> : error ? (
        <ErrorAlert message={`Failed to load ${merged.failedLabel ?? 'compliance data'}: ${error}`} onRetry={merged.retry} />
      ) : (
        <>
          {/* Filter-wide empty state — shown when every section the filter
              would render comes back empty. Avoids the "I clicked Open and
              the page looks dead" UX. */}
          {filter !== 'all' &&
            visibleEvidence.length === 0 &&
            visibleDsars.length === 0 &&
            visiblePolicies.length === 0 && (
              <Card className="p-6">
                <EmptyState
                  title={
                    filter === 'open'
                      ? 'All clear — no open compliance items'
                      : filter === 'fail'
                        ? 'No failing controls or overdue DSARs'
                        : filter === 'warn'
                          ? 'No at-risk items'
                          : 'No projects on legal hold'
                  }
                  description={
                    filter === 'legal_hold'
                      ? 'Place a project on legal hold from the All view to suspend its retention sweeps.'
                      : `Last evidence snapshot ${latestEvidenceTs ? new Date(latestEvidenceTs).toLocaleString() : 'has not been generated yet'}.`
                  }
                />
              </Card>
            )}

          {showEvidenceSection && (
            <Card className="p-5">
              <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
                <div className="text-xs font-medium uppercase tracking-wider">
                  Latest control evidence
                  {filter !== 'all' && (
                    <span className="ml-2 text-2xs font-normal opacity-60">
                      filtered to {FILTER_LABELS[filter].toLowerCase()}
                    </span>
                  )}
                </div>
                {visibleEvidence.length > 0 && (
                  <span className="text-2xs opacity-70">
                    {visibleEvidence.length} of {latestEvidenceByControl.length}
                  </span>
                )}
              </div>
              {visibleEvidence.length === 0 ? (
                <EmptyState
                  title={
                    filter === 'fail'
                      ? 'No failing controls'
                      : filter === 'warn'
                        ? 'No warning controls'
                        : filter === 'open'
                          ? 'No open controls'
                          : 'No evidence rows yet'
                  }
                  description={
                    filter === 'all'
                      ? 'Click Refresh evidence to generate the first snapshot.'
                      : 'Switch to All to see the full evidence pack.'
                  }
                />
              ) : (
                <ResponsiveTable>
                  <table className="w-full text-xs" data-dav-anchor="compliance:decide">
                    <thead className="text-fg-muted uppercase tracking-wider text-3xs">
                      <tr className="border-b border-edge-subtle">
                        <th className="py-1.5 text-left">Control</th>
                        <th className="text-left">Label</th>
                        <th className="text-left">Project</th>
                        <th className="text-left">Status</th>
                        <th className="text-left">Generated</th>
                        <th className="text-right">Payload</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEvidence.map((ev) => (
                        <tr key={ev.id} className="border-b border-edge-subtle/40">
                          <td className="py-1.5 font-mono">{ev.control}</td>
                          <td>{ev.control_label}</td>
                          <td className="opacity-80">
                            {projectNameById.get(ev.project_id) ?? (
                              <code className="text-2xs opacity-60">{ev.project_id.slice(0, 8)}</code>
                            )}
                          </td>
                          <td>
                            <span className={`inline-flex rounded px-2 py-0.5 text-3xs ${STATUS_CHIP[ev.status]}`}>
                              {ev.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="opacity-70">{new Date(ev.generated_at).toLocaleString()}</td>
                          <td className="text-right">
                            <Btn
                              size="sm"
                              variant="ghost"
                              onClick={() => setPayloadModalEvidence(ev)}
                              aria-label={`View ${ev.control} payload`}
                              title="View full evidence payload"
                              className="!px-1.5"
                            >
                              <IconEye />
                            </Btn>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )}
            </Card>
          )}

          {showResidencyCard && (
            <Card className="p-5">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs font-medium uppercase tracking-wider inline-flex items-center gap-1">
                  Data residency
                  <ConfigHelp helpId="compliance.residency.region" />
                </div>
                <span className="text-2xs opacity-70">This cluster: <code className="font-mono uppercase">{currentRegion}</code></span>
              </div>
              <p className="text-2xs text-fg-muted mb-3 max-w-2xl leading-relaxed">
                Pin a project to a specific regional cluster (US / EU / JP). Once set, the gateway transparently
                307-redirects cross-region calls. Changing the region of a project that already has data requires
                an export+restore migration — contact support.
              </p>
              {residency.length === 0 ? (
                <EmptyState title="No projects" />
              ) : (
                <div className="space-y-2">
                  {residency.map((p) => {
                    const pinned = p.data_residency_region
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-3 rounded border border-edge-subtle p-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{p.name}</div>
                          <code className="text-2xs opacity-70 font-mono">{p.id}</code>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {pinned ? (
                            <>
                              {/* Show the active region as a locked chip */}
                              <span className="inline-flex items-center rounded px-2 py-1 text-3xs uppercase font-mono bg-brand text-brand-fg border border-brand">
                                {pinned}
                              </span>
                              {/* Disabled buttons for the other regions with a tooltip */}
                              {(['us', 'eu', 'jp', 'self'] as const)
                                .filter((r) => r !== pinned)
                                .map((r) => (
                                  <button
                                    key={r}
                                    disabled
                                    title="Region is locked — contact support to migrate data between regions."
                                    className="px-2 py-1 text-3xs uppercase font-mono rounded border border-edge-subtle text-fg-faint cursor-not-allowed opacity-40"
                                  >
                                    {r}
                                  </button>
                                ))}
                              <span className="text-2xs text-fg-muted ml-1">Locked</span>
                            </>
                          ) : (
                            /* No region pinned yet — all four buttons are active */
                            (['us', 'eu', 'jp', 'self'] as const).map((r) => (
                              <button
                                key={r}
                                onClick={() => setProjectRegion(p.id, r)}
                                className="px-2 py-1 text-3xs uppercase font-mono rounded border border-edge-subtle text-fg-muted hover:text-fg hover:border-edge"
                              >
                                {r}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )}

          {showRetentionSection && (
            <Card className="p-5">
              <div className="text-xs font-medium uppercase tracking-wider mb-2">
                Retention policies
                {filter === 'legal_hold' && (
                  <span className="ml-2 text-2xs font-normal opacity-60">
                    showing legal-hold projects only
                  </span>
                )}
              </div>
              {visiblePolicies.length === 0 ? (
                <EmptyState
                  title={
                    filter === 'legal_hold'
                      ? 'No projects on legal hold'
                      : 'No retention policies set'
                  }
                  description={
                    filter === 'legal_hold'
                      ? undefined
                      : 'Defaults of 365d (reports) / 730d (audit) apply until you save a policy.'
                  }
                />
              ) : (
                <div className="space-y-2">
                  {visiblePolicies.map((p) => (
                    <div key={p.project_id} className="rounded border border-edge-subtle p-2">
                      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">
                            {projectNameById.get(p.project_id) ?? 'Project'}
                          </div>
                          <code className="text-2xs opacity-60 font-mono">{p.project_id}</code>
                        </div>
                        <div className="inline-flex items-center gap-1">
                          {p.legal_hold && (
                            <span className="inline-flex rounded px-2 py-0.5 text-3xs bg-info/15 text-info border border-info/30">
                              LEGAL HOLD
                            </span>
                          )}
                          <Btn
                            size="sm"
                            variant={p.legal_hold ? 'danger' : 'ghost'}
                            onClick={() => updatePolicy(p.project_id, { legal_hold: !p.legal_hold })}
                          >
                            {p.legal_hold ? 'Lift legal hold' : 'Place on legal hold'}
                          </Btn>
                          <ConfigHelp helpId="compliance.legal_hold" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <RetentionInput
                          label="Reports"
                          helpId="compliance.retention.reports_days"
                          value={p.reports_retention_days}
                          onChange={(v) => updatePolicy(p.project_id, { reports_retention_days: v })}
                        />
                        <RetentionInput
                          label="Audit"
                          helpId="compliance.retention.audit_days"
                          value={p.audit_retention_days}
                          onChange={(v) => updatePolicy(p.project_id, { audit_retention_days: v })}
                        />
                        <RetentionInput
                          label="LLM traces"
                          helpId="compliance.retention.events_days"
                          value={p.llm_traces_retention_days}
                          onChange={(v) => updatePolicy(p.project_id, { llm_traces_retention_days: v })}
                        />
                        <RetentionInput
                          label="BYOK audit"
                          helpId="compliance.retention.attachments_days"
                          value={p.byok_audit_retention_days}
                          onChange={(v) => updatePolicy(p.project_id, { byok_audit_retention_days: v })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {showDsarsSection && (
            <Card className="p-5">
              <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
                <div className="text-xs font-medium uppercase tracking-wider">
                  Data subject requests
                  {filter !== 'all' && (
                    <span className="ml-2 text-2xs font-normal opacity-60">
                      filtered to {FILTER_LABELS[filter].toLowerCase()}
                    </span>
                  )}
                </div>
                <p className="text-2xs text-fg-muted max-w-md">
                  File a request when a user invokes their GDPR/CCPA right to access, export, deletion, or rectification.
                  Mark it complete within {GDPR_SLA_DAYS} days to stay compliant.
                </p>
              </div>

              {/* Filing form is hidden on focused views — the user clicked
                  "Open" because they want to clear work, not file new
                  requests. Available again on the All view. */}
              {effectiveFilter === 'all' && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3 border border-edge-subtle rounded-sm p-2 bg-surface-overlay">
                  <SelectField
                    label="Request type"
                    value={dsarForm.requestType}
                    onChange={(e) => setDsarForm((f) => ({ ...f, requestType: e.target.value as Dsar['request_type'] }))}
                  >
                    <option value="access">Access</option>
                    <option value="export">Export</option>
                    <option value="deletion">Deletion</option>
                    <option value="rectification">Rectification</option>
                  </SelectField>
                  <Input
                    label="Subject email"
                    helpId="compliance.dsar.subject_email"
                    placeholder="user@example.com"
                    value={dsarForm.subjectEmail}
                    onChange={(e) => setDsarForm((f) => ({ ...f, subjectEmail: e.target.value }))}
                  />
                  <Input
                    label="Subject user ID (optional)"
                    placeholder="auth-user-uuid"
                    value={dsarForm.subjectId}
                    onChange={(e) => setDsarForm((f) => ({ ...f, subjectId: e.target.value }))}
                  />
                  <Input
                    label="Notes (optional)"
                    placeholder="Channel, ticket ref, etc."
                    value={dsarForm.notes}
                    onChange={(e) => setDsarForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                  <div className="md:col-span-4 flex justify-end">
                    <Btn size="sm" onClick={fileDsar} disabled={filing} loading={filing}>
                      File DSAR
                    </Btn>
                  </div>
                </div>
              )}

              {visibleDsars.length === 0 ? (
                <EmptyState
                  title={
                    filter === 'fail'
                      ? 'No DSARs are overdue'
                      : filter === 'warn'
                        ? 'No DSARs at risk'
                        : filter === 'open'
                          ? 'No open DSARs'
                          : 'No DSARs filed yet'
                  }
                />
              ) : (
                <ResponsiveTable>
                  <table className="w-full text-xs" data-dav-anchor="compliance:verify">
                    <thead className="text-fg-muted uppercase tracking-wider text-3xs">
                      <tr className="border-b border-edge-subtle">
                        <th className="py-1.5 text-left">Type</th>
                        <th className="text-left">Subject</th>
                        <th className="text-left">Project</th>
                        <th className="text-left">Status</th>
                        <th className="text-left">Filed</th>
                        <th className="text-left">Age</th>
                        <th className="text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDsars.map((d) => {
                        const age = daysSince(d.created_at)
                        const open = dsarIsOpen(d)
                        const overdue = open && age >= GDPR_SLA_DAYS
                        const atRisk = open && age >= GDPR_SLA_DAYS - 9 && age < GDPR_SLA_DAYS
                        const ageClass = overdue
                          ? 'text-danger font-medium'
                          : atRisk
                            ? 'text-warn font-medium'
                            : 'opacity-70'
                        return (
                          <tr
                            key={d.id}
                            className="border-b border-edge-subtle/40 align-top"
                            title={
                              d.rejection_reason
                                ? `Rejected: ${d.rejection_reason}`
                                : d.evidence_url
                                  ? `Evidence: ${d.evidence_url}`
                                  : undefined
                            }
                          >
                            <td className="py-1.5 capitalize">{d.request_type}</td>
                            <td>
                              <div className="flex flex-col gap-0.5">
                                <span>{d.subject_email}</span>
                                {d.subject_id && (
                                  <code className="text-3xs opacity-60 font-mono truncate max-w-[14rem]">
                                    {d.subject_id}
                                  </code>
                                )}
                              </div>
                            </td>
                            <td className="opacity-80">
                              {projectNameById.get(d.project_id) ?? (
                                <code className="text-2xs opacity-60">{d.project_id.slice(0, 8)}</code>
                              )}
                            </td>
                            <td>
                              <span
                                className={`inline-flex rounded px-2 py-0.5 text-3xs uppercase tracking-wider font-medium ${DSAR_STATUS_CHIP[d.status]}`}
                              >
                                {d.status.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="opacity-70">{new Date(d.created_at).toLocaleString()}</td>
                            <td className={ageClass}>
                              {age}d
                              {overdue && <span className="ml-1 text-3xs">overdue</span>}
                              {atRisk && <span className="ml-1 text-3xs">at risk</span>}
                            </td>
                            <td>
                              {open ? (
                                <div className="flex flex-wrap gap-1">
                                  {d.status === 'pending' && (
                                    <Btn
                                      size="sm"
                                      variant="success"
                                      onClick={() => setDsarStatus(d.id, 'in_progress')}
                                    >
                                      Start triage
                                    </Btn>
                                  )}
                                  <Btn
                                    size="sm"
                                    variant="success"
                                    onClick={() => setDsarStatus(d.id, 'completed')}
                                  >
                                    Complete
                                  </Btn>
                                  <Btn size="sm" variant="danger" onClick={() => setRejectingDsar(d)}>
                                    Reject…
                                  </Btn>
                                </div>
                              ) : d.rejection_reason ? (
                                <span className="text-2xs opacity-70 italic line-clamp-2 max-w-[18rem]">
                                  {d.rejection_reason}
                                </span>
                              ) : d.evidence_url ? (
                                <a
                                  href={d.evidence_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-info underline text-2xs"
                                >
                                  Evidence ↗
                                </a>
                              ) : (
                                <span className="opacity-40">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )}
            </Card>
          )}
        </>
      )}

      {/* Evidence payload modal — auditors usually need the raw JSON to
          verify a finding. The truncated 120-char preview in the table is
          a navigation cue; this modal is the source of truth. */}
      <Modal
        open={payloadModalEvidence !== null}
        onClose={() => setPayloadModalEvidence(null)}
        title={
          payloadModalEvidence
            ? `${payloadModalEvidence.control} · ${payloadModalEvidence.control_label}`
            : 'Evidence payload'
        }
        size="lg"
        headerAction={
          payloadModalEvidence && (
            <span className={`inline-flex rounded px-2 py-0.5 text-3xs ${STATUS_CHIP[payloadModalEvidence.status]}`}>
              {payloadModalEvidence.status.toUpperCase()}
            </span>
          )
        }
        footer={
          payloadModalEvidence && (
            <div className="flex items-center justify-between gap-2 text-2xs opacity-70">
              <span>
                Project:{' '}
                {projectNameById.get(payloadModalEvidence.project_id) ?? payloadModalEvidence.project_id}
              </span>
              <span>{new Date(payloadModalEvidence.generated_at).toLocaleString()}</span>
            </div>
          )
        }
      >
        {payloadModalEvidence && (
          <pre className="text-2xs leading-snug whitespace-pre-wrap break-words bg-surface-overlay border border-edge-subtle rounded-sm p-3 font-mono">
{JSON.stringify(payloadModalEvidence.payload, null, 2)}
          </pre>
        )}
      </Modal>

      {/* DSAR rejection prompt. We intentionally make rejection_reason
          required at the UI layer because SOC 2 CC8.1 expects every closed
          DSAR to have a documented disposition — leaving it null silently
          would later trip the auditor's WARN heuristic. */}
      {rejectingDsar && (
        <PromptDialog
          title="Reject DSAR"
          body={`Recording a rejection reason for ${rejectingDsar.subject_email}. This is written to the audit log under compliance.dsar.updated.`}
          label="Rejection reason"
          placeholder="e.g. Subject not found in our records; identity could not be verified."
          confirmLabel="Reject DSAR"
          loading={rejectingBusy}
          validate={(v) => (v.length < 4 ? 'Reason must be at least 4 characters' : null)}
          onConfirm={confirmRejection}
          onCancel={() => (rejectingBusy ? undefined : setRejectingDsar(null))}
        />
      )}
    </div>
  )
}

function RetentionInput({ label, value, onChange, helpId }: { label: string; value: number; onChange: (v: number) => void; helpId?: string }) {
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync draft when the canonical server value changes (e.g. after a save round-trip
  // clamps the value, or another admin edits it). Skip while focused so we never
  // wipe out what the user is mid-typing.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return
    setDraft(String(value))
  }, [value])

  return (
    <label className="flex flex-col gap-1 text-3xs">
      <span className="opacity-60 uppercase tracking-wider inline-flex items-center gap-1">
        <span>{label} (days)</span>
        {helpId && <ConfigHelp helpId={helpId} />}
      </span>
      <input
        ref={inputRef}
        type="number"
        min={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseInt(draft, 10)
          if (Number.isFinite(n) && n > 0 && n !== value) onChange(n)
          else setDraft(String(value))
        }}
        className="bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs"
      />
    </label>
  )
}
