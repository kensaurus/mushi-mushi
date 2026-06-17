import { useState, useRef } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Card, Badge, Btn, RelativeTime, EmptyState } from '../ui'
import { useToast } from '../../lib/toast'
import { formatPct } from '../charts'
import { ConfirmDialog, PromptDialog } from '../ConfirmDialog'
import { Modal } from '../Modal'
import {
  IconExport,
  IconShieldCheck,
  IconBolt,
  IconClose,
  IconTrash,
} from '../icons'
import type { FineTuningJob } from './types'

// See PromptStageTable for the icon-button pattern. Same `!px-1.5` trick
// gives us a square inset for icon-only Btns while still inheriting
// every variant token (`danger` red wash, `success` green wash) from
// the shared component.
const ICON_BTN = '!px-1.5'

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
  rejected: 'bg-warn-muted/50 text-warning-foreground border border-warn/30',
  failed: 'bg-danger-muted/50 text-danger-foreground border border-danger/30',
}

const VENDOR_OPTIONS = [
  {
    value: 'openai:gpt-4o-mini',
    label: 'OpenAI — gpt-4o-mini (self-service)',
    description: 'End-to-end fine-tuning via OpenAI API. Requires BYOK OpenAI key.',
  },
  {
    value: 'bedrock:anthropic.claude-3-haiku-20240307-v1:0',
    label: 'Bedrock — Claude 3 Haiku (requires AWS setup)',
    description: 'AWS Bedrock fine-tuning. Requires MUSHI_BEDROCK_FINETUNE_ENABLED=1, IAM role, and S3 bucket.',
  },
  {
    value: 'anthropic:contact-required',
    label: 'Anthropic direct — not publicly available',
    description: 'Anthropic\'s direct fine-tuning API requires contacting your account team. Use Bedrock for Claude fine-tuning.',
  },
] as const

