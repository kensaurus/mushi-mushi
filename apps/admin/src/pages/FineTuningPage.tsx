import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PIPELINE_STATUS } from '../lib/tokens'
import { PageHeader, Card, Badge, Btn, Loading, ErrorAlert } from '../components/ui'

interface FineTuningJob {
  id: string
  base_model: string
  status: string
  training_samples: number | null
  fine_tuned_model_id: string | null
  metrics: Record<string, unknown> | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export function FineTuningPage() {
  const [jobs, setJobs] = useState<FineTuningJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
    await apiFetch('/v1/admin/fine-tuning', { method: 'POST', body: JSON.stringify({ baseModel: 'claude-sonnet-4-20250514' }) })
    fetchJobs()
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Fine-Tuning">
        <Btn onClick={startJob}>New Training Job</Btn>
      </PageHeader>

      {loading ? <Loading /> : error ? <ErrorAlert message="Failed to load fine-tuning jobs." onRetry={fetchJobs} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-fg-muted border-b border-edge">
                <th className="text-left py-1.5 px-3 font-medium">ID</th>
                <th className="text-left py-1.5 px-3 font-medium">Base Model</th>
                <th className="text-left py-1.5 px-3 font-medium">Status</th>
                <th className="text-left py-1.5 px-3 font-medium">Samples</th>
                <th className="text-left py-1.5 px-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-edge-subtle">
                  <td className="py-1.5 px-3 text-fg-muted font-mono">{job.id.slice(0, 8)}</td>
                  <td className="py-1.5 px-3 text-fg-secondary">{job.base_model}</td>
                  <td className="py-1.5 px-3">
                    <Badge className={PIPELINE_STATUS[job.status] ?? 'bg-surface-overlay text-fg-muted'}>{job.status}</Badge>
                  </td>
                  <td className="py-1.5 px-3 text-fg-muted font-mono tabular-nums">{job.training_samples ?? '—'}</td>
                  <td className="py-1.5 px-3 text-fg-faint tabular-nums">{new Date(job.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
