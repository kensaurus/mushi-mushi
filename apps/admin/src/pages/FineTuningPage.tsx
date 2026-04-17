import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PIPELINE_STATUS } from '../lib/tokens'
import { PageHeader, PageHelp, Card, Badge, Btn, Loading, ErrorAlert, EmptyState } from '../components/ui'

interface FineTuningJob {
  id: string
  base_model: string
  status: string
  training_samples: number | null
  fine_tuned_model_id: string | null
  metrics: Record<string, unknown> | null
  validation_report: Record<string, unknown> | null
  export_storage_path: string | null
  export_size_bytes: number | null
  promote_to_stage: 'stage1' | 'stage2' | null
  promoted_at: string | null
  rejected_reason: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

const PIPELINE_STAGES: Array<{ key: FineTuningJob['status']; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'exporting', label: 'Exporting' },
  { key: 'exported', label: 'Exported' },
  { key: 'training', label: 'Training' },
  { key: 'trained', label: 'Trained' },
  { key: 'validating', label: 'Validating' },
  { key: 'validated', label: 'Validated' },
  { key: 'promoted', label: 'Promoted' },
]

export function FineTuningPage() {
  const [jobs, setJobs] = useState<FineTuningJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchJobs = () => {
    setLoading(true)
    setError(false)
    apiFetch<{ jobs: FineTuningJob[] }>('/v1/admin/fine-tuning')
      .then((d) => {
        if (d.ok && d.data) setJobs(d.data.jobs)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchJobs() }, [])

  const startJob = async () => {
    await apiFetch('/v1/admin/fine-tuning', {
      method: 'POST',
      body: JSON.stringify({ baseModel: 'claude-sonnet-4-6', promoteToStage: 'stage1' }),
    })
    fetchJobs()
  }

  const callStep = async (jobId: string, step: 'export' | 'validate' | 'promote' | 'reject', extra?: unknown) => {
    setBusyId(jobId)
    try {
      const res = await apiFetch(`/v1/admin/fine-tuning/${jobId}/${step}`, {
        method: 'POST',
        body: JSON.stringify(extra ?? {}),
      })
      if (!res.ok) {
        const e = res as { error?: { message?: string } }
        alert(`Failed: ${e.error?.message ?? 'unknown error'}`)
      }
    } finally {
      setBusyId(null)
      fetchJobs()
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Fine-Tuning">
        <Btn onClick={startJob}>New Training Job</Btn>
      </PageHeader>

      <PageHelp
        title="About Fine-Tuning"
        whatIsIt="Trains a smaller, cheaper model on your own classified reports so the bug pipeline runs faster and at lower cost without sacrificing accuracy."
        useCases={[
          'Cut classification cost once you have ~500+ confirmed reports',
          'Adapt the model to your domain vocabulary (game-specific bugs, internal product names)',
          'Reduce latency for high-volume report streams',
        ]}
        howToUse="Start a job, then walk it through Export → (Train via vendor) → Validate → Promote. Each step writes audit log entries; promotion is gated on accuracy ≥ 0.85, drift ≤ 0.25, and zero PII leakage."
      />

      {loading ? <Loading /> : error ? <ErrorAlert message="Failed to load fine-tuning jobs." onRetry={fetchJobs} /> : jobs.length === 0 ? (
        <EmptyState title="No training jobs yet" description="Start a new training job to fine-tune a model on your classified reports." />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id} className="p-3">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-xs font-mono text-fg-muted truncate">{job.id.slice(0, 8)}</span>
                  <span className="text-xs text-fg-secondary truncate">{job.base_model}</span>
                  {job.promote_to_stage && (
                    <span className="text-2xs text-fg-faint">→ {job.promote_to_stage}</span>
                  )}
                </div>
                <Badge className={PIPELINE_STATUS[job.status] ?? 'bg-surface-overlay text-fg-muted'}>{job.status}</Badge>
              </div>

              <PipelineStepper status={job.status} />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-2xs">
                <Stat label="Samples" value={job.training_samples?.toLocaleString() ?? '—'} />
                <Stat label="Export size" value={fmtBytes(job.export_size_bytes)} />
                <Stat label="Created" value={new Date(job.created_at).toLocaleDateString()} />
                <Stat label="Promoted" value={job.promoted_at ? new Date(job.promoted_at).toLocaleString() : '—'} />
              </div>

              {job.validation_report && (
                <div className="mt-3 p-2 rounded-md bg-surface-raised/50 border border-edge-subtle text-2xs">
                  <ValidationReportSummary report={job.validation_report} />
                </div>
              )}

              {job.rejected_reason && (
                <div className="mt-2 text-2xs text-danger">Rejected: {job.rejected_reason}</div>
              )}

              <div className="mt-3 flex gap-1.5 flex-wrap">
                <Btn
                  onClick={() => callStep(job.id, 'export')}
                  disabled={busyId === job.id || !canExport(job.status)}
                >
                  Export training set
                </Btn>
                <Btn
                  onClick={() => callStep(job.id, 'validate')}
                  disabled={busyId === job.id || !canValidate(job.status)}
                >
                  Validate
                </Btn>
                <Btn
                  onClick={() => callStep(job.id, 'promote')}
                  disabled={busyId === job.id || !canPromote(job.status)}
                >
                  Promote
                </Btn>
                <Btn
                  onClick={() => {
                    const reason = prompt('Reason for rejection?')
                    if (reason) void callStep(job.id, 'reject', { reason })
                  }}
                  disabled={busyId === job.id || job.status === 'promoted'}
                >
                  Reject
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function PipelineStepper({ status }: { status: string }) {
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === status)
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {PIPELINE_STAGES.map((s, i) => {
        const passed = idx > i
        const current = idx === i
        return (
          <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
            <div
              className={
                'w-2 h-2 rounded-full ' +
                (passed ? 'bg-success' : current ? 'bg-accent animate-pulse' : 'bg-edge')
              }
            />
            <span className={'text-2xs ' + (current ? 'text-fg' : passed ? 'text-fg-muted' : 'text-fg-faint')}>
              {s.label}
            </span>
            {i < PIPELINE_STAGES.length - 1 && <div className="w-3 h-px bg-edge" />}
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-fg-faint">{label}</div>
      <div className="text-fg font-mono tabular-nums">{value}</div>
    </div>
  )
}

function ValidationReportSummary({ report }: { report: Record<string, unknown> }) {
  const accuracy = typeof report.accuracy === 'number' ? report.accuracy : null
  const drift = typeof report.driftScore === 'number' ? report.driftScore : null
  const pii = !!report.piiLeakageDetected
  const passed = !!report.passed
  const notes = Array.isArray(report.notes) ? (report.notes as string[]) : []
  return (
    <div className="space-y-1">
      <div className="flex gap-3">
        <span>Accuracy: <span className="text-fg font-mono">{accuracy !== null ? accuracy.toFixed(3) : '—'}</span></span>
        <span>Drift: <span className="text-fg font-mono">{drift !== null ? drift.toFixed(3) : '—'}</span></span>
        <span>PII leak: <span className={pii ? 'text-danger' : 'text-success'}>{pii ? 'yes' : 'no'}</span></span>
        <span>Verdict: <span className={passed ? 'text-success' : 'text-danger'}>{passed ? 'passed' : 'failed'}</span></span>
      </div>
      {notes.length > 0 && (
        <ul className="text-fg-muted list-disc pl-4">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}

function canExport(status: string) {
  return status === 'pending' || status === 'rejected' || status === 'failed'
}
function canValidate(status: string) {
  return status === 'trained' || status === 'rejected'
}
function canPromote(status: string) {
  return status === 'validated'
}

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}