export function FineTuningJobsCard({ jobs, onChange }: FineTuningJobsCardProps) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [askingStage, setAskingStage] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState<string>(VENDOR_OPTIONS[0].value)
  const [promoteTarget, setPromoteTarget] = useState<FineTuningJob | null>(null)
  const [rejectTarget, setRejectTarget] = useState<FineTuningJob | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FineTuningJob | null>(null)
  const stageInputRef = useRef<HTMLInputElement>(null)
  const [stageError, setStageError] = useState<string | null>(null)

  async function withBusy<T>(id: string, fn: () => Promise<T>) {
    setBusy(id)
    try {
      return await fn()
    } finally {
      setBusy(null)
    }
  }

  async function commitCreateJob(stage: string) {
    setCreating(true)
    const res = await apiFetch<{ jobId: string }>('/v1/admin/fine-tuning', {
      method: 'POST',
      body: JSON.stringify({ promoteToStage: stage, baseModel: selectedVendor }),
    })
    setCreating(false)
    setAskingStage(false)
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

  async function commitPromote() {
    if (!promoteTarget) return
    const job = promoteTarget
    setPromoteTarget(null)
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

  async function commitReject(reason: string) {
    if (!rejectTarget) return
    const job = rejectTarget
    setRejectTarget(null)
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

  async function commitDelete() {
    if (!deleteTarget) return
    const job = deleteTarget
    setDeleteTarget(null)
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
        <Btn size="sm" onClick={() => { setAskingStage(true); setStageError(null) }} disabled={creating} loading={creating}>
          New job
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
                      {/* Export / Validate are workflow secondaries —
                          icon + tooltip keeps the row scannable. Promote
                          stays text (success green) because it's the
                          primary forward action and an explicit "Promote"
                          verb is the safety rail before the live model
                          flips. Reject and Delete are both danger but
                          mean different things (Reject = audit-trail no,
                          Delete = remove the row entirely) — different
                          glyphs (✕ vs trash) keep them distinguishable
                          without re-reading the column. */}
                      {actions.canExport && (
                        <Btn
                          size="sm"
                          variant="ghost"
                          className={ICON_BTN}
                          disabled={busy === job.id}
                          onClick={() => exportJob(job)}
                          title="Export training samples"
                          aria-label="Export training samples"
                        >
                          <IconExport />
                        </Btn>
                      )}
                      {actions.canValidate && (
                        <Btn
                          size="sm"
                          variant="ghost"
                          className={ICON_BTN}
                          disabled={busy === job.id}
                          onClick={() => validateJob(job)}
                          title="Validate fine-tuned model accuracy"
                          aria-label="Validate fine-tuned model accuracy"
                        >
                          <IconShieldCheck />
                        </Btn>
                      )}
                      {actions.canPromote && (
                        <Btn
                          size="sm"
                          variant="success"
                          leadingIcon={<IconBolt />}
                          disabled={busy === job.id}
                          onClick={() => setPromoteTarget(job)}
                          title="Promote to live — swaps the production model"
                        >
                          Promote
                        </Btn>
                      )}
                      {actions.canReject && (
                        <Btn
                          size="sm"
                          variant="danger"
                          className={ICON_BTN}
                          disabled={busy === job.id}
                          onClick={() => setRejectTarget(job)}
                          title="Reject — captures a reason in the audit trail"
                          aria-label="Reject fine-tuning job"
                        >
                          <IconClose />
                        </Btn>
                      )}
                      <Btn
                        size="sm"
                        variant="danger"
                        className={ICON_BTN}
                        disabled={busy === job.id}
                        onClick={() => setDeleteTarget(job)}
                        title="Delete fine-tuning job"
                        aria-label="Delete fine-tuning job"
                      >
                        <IconTrash />
                      </Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={askingStage}
        onClose={() => setAskingStage(false)}
        title="New fine-tuning job"
        size="sm"
        dismissible={!creating}
        footer={
          <div className="flex gap-2 justify-end">
            <Btn size="sm" variant="cancel" onClick={() => setAskingStage(false)} disabled={creating}>Cancel</Btn>
            <Btn
              size="sm"
              loading={creating}
              data-primary
              onClick={() => {
                const stage = stageInputRef.current?.value?.trim() ?? ''
                if (stage !== 'stage1' && stage !== 'stage2') {
                  setStageError('Type stage1 or stage2 exactly.')
                  return
                }
                setStageError(null)
                void commitCreateJob(stage)
              }}
            >
              Create job
            </Btn>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-2xs font-medium text-fg-muted uppercase tracking-wider block">Vendor / base model</label>
            <select
              className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1.5 text-xs"
              value={selectedVendor}
              onChange={(e) => setSelectedVendor(e.currentTarget.value)}
            >
              {VENDOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-2xs text-fg-faint leading-relaxed">
              {VENDOR_OPTIONS.find((o) => o.value === selectedVendor)?.description ?? ''}
            </p>
          </div>
          <p className="text-2xs text-fg-secondary leading-snug">
            Pick which stage to promote once it passes validation. Most operators use <span className="font-mono">stage2</span> (the deeper classifier).
          </p>
          <div className="space-y-1">
            <label className="text-2xs font-medium text-fg-muted uppercase tracking-wider block">Promote to stage</label>
            <input
              ref={stageInputRef}
              type="text"
              defaultValue="stage2"
              className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1 text-xs font-mono"
              placeholder="stage1 or stage2"
              onChange={() => setStageError(null)}
            />
            {stageError
              ? <p className="text-2xs text-danger">{stageError}</p>
              : <p className="text-2xs text-fg-faint">Type stage1 or stage2 exactly.</p>
            }
          </div>
        </div>
      </Modal>

      {promoteTarget && (
        <ConfirmDialog
          title={`Promote ${promoteTarget.id.slice(0, 8)}…?`}
          body={`This swaps the live ${promoteTarget.promote_to_stage ?? 'configured'} model for the fine-tuned variant. Real classifications start using it within seconds. You can roll back by promoting another job.`}
          confirmLabel="Promote to live"
          tone="default"
          loading={busy === promoteTarget.id}
          onConfirm={commitPromote}
          onCancel={() => setPromoteTarget(null)}
        />
      )}

      {rejectTarget && (
        <PromptDialog
          title={`Reject ${rejectTarget.id.slice(0, 8)}…`}
          body="Captured in the audit trail so future operators understand why this candidate didn't ship. Be specific."
          label="Reject reason"
          defaultValue="Did not beat baseline accuracy"
          confirmLabel="Reject job"
          loading={busy === rejectTarget.id}
          validate={(v) => (v.length >= 4 ? null : 'Give a short reason (≥4 chars).')}
          onConfirm={commitReject}
          onCancel={() => setRejectTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete fine-tuning job ${deleteTarget.id.slice(0, 8)}…?`}
          body="Removes the row from the registry only — any uploaded export file stays in storage. The live model is unaffected."
          confirmLabel="Delete job"
          tone="danger"
          loading={busy === deleteTarget.id}
          onConfirm={commitDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </Card>
  )
}
