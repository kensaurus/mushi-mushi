import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Card, Badge, Btn, RelativeTime, EmptyState } from '../ui'
import { useToast } from '../../lib/toast'
import { formatPct } from '../charts'
import type { FineTuningJob } from './types'

interface FineTuningJobsCardProps {
  jobs: FineTuningJob[]
  onChange: () => void | Promise<void>
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-fg-faint/15 text-fg-muted border border-edge-subtle',
  exporting: 'bg-info/15 text-info border border-info/30',
  exported: 'bg-info/15 text-info border border-info/30',
  trained: 'bg-info/15 text-info border border-info/30',
  validating: 'bg-info/15 text-info border border-info/30',
  validated: 'bg-ok/15 text-ok border border-ok/30',
  promoted: 'bg-ok/15 text-ok border border-ok/30',
  rejected: 'bg-warn/15 text-warn border border-warn/30',
  failed: 'bg-danger/15 text-danger border border-danger/30',
}

export function FineTuningJobsCard({ jobs, onChange }: FineTuningJobsCardProps) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function withBusy<T>(id: string, fn: () => Promise<T>) {
    setBusy(id)
    try {
      return await fn()
    } finally {
      setBusy(null)
    }
  }

  async function createJob() {
    setCreating(true)
    const stage = window.prompt('Promote to which stage on success? (stage1 | stage2)', 'stage2')
    if (!stage) {
      setCreating(false)
      return
    }
    if (stage !== 'stage1' && stage !== 'stage2') {
      toast.push({ tone: 'error', message: 'Stage must be stage1 or stage2' })
      setCreating(false)
      return
    }
    const res = await apiFetch<{ jobId: string }>('/v1/admin/fine-tuning', {
      method: 'POST',
      body: JSON.stringify({ promoteToStage: stage }),
    })
    setCreating(false)
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Fine-tuning job created. Hit Export to gather samples.' })
      await onChange()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Create failed' })
    }
  }

  async function exportJob(job: FineTuningJob) {
    await withBusy(job.id, async () => {
      const res = await apiFetch<{ sampleCount: number; sizeBytes: number }>(
        `/v1/admin/fine-tuning/${job.id}/export`,
        { method: 'POST' },
      )
      if (res.ok && res.data) {
        toast.push({
          tone: 'success',
          message: `Exported ${res.data.sampleCount.toLocaleString()} samples (${(res.data.sizeBytes / 1024).toFixed(1)} KB)`,
        })
        await onChange()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Export failed' })
      }
    })
  }

  async function validateJob(job: FineTuningJob) {
    await withBusy(job.id, async () => {
      const res = await apiFetch<{ accuracy: number; passed: boolean; sampleCount: number }>(
        `/v1/admin/fine-tuning/${job.id}/validate`,
        { method: 'POST' },
      )
      if (res.ok && res.data) {
        toast.push({
          tone: res.data.passed ? 'success' : 'warning',
          message: res.data.passed
            ? `Validated · ${formatPct(res.data.accuracy)} accuracy across ${res.data.sampleCount} samples`
            : `Validation failed · ${formatPct(res.data.accuracy)} accuracy across ${res.data.sampleCount} samples`,
        })
        await onChange()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Validate failed' })
      }
    })
  }

  async function promoteJob(job: FineTuningJob) {
    if (!window.confirm(`Promote ${job.id.slice(0, 8)}… to ${job.promote_to_stage ?? 'configured stage'}? This swaps the live model.`)) return
    await withBusy(job.id, async () => {
      const res = await apiFetch<{ promotedAt: string; stage: string }>(
        `/v1/admin/fine-tuning/${job.id}/promote`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (res.ok && res.data) {
        toast.push({ tone: 'success', message: `Promoted to ${res.data.stage}` })
        await onChange()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Promote failed' })
      }
    })
  }

  async function rejectJob(job: FineTuningJob) {
    const reason = window.prompt('Reject reason (audit trail):', 'Did not beat baseline accuracy')
    if (!reason) return
    await withBusy(job.id, async () => {
      const res = await apiFetch(`/v1/admin/fine-tuning/${job.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (res.ok) {
        toast.push({ tone: 'success', message: 'Job rejected' })
        await onChange()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Reject failed' })
      }
    })
  }

  async function deleteJob(job: FineTuningJob) {
    if (!window.confirm(`Delete fine-tuning job ${job.id.slice(0, 8)}…? Removes the row only — uploaded export stays in storage.`)) return
    await withBusy(job.id, async () => {
      const res = await apiFetch(`/v1/admin/fine-tuning/${job.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.push({ tone: 'success', message: 'Job deleted' })
        await onChange()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Delete failed' })
      }
    })
  }

  function nextActions(job: FineTuningJob) {
    const status = job.status
    const canExport = status === 'pending' || status === 'rejected' || status === 'failed'
    const canValidate = status === 'trained' || status === 'rejected'
    const canPromote = status === 'validated' || (status === 'trained' && (job.validation_report?.passed ?? false))
    const canReject = status !== 'rejected' && status !== 'promoted' && status !== 'pending'
    return { canExport, canValidate, canPromote, canReject }
  }

  return (
    <Card elevated className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-xs font-semibold text-fg-secondary">Fine-tuning jobs</h3>
          <p className="text-2xs text-fg-faint">
            Vendor-side fine-tunes for the rare case where prompts alone aren't enough. Workflow: <span className="font-mono">Create → Export → Validate → Promote</span>.
          </p>
        </div>
        <Btn size="sm" onClick={createJob} disabled={creating}>
          {creating ? 'Creating…' : 'New job'}
        </Btn>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="No fine-tuning jobs yet"
          description="Hit “New job” when you have enough labelled reports and want to fine-tune a base model. Most projects never need this — Prompt Lab is the supported workflow."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="text-fg-faint">
              <tr>
                <th className="text-left font-normal px-2 py-1">Job</th>
                <th className="text-left font-normal px-2 py-1">Status</th>
                <th className="text-left font-normal px-2 py-1">Model</th>
                <th className="text-left font-normal px-2 py-1">Promote to</th>
                <th className="text-right font-normal px-2 py-1">Samples</th>
                <th className="text-right font-normal px-2 py-1">Accuracy</th>
                <th className="text-left font-normal px-2 py-1">Created</th>
                <th className="text-right font-normal px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const actions = nextActions(job)
                const tone = STATUS_TONE[job.status] ?? STATUS_TONE.pending
                const acc = job.validation_report?.accuracy
                return (
                  <tr key={job.id} className="border-t border-edge-subtle align-top">
                    <td className="px-2 py-1.5 font-mono text-fg-muted">
                      {job.id.slice(0, 8)}…
                      {job.rejected_reason && (
                        <div className="text-2xs text-warn mt-0.5 whitespace-normal max-w-[14rem]">
                          {job.rejected_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge className={tone}>{job.status}</Badge>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-fg-muted">
                      {job.fine_tuned_model_id ?? job.base_model ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-fg-muted">
                      {job.promote_to_stage ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {job.training_samples ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {acc != null ? formatPct(acc) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-fg-muted">
                      <RelativeTime value={job.created_at} />
                    </td>
                    <td className="px-2 py-1.5 text-right space-x-1 whitespace-nowrap">
                      {actions.canExport && (
                        <Btn size="sm" variant="ghost" disabled={busy === job.id} onClick={() => exportJob(job)}>
                          Export
                        </Btn>
                      )}
                      {actions.canValidate && (
                        <Btn size="sm" variant="ghost" disabled={busy === job.id} onClick={() => validateJob(job)}>
                          Validate
                        </Btn>
                      )}
                      {actions.canPromote && (
                        <Btn size="sm" disabled={busy === job.id} onClick={() => promoteJob(job)}>
                          Promote
                        </Btn>
                      )}
                      {actions.canReject && (
                        <Btn size="sm" variant="ghost" disabled={busy === job.id} onClick={() => rejectJob(job)}>
                          Reject
                        </Btn>
                      )}
                      <Btn size="sm" variant="danger" disabled={busy === job.id} onClick={() => deleteJob(job)}>
                        Delete
                      </Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
