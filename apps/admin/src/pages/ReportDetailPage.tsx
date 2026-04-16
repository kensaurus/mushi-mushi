import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { Section, Field, Loading, SelectField } from '../components/ui'

interface ReportDetail {
  id: string
  project_id: string
  description: string
  user_category: string
  user_intent: string | null
  screenshot_url: string | null
  environment: Record<string, any>
  console_logs: Array<{ level: string; message: string; timestamp: number }> | null
  network_logs: Array<{ method: string; url: string; status: number; duration: number }> | null
  performance_metrics: Record<string, number> | null
  stage1_classification: Record<string, any> | null
  stage1_model: string | null
  stage1_latency_ms: number | null
  category: string
  severity: string | null
  summary: string | null
  component: string | null
  confidence: number | null
  status: string
  reporter_token_hash: string
  session_id: string | null
  created_at: string
  processing_error: string | null
}

const STATUS_OPTS = ['new', 'classified', 'fixing', 'fixed', 'dismissed']
const SEV_OPTS = ['critical', 'high', 'medium', 'low']

export function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    setLoading(true)
    apiFetch<ReportDetail>(`/v1/admin/reports/${id}`).then((res) => {
      if (res.ok && res.data) setReport(res.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [id])

  const handleTriage = async (updates: Record<string, string>) => {
    if (!id) return
    setSaving(true)
    const res = await apiFetch(`/v1/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    if (res.ok && report) setReport({ ...report, ...updates })
    setSaving(false)
  }

  if (loading) return <Loading text="Loading report..." />
  if (!report) return <div className="text-fg-muted text-sm">Report not found.</div>

  return (
    <div>
      <Link to="/reports" className="text-xs text-fg-muted hover:text-fg-secondary mb-3 inline-block">&larr; Back to reports</Link>

      <div className="mb-4">
        <h2 className="text-base font-semibold text-fg">{report.summary ?? 'Untitled Report'}</h2>
        <p className="text-2xs text-fg-faint mt-0.5 font-mono">{report.id}</p>
      </div>

      {/* Triage bar */}
      <div className="flex gap-3 mb-4 flex-wrap items-end bg-surface-raised/50 border border-edge-subtle rounded-md p-3">
        <SelectField
          label="Status"
          value={report.status}
          onChange={(e) => handleTriage({ status: e.currentTarget.value })}
          disabled={saving}
          className="!w-auto"
        >
          {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </SelectField>

        <SelectField
          label="Severity"
          value={report.severity ?? ''}
          onChange={(e) => handleTriage({ severity: e.currentTarget.value })}
          disabled={saving}
          className="!w-auto"
        >
          <option value="">unset</option>
          {SEV_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </SelectField>

        {saving && <span className="text-2xs text-brand">Saving...</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="User Report">
          <Field label="Description" value={report.description} />
          <Field label="User Category" value={report.user_category} />
          {report.user_intent && <Field label="User Intent" value={report.user_intent} />}
          {report.screenshot_url && (
            <div className="mt-2">
              <span className="text-2xs text-fg-faint">Screenshot</span>
              <img src={report.screenshot_url} alt="Screenshot" className="mt-1 rounded-sm border border-edge max-h-48 object-contain" />
            </div>
          )}
        </Section>

        <Section title="LLM Classification">
          {report.stage1_classification ? (
            <>
              <Field label="Category" value={report.category} />
              <Field label="Severity" value={report.severity ?? 'n/a'} />
              <Field label="Summary" value={report.summary ?? 'n/a'} />
              <Field label="Component" value={report.component ?? 'n/a'} />
              <Field label="Confidence" value={report.confidence ? `${(report.confidence * 100).toFixed(0)}%` : 'n/a'} />
              {(report.stage1_classification as any)?.reproductionHint && (
                <Field label="Reproduction Hint" value={(report.stage1_classification as any).reproductionHint} />
              )}
              <div className="mt-1.5 text-2xs text-fg-faint font-mono">
                {report.stage1_model} · {report.stage1_latency_ms}ms
              </div>
            </>
          ) : report.processing_error ? (
            <div className="text-danger text-xs">Classification failed: {report.processing_error}</div>
          ) : (
            <div className="text-fg-muted text-xs">Pending classification...</div>
          )}
        </Section>

        <Section title="Environment">
          <Field label="URL" value={report.environment?.url ?? 'n/a'} mono />
          <Field label="Browser" value={report.environment?.userAgent ?? 'n/a'} />
          <Field label="Viewport" value={report.environment?.viewport ? `${report.environment.viewport.width}×${report.environment.viewport.height}` : 'n/a'} />
          <Field label="Platform" value={report.environment?.platform ?? 'n/a'} />
          <Field label="Session" value={report.session_id ?? 'n/a'} mono />
        </Section>

        {report.performance_metrics && (
          <Section title="Performance Metrics">
            {Object.entries(report.performance_metrics).map(([key, val]) => (
              <Field key={key} label={key.toUpperCase()} value={typeof val === 'number' ? `${val.toFixed(1)}ms` : String(val)} mono />
            ))}
          </Section>
        )}

        {report.console_logs && report.console_logs.length > 0 && (
          <Section title={`Console Logs (${report.console_logs.length})`}>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {report.console_logs.map((log, i) => (
                <div key={i} className={`text-2xs font-mono ${log.level === 'error' ? 'text-danger' : log.level === 'warn' ? 'text-warn' : 'text-fg-muted'}`}>
                  [{log.level}] {log.message}
                </div>
              ))}
            </div>
          </Section>
        )}

        {report.network_logs && report.network_logs.length > 0 && (
          <Section title={`Network (${report.network_logs.length})`}>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {report.network_logs.map((req, i) => (
                <div key={i} className={`text-2xs font-mono ${req.status >= 400 ? 'text-danger' : 'text-fg-muted'}`}>
                  {req.method} {req.url} → {req.status} ({req.duration}ms)
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      <div className="mt-4 text-2xs text-fg-faint font-mono">
        Reported: {new Date(report.created_at).toLocaleString()} · Reporter: {report.reporter_token_hash?.slice(0, 16)}…
      </div>
    </div>
  )
}
