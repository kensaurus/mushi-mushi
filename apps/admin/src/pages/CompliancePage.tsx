import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Card, Btn, Loading, ErrorAlert, EmptyState } from '../components/ui'
import { useToast } from '../lib/toast'

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
  pass: 'bg-emerald-500/10 text-emerald-500',
  warn: 'bg-amber-500/10 text-amber-500',
  fail: 'bg-red-500/10 text-red-500',
}

export function CompliancePage() {
  const toast = useToast()
  const [policies, setPolicies] = useState<RetentionPolicy[]>([])
  const [dsars, setDsars] = useState<Dsar[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [residency, setResidency] = useState<ResidencyProject[]>([])
  const [currentRegion, setCurrentRegion] = useState<string>('us')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAll = async () => {
    setLoading(true); setError(false)
    const [pRes, dRes, eRes, rRes] = await Promise.all([
      apiFetch<{ policies: RetentionPolicy[] }>('/v1/admin/compliance/retention'),
      apiFetch<{ requests: Dsar[] }>('/v1/admin/compliance/dsars'),
      apiFetch<{ evidence: Evidence[] }>('/v1/admin/compliance/evidence'),
      apiFetch<{ projects: ResidencyProject[]; currentRegion: string }>('/v1/admin/residency'),
    ])
    if (pRes.ok && pRes.data) setPolicies(pRes.data.policies)
    if (dRes.ok && dRes.data) setDsars(dRes.data.requests)
    if (eRes.ok && eRes.data) setEvidence(eRes.data.evidence)
    if (rRes.ok && rRes.data) {
      setResidency(rRes.data.projects)
      setCurrentRegion(rRes.data.currentRegion)
    }
    if (!pRes.ok || !dRes.ok || !eRes.ok || !rRes.ok) setError(true)
    setLoading(false)
  }

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
    await fetchAll()
  }

  useEffect(() => { void fetchAll() }, [])

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
      await fetchAll()
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
    await fetchAll()
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
    await fetchAll()
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Compliance">
        <Btn onClick={refreshEvidence} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh evidence'}
        </Btn>
      </PageHeader>

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

      {loading ? <Loading /> : error ? (
        <ErrorAlert message="Failed to load compliance data." onRetry={fetchAll} />
      ) : (
        <>
          <Card className="p-3">
            <div className="text-xs font-medium uppercase tracking-wider mb-2">Latest control evidence</div>
            {latestEvidenceByControl.length === 0 ? (
              <EmptyState
                title="No evidence rows yet"
                description="Click Refresh evidence to generate the first snapshot."
              />
            ) : (
              <div className="overflow-x-auto">
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
              </div>
            )}
          </Card>

          <Card className="p-3">
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

          <Card className="p-3">
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

          <Card className="p-3">
            <div className="text-xs font-medium uppercase tracking-wider mb-2">Data subject requests</div>
            {dsars.length === 0 ? (
              <EmptyState title="No DSARs filed yet" />
            ) : (
              <div className="overflow-x-auto">
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
              </div>
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
