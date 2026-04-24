import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useMergedErrors } from '../lib/useMergedErrors'
import { PageHeader, PageHelp, Card, Btn, ErrorAlert, EmptyState, Input, SelectField } from '../components/ui'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { ResponsiveTable, TableDensityToggle } from '../components/ResponsiveTable'
import { useToast } from '../lib/toast'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PageActionBar } from '../components/PageActionBar'
import { useNextBestAction } from '../lib/useNextBestAction'
import { PageHero } from '../components/PageHero'

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

export function CompliancePage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const policiesQuery = usePageData<{ policies: RetentionPolicy[] }>('/v1/admin/compliance/retention')
  const dsarsQuery = usePageData<{ requests: Dsar[] }>('/v1/admin/compliance/dsars')
  const evidenceQuery = usePageData<{ evidence: Evidence[] }>('/v1/admin/compliance/evidence')
  const residencyQuery = usePageData<{ projects: ResidencyProject[]; currentRegion: string }>(
    '/v1/admin/residency',
  )

  const policies = policiesQuery.data?.policies ?? []
  const dsars = dsarsQuery.data?.requests ?? []
  const evidence = evidenceQuery.data?.evidence ?? []
  const residency = residencyQuery.data?.projects ?? []
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
    policiesQuery.reload()
    dsarsQuery.reload()
    evidenceQuery.reload()
    residencyQuery.reload()
  }, [policiesQuery, dsarsQuery, evidenceQuery, residencyQuery])

  const [refreshing, setRefreshing] = useState(false)
  const [filing, setFiling] = useState(false)
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

  const latestEvidenceByControl = useMemo(() => {
    const map = new Map<string, Evidence>()
    for (const ev of evidence) {
      const key = `${ev.project_id}:${ev.control}`
      const existing = map.get(key)
      if (!existing || existing.generated_at < ev.generated_at) map.set(key, ev)
    }
    return [...map.values()].sort((a, b) =>
      a.control.localeCompare(b.control) || a.project_id.localeCompare(b.project_id),
    )
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

  const setDsarStatus = async (id: string, status: Dsar['status']) => {
    const res = await apiFetch(`/v1/admin/compliance/dsars/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      toast.error('Could not update DSAR', res.error?.message)
      return
    }
    toast.success(`DSAR marked ${status}`)
    dsarsQuery.reload()
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
    // Backend expects snake_case + explicit projectId.
    // the previous camelCase body produced a persistent 400 from the validator.
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

  // IA-4 (Wave S, 2026-04-23): compute hero inputs up front so we can
  // feed both the PageHero "Decide / Act / Verify" tiles and the compact
  // PageActionBar from the same derived state. Keeping the derivations
  // here (rather than in the JSX) avoids useNextBestAction being invoked
  // conditionally and keeps Rules of Hooks happy when the hero renders.
  const openControlCount = dsars.filter(
    (d) => d.status !== 'completed' && d.status !== 'rejected',
  ).length
  const failEvidenceCount = latestEvidenceByControl.filter((e) => e.status === 'fail').length
  const warnEvidenceCount = latestEvidenceByControl.filter((e) => e.status === 'warn').length
  const latestEvidenceTs = latestEvidenceByControl.reduce<string | null>(
    (acc, e) => (!acc || e.generated_at > acc ? e.generated_at : acc),
    null,
  )
  const complianceAction = useNextBestAction({
    scope: 'compliance',
    openControls: openControlCount,
    nextReviewInDays: null,
  })
  const complianceSeverity: 'ok' | 'warn' | 'crit' =
    failEvidenceCount > 0 ? 'crit' : warnEvidenceCount > 0 || openControlCount > 0 ? 'warn' : 'ok'

  return (
    <div className="space-y-3">
      <PageHeader
        title="Compliance"
        projectScope={projectName}
        description="Track GDPR, SOC2, and audit obligations against the data Mushi holds for this project."
      >
        <Btn onClick={refreshEvidence} disabled={refreshing} loading={refreshing}>
          Refresh evidence
        </Btn>
        <Btn variant="ghost" onClick={() => window.print()} title="Renders the page via @media print so you can save as PDF">
          Export PDF
        </Btn>
        <TableDensityToggle />
      </PageHeader>

      <PageHero
        scope="compliance"
        title="Compliance"
        kicker="SOC 2 · GDPR · residency"
        decide={{
          label:
            failEvidenceCount > 0
              ? `${failEvidenceCount} control${failEvidenceCount === 1 ? '' : 's'} failing evidence`
              : warnEvidenceCount > 0
                ? `${warnEvidenceCount} WARN${warnEvidenceCount === 1 ? '' : 's'} to triage`
                : openControlCount > 0
                  ? `${openControlCount} open DSAR${openControlCount === 1 ? '' : 's'}`
                  : 'Compliant',
          metric:
            failEvidenceCount > 0
              ? `${failEvidenceCount} fail`
              : warnEvidenceCount > 0
                ? `${warnEvidenceCount} warn`
                : openControlCount > 0
                  ? `${openControlCount} open`
                  : `${latestEvidenceByControl.length} green`,
          summary:
            failEvidenceCount > 0
              ? 'One or more controls missed their evidence check — remediate before the next audit.'
              : warnEvidenceCount > 0
                ? 'Evidence rows flagged with warnings — investigate before they escalate.'
                : openControlCount > 0
                  ? 'DSARs must resolve within 30 days under GDPR / CCPA.'
                  : 'Controls, DSARs, and retention windows are all green.',
          severity: complianceSeverity,
        }}
        act={complianceAction}
        verify={{
          label: 'Latest evidence snapshot',
          detail: latestEvidenceTs ? new Date(latestEvidenceTs).toLocaleString() : 'no snapshot yet',
          to: '/audit?scope=compliance',
          secondaryTo: '/compliance?status=fail',
          secondaryLabel: failEvidenceCount > 0 ? 'Open failing controls' : undefined,
        }}
      />

      <PageActionBar scope="compliance" action={complianceAction} />

      <PageHelp
        title="About Compliance"
        whatIsIt="SOC 2 Type 1 readiness — control evidence, retention windows, and Data Subject Access Request (DSAR) audit trail."
        useCases={[
          'Demonstrate per-control evidence to your auditor at a single glance',
          'Tune per-project data retention windows and place projects on legal hold',
          'Track and fulfil GDPR/CCPA data subject requests within 30 days',
        ]}
        howToUse="Evidence is auto-generated nightly at 04:30 UTC. Retention sweeps run nightly at 03:30 UTC. Click Refresh evidence to take an on-demand snapshot."
      />

      {loading ? <PanelSkeleton rows={5} label="Loading compliance data" /> : error ? (
        <ErrorAlert message={`Failed to load ${merged.failedLabel ?? 'compliance data'}: ${error}`} onRetry={merged.retry} />
      ) : (
        <>
          <Card className="p-5">
            <div className="text-xs font-medium uppercase tracking-wider mb-2">Latest control evidence</div>
            {latestEvidenceByControl.length === 0 ? (
              <EmptyState
                title="No evidence rows yet"
                description="Click Refresh evidence to generate the first snapshot."
              />
            ) : (
              <ResponsiveTable>
                <table className="w-full text-xs">
                  <thead className="text-fg-muted uppercase tracking-wider text-3xs">
                    <tr className="border-b border-edge-subtle">
                      <th className="py-1.5 text-left">Control</th>
                      <th className="text-left">Label</th>
                      <th className="text-left">Status</th>
                      <th className="text-left">Generated</th>
                      <th className="text-left">Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestEvidenceByControl.map((ev) => (
                      <tr key={ev.id} className="border-b border-edge-subtle/40">
                        <td className="py-1.5 font-mono">{ev.control}</td>
                        <td>{ev.control_label}</td>
                        <td>
                          <span className={`inline-flex rounded px-2 py-0.5 text-3xs ${STATUS_CHIP[ev.status]}`}>
                            {ev.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="opacity-70">{new Date(ev.generated_at).toLocaleString()}</td>
                        <td className="opacity-80 max-w-xs truncate">
                          <code className="text-2xs">{JSON.stringify(ev.payload).slice(0, 120)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTable>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs font-medium uppercase tracking-wider">Data residency</div>
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
                {residency.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded border border-edge-subtle p-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{p.name}</div>
                      <code className="text-2xs opacity-70 font-mono">{p.id}</code>
                    </div>
                    <div className="flex items-center gap-1">
                      {(['us', 'eu', 'jp', 'self'] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setProjectRegion(p.id, r)}
                          className={`px-2 py-1 text-3xs uppercase font-mono rounded border ${
                            p.data_residency_region === r
                              ? 'bg-brand text-brand-fg border-brand'
                              : 'border-edge-subtle text-fg-muted hover:text-fg hover:border-edge'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="text-xs font-medium uppercase tracking-wider mb-2">Retention policies</div>
            {policies.length === 0 ? (
              <EmptyState
                title="No retention policies set"
                description="Defaults of 365d (reports) / 730d (audit) apply until you save a policy."
              />
            ) : (
              <div className="space-y-2">
                {policies.map((p) => (
                  <div key={p.project_id} className="rounded border border-edge-subtle p-2">
                    <div className="flex items-center justify-between mb-2">
                      <code className="text-2xs opacity-70 font-mono">{p.project_id}</code>
                      <Btn
                        size="sm"
                        variant={p.legal_hold ? 'danger' : 'ghost'}
                        onClick={() => updatePolicy(p.project_id, { legal_hold: !p.legal_hold })}
                      >
                        {p.legal_hold ? 'Lift legal hold' : 'Place on legal hold'}
                      </Btn>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <RetentionInput
                        label="Reports"
                        value={p.reports_retention_days}
                        onChange={(v) => updatePolicy(p.project_id, { reports_retention_days: v })}
                      />
                      <RetentionInput
                        label="Audit"
                        value={p.audit_retention_days}
                        onChange={(v) => updatePolicy(p.project_id, { audit_retention_days: v })}
                      />
                      <RetentionInput
                        label="LLM traces"
                        value={p.llm_traces_retention_days}
                        onChange={(v) => updatePolicy(p.project_id, { llm_traces_retention_days: v })}
                      />
                      <RetentionInput
                        label="BYOK audit"
                        value={p.byok_audit_retention_days}
                        onChange={(v) => updatePolicy(p.project_id, { byok_audit_retention_days: v })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
              <div className="text-xs font-medium uppercase tracking-wider">Data subject requests</div>
              <p className="text-2xs text-fg-muted max-w-md">
                File a request when a user invokes their GDPR/CCPA right to access, export, deletion, or rectification.
                Mark it complete within 30 days to stay compliant.
              </p>
            </div>

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

            {dsars.length === 0 ? (
              <EmptyState title="No DSARs filed yet" />
            ) : (
              <ResponsiveTable>
                <table className="w-full text-xs">
                  <thead className="text-fg-muted uppercase tracking-wider text-3xs">
                    <tr className="border-b border-edge-subtle">
                      <th className="py-1.5 text-left">Type</th>
                      <th className="text-left">Subject</th>
                      <th className="text-left">Status</th>
                      <th className="text-left">Filed</th>
                      <th className="text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dsars.map((d) => (
                      <tr key={d.id} className="border-b border-edge-subtle/40">
                        <td className="py-1.5">{d.request_type}</td>
                        <td>{d.subject_email}</td>
                        <td className="uppercase tracking-wider text-2xs font-medium">{d.status}</td>
                        <td className="opacity-70">{new Date(d.created_at).toLocaleString()}</td>
                        <td>
                          {d.status !== 'completed' && d.status !== 'rejected' ? (
                            <div className="flex gap-1">
                              <Btn size="sm" onClick={() => setDsarStatus(d.id, 'completed')}>Complete</Btn>
                              <Btn size="sm" variant="ghost" onClick={() => setDsarStatus(d.id, 'rejected')}>Reject</Btn>
                            </div>
                          ) : (
                            <span className="opacity-60">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTable>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function RetentionInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
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
      <span className="opacity-60 uppercase tracking-wider">{label} (days)</span>
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
