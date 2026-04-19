/**
 * FILE: apps/admin/src/pages/PromptLabPage.tsx
 * PURPOSE: Replace the old "Fine-Tuning" page with a Kaggle / HF-flavoured
 *          Prompt Lab. Operators can:
 *            - browse prompt versions ranked by judge score
 *            - clone a global default into a project-specific candidate
 *            - edit, A/B (traffic %), promote, or delete candidates
 *            - inspect the eval dataset (recent classified reports)
 *            - run vendor-side fine-tuning (export → validate → promote)
 *            - generate synthetic reports to validate prompt changes
 */

import { useMemo, useState } from 'react'
import {
  PageHeader,
  PageHelp,
  Loading,
  ErrorAlert,
} from '../components/ui'
import { KpiRow, KpiTile, formatPct } from '../components/charts'
import { useToast } from '../lib/toast'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import type { PromptLabData, PromptVersion } from '../components/prompt-lab/types'
import { PromptStageTable } from '../components/prompt-lab/PromptStageTable'
import { PromptEditorModal } from '../components/prompt-lab/PromptEditorModal'
import { PromptDiffModal } from '../components/prompt-lab/PromptDiffModal'
import { EvalDatasetCard } from '../components/prompt-lab/EvalDatasetCard'
import { FineTuningJobsCard } from '../components/prompt-lab/FineTuningJobsCard'
import { SyntheticReportsCard } from '../components/prompt-lab/SyntheticReportsCard'

export function PromptLabPage() {
  const { data, loading, error, reload } = usePageData<PromptLabData>('/v1/admin/prompt-lab')
  const [editing, setEditing] = useState<PromptVersion | null>(null)
  const [diffing, setDiffing] = useState<PromptVersion | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()

  const grouped = useMemo(() => {
    const out: Record<string, PromptVersion[]> = { stage1: [], stage2: [] }
    for (const p of data?.prompts ?? []) {
      ;(out[p.stage] ??= []).push(p)
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
        const sa = a.avg_judge_score ?? -1
        const sb = b.avg_judge_score ?? -1
        if (sa !== sb) return sb - sa
        return b.total_evaluations - a.total_evaluations
      })
    }
    return out
  }, [data])

  async function clonePrompt(p: PromptVersion) {
    setBusy(p.id)
    const newVersion = `${p.version}-fork-${new Date().toISOString().slice(5, 10).replace('-', '')}`
    const res = await apiFetch<{ id: string }>('/v1/admin/prompt-lab/prompts', {
      method: 'POST',
      body: JSON.stringify({
        stage: p.stage,
        version: newVersion,
        promptTemplate: p.prompt_template,
        trafficPercentage: 0,
      }),
    })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: `Cloned to ${newVersion}` })
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Clone failed' })
    }
  }

  async function activatePrompt(p: PromptVersion) {
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: true }),
    })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: `${p.version} is now serving 100% of ${p.stage}` })
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Activation failed' })
    }
  }

  async function setTraffic(p: PromptVersion) {
    const next = window.prompt('A/B traffic % (0–100):', String(p.traffic_percentage))
    if (next == null) return
    const n = Number(next)
    if (!Number.isFinite(n)) return
    const pct = Math.max(0, Math.min(100, Math.round(n)))
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ trafficPercentage: pct }),
    })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: `Traffic set to ${pct}%` })
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Update failed' })
    }
  }

  async function deletePrompt(p: PromptVersion) {
    if (!window.confirm(`Delete prompt "${p.version}"? This cannot be undone.`)) return
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, { method: 'DELETE' })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Prompt deleted' })
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Delete failed' })
    }
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(editing.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ promptTemplate: editing.prompt_template }),
    })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Prompt saved' })
      setEditing(null)
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Save failed' })
    }
  }

  if (loading) return <Loading text="Loading prompt lab..." />
  if (error) return <ErrorAlert message={error} onRetry={reload} />
  if (!data) return null

  const totalEvals = data.prompts.reduce((s, p) => s + p.total_evaluations, 0)
  const bestPrompt = [...data.prompts]
    .filter((p) => p.avg_judge_score != null)
    .sort((a, b) => (b.avg_judge_score ?? 0) - (a.avg_judge_score ?? 0))[0]
  const candidates = data.prompts.filter((p) => p.is_candidate).length
  const parentForDiff = diffing
    ? data.prompts.find((p) => p.id === diffing.parent_version_id)
    : undefined

  return (
    <div className="space-y-3">
      <PageHeader title="Prompt Lab">
        <span className="text-2xs text-fg-faint font-mono">
          {data.prompts.length} prompts · {totalEvals} evals
        </span>
      </PageHeader>

      <PageHelp
        title="About Prompt Lab"
        whatIsIt="The control plane for the LLM prompts that drive fast-filter (Stage 1) and classify-report (Stage 2). Clone a baseline, edit it, run it as a candidate at 10% traffic, and promote when the judge score beats the active version."
        useCases={[
          'A/B test a sharper Stage 2 prompt before flipping it on for everyone',
          'Iterate on category rules without redeploying — prompts hot-reload from the DB',
          'Audit who changed what, when, and what the judge thought of it',
          'Validate prompt changes against synthetic reports before they reach real users',
        ]}
        howToUse="Pick a baseline → Clone → Edit → set Traffic % to a small number (e.g. 10) → wait for the judge to score it → Promote if it beats the active prompt. Global defaults are read-only; clone first."
      />

      <KpiRow cols={4}>
        <KpiTile
          label="Active prompts"
          value={data.prompts.filter((p) => p.is_active).length}
          sublabel="serving production traffic"
        />
        <KpiTile
          label="Candidates"
          value={candidates}
          accent={candidates > 0 ? 'info' : 'muted'}
          sublabel="awaiting eval"
        />
        <KpiTile
          label="Best score"
          value={bestPrompt?.avg_judge_score != null ? formatPct(bestPrompt.avg_judge_score) : '—'}
          accent={'ok'}
          sublabel={bestPrompt ? `${bestPrompt.stage}/${bestPrompt.version}` : 'no scored prompts yet'}
        />
        <KpiTile
          label="Eval dataset"
          value={data.dataset.labelled.toLocaleString()}
          sublabel={`labelled / ${data.dataset.total.toLocaleString()} total reports`}
        />
      </KpiRow>

      {(['stage1', 'stage2'] as const).map((stage) => (
        <PromptStageTable
          key={stage}
          stage={stage}
          prompts={grouped[stage] ?? []}
          busy={busy}
          onClone={clonePrompt}
          onEdit={setEditing}
          onDiff={setDiffing}
          onActivate={activatePrompt}
          onTraffic={setTraffic}
          onDelete={deletePrompt}
        />
      ))}

      <FineTuningJobsCard jobs={data.fineTuningJobs ?? []} onChange={reload} />

      <SyntheticReportsCard />

      <EvalDatasetCard
        total={data.dataset.total}
        labelled={data.dataset.labelled}
        recentSamples={data.dataset.recentSamples}
      />

      {diffing && (
        <PromptDiffModal prompt={diffing} parent={parentForDiff} onClose={() => setDiffing(null)} />
      )}

      {editing && (
        <PromptEditorModal
          prompt={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          saving={busy === editing.id}
        />
      )}
    </div>
  )
}
