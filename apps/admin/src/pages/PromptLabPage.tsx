/**
 * FILE: apps/admin/src/pages/PromptLabPage.tsx
 * PURPOSE: Replace the old "Fine-Tuning" page with a Kaggle / HF-flavoured
 *          Prompt Lab. Operators can:
 *            - browse prompt versions ranked by judge score
 *            - clone a global default into a project-specific candidate
 *            - edit, A/B (traffic %), promote, or delete candidates
 *            - inspect the eval dataset (recent classified reports)
 *          The legacy fine-tuning JSONL export is kept as a side panel
 *          for the rare case where a vendor-side fine-tune is needed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  EmptyState,
  Loading,
  ErrorAlert,
  RelativeTime,
} from '../components/ui'
import { KpiRow, KpiTile, formatPct } from '../components/charts'
import { useToast } from '../lib/toast'

interface AutoGenerationMetadata {
  parentVersion?: string
  failureCount?: number
  topBuckets?: Array<{ reason: string; count: number }>
  addressedBuckets?: string[]
  changeSummary?: string
  generatedAt?: string
  model?: string
}

interface PromptVersion {
  id: string
  project_id: string | null
  stage: 'stage1' | 'stage2'
  version: string
  prompt_template: string
  is_active: boolean
  is_candidate: boolean
  traffic_percentage: number
  avg_judge_score: number | null
  total_evaluations: number
  created_at: string
  updated_at: string
  auto_generated?: boolean
  auto_generation_metadata?: AutoGenerationMetadata | null
  parent_version_id?: string | null
}

interface DatasetSample {
  id: string
  description: string
  category: string | null
  severity: string | null
  component: string | null
  created_at: string
}

interface FineTuningJob {
  id: string
  project_id: string
  status: string
  base_model: string | null
  training_samples: number | null
  created_at: string
}

interface PromptLabData {
  prompts: PromptVersion[]
  dataset: {
    total: number
    labelled: number
    recentSamples: DatasetSample[]
  }
  fineTuningJobs?: FineTuningJob[]
}

const STAGE_LABELS: Record<string, string> = {
  stage1: 'Stage 1 · Fast filter',
  stage2: 'Stage 2 · Classify',
}

type DiffLine = { kind: 'eq' | 'add' | 'del'; text: string }

/**
 * Tiny LCS line-diff. Optimised for small inputs (a single prompt template,
 * typically < 200 lines), so the O(n*m) table is fine. Avoids pulling in a
 * full diff library when we only need add/del/eq markers for syntax highlighting.
 */
function lineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const n = aLines.length
  const m = bLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ kind: 'eq', text: aLines[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: aLines[i] })
      i++
    } else {
      out.push({ kind: 'add', text: bLines[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: aLines[i++] })
  while (j < m) out.push({ kind: 'add', text: bLines[j++] })
  return out
}

export function PromptLabPage() {
  const [data, setData] = useState<PromptLabData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState<PromptVersion | null>(null)
  const [diffing, setDiffing] = useState<PromptVersion | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setError(false)
    const res = await apiFetch<PromptLabData>('/v1/admin/prompt-lab')
    if (res.ok && res.data) setData(res.data)
    else setError(true)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
      await load()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Clone failed' })
    }
  }

  async function activate(p: PromptVersion) {
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: true }),
    })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: `${p.version} is now serving 100% of ${p.stage}` })
      await load()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Activation failed' })
    }
  }

  async function setTraffic(p: PromptVersion, pct: number) {
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ trafficPercentage: pct }),
    })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: `Traffic set to ${pct}%` })
      await load()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Update failed' })
    }
  }

  async function deletePrompt(p: PromptVersion) {
    if (!confirm(`Delete prompt "${p.version}"? This cannot be undone.`)) return
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, { method: 'DELETE' })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Prompt deleted' })
      await load()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Delete failed' })
    }
  }

  async function deleteFineTuningJob(job: FineTuningJob) {
    if (!confirm(`Delete fine-tuning job ${job.id.slice(0, 8)}…? This removes the row only — any uploaded export stays in storage.`)) return
    setBusy(job.id)
    const res = await apiFetch(`/v1/admin/fine-tuning/${job.id}`, { method: 'DELETE' })
    setBusy(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Fine-tuning job deleted' })
      await load()
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
      await load()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Save failed' })
    }
  }

  if (loading) return <Loading text="Loading prompt lab..." />
  if (error) return <ErrorAlert message="Failed to load prompt lab." onRetry={load} />
  if (!data) return null

  const totalEvals = data.prompts.reduce((s, p) => s + p.total_evaluations, 0)
  const bestPrompt = [...data.prompts]
    .filter((p) => p.avg_judge_score != null)
    .sort((a, b) => (b.avg_judge_score ?? 0) - (a.avg_judge_score ?? 0))[0]
  const candidates = data.prompts.filter((p) => p.is_candidate).length

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

      {(['stage1', 'stage2'] as const).map((stage) => {
        const list = grouped[stage] ?? []
        return (
          <Card key={stage} elevated className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-fg-secondary">
                {STAGE_LABELS[stage]}
              </h3>
              <span className="text-2xs text-fg-faint font-mono">
                {list.length} versions
              </span>
            </div>
            {list.length === 0 ? (
              <p className="text-2xs text-fg-faint">No prompts registered for this stage.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-2xs">
                  <thead className="text-fg-faint">
                    <tr>
                      <th className="text-left font-normal px-2 py-1">Version</th>
                      <th className="text-left font-normal px-2 py-1">State</th>
                      <th className="text-right font-normal px-2 py-1">Traffic</th>
                      <th className="text-right font-normal px-2 py-1">Judge score</th>
                      <th className="text-right font-normal px-2 py-1">Evals</th>
                      <th className="text-left font-normal px-2 py-1">Updated</th>
                      <th className="text-right font-normal px-2 py-1">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => {
                      const isGlobal = p.project_id == null
                      const score = p.avg_judge_score
                      return (
                        <tr key={p.id} className="border-t border-edge-subtle">
                          <td className="px-2 py-1.5 font-mono text-fg-secondary truncate max-w-[10rem]">
                            {p.version}
                          </td>
                          <td className="px-2 py-1.5">
                            {p.is_active ? (
                              <Badge className="bg-ok/15 text-ok border border-ok/30">
                                Active
                              </Badge>
                            ) : p.is_candidate ? (
                              <Badge className="bg-info/15 text-info border border-info/30">
                                Candidate
                              </Badge>
                            ) : (
                              <Badge className="bg-fg-faint/15 text-fg-muted border border-edge-subtle">
                                Idle
                              </Badge>
                            )}
                            {isGlobal && (
                              <Badge className="ml-1 bg-warn/15 text-warn border border-warn/30">
                                Global
                              </Badge>
                            )}
                            {p.auto_generated && (
                              <Badge
                                className="ml-1 bg-brand/15 text-brand border border-brand/30"
                                title={p.auto_generation_metadata?.changeSummary ?? 'Generated by prompt-auto-tune'}
                              >
                                Auto
                              </Badge>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                            {p.traffic_percentage}%
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                            {score != null ? formatPct(score) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-fg-muted tabular-nums">
                            {p.total_evaluations}
                          </td>
                          <td className="px-2 py-1.5 text-fg-muted">
                            <RelativeTime value={p.updated_at} />
                          </td>
                          <td className="px-2 py-1.5 text-right space-x-1 whitespace-nowrap">
                            <Btn
                              size="sm"
                              variant="ghost"
                              disabled={busy === p.id}
                              onClick={() => clonePrompt(p)}
                              title="Create an editable copy"
                            >
                              Clone
                            </Btn>
                            {!isGlobal && (
                              <>
                                <Btn
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy === p.id}
                                  onClick={() => setEditing(p)}
                                >
                                  Edit
                                </Btn>
                                {p.parent_version_id && (
                                  <Btn
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy === p.id}
                                    onClick={() => setDiffing(p)}
                                    title="Diff against parent prompt"
                                  >
                                    Diff
                                  </Btn>
                                )}
                                {!p.is_active && (
                                  <Btn
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy === p.id}
                                    onClick={() => activate(p)}
                                    title="Make this the live prompt for this stage"
                                  >
                                    Activate
                                  </Btn>
                                )}
                                {!p.is_active && (
                                  <Btn
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy === p.id}
                                    onClick={() => {
                                      const next = prompt(
                                        'A/B traffic % (0–100):',
                                        String(p.traffic_percentage),
                                      )
                                      if (next == null) return
                                      const n = Number(next)
                                      if (!Number.isFinite(n)) return
                                      void setTraffic(p, Math.max(0, Math.min(100, Math.round(n))))
                                    }}
                                  >
                                    Traffic
                                  </Btn>
                                )}
                                <Btn
                                  size="sm"
                                  variant="danger"
                                  disabled={busy === p.id || p.is_active}
                                  onClick={() => deletePrompt(p)}
                                >
                                  Delete
                                </Btn>
                              </>
                            )}
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
      })}

      {data.fineTuningJobs && data.fineTuningJobs.length > 0 && (
        <Card elevated className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-fg-secondary">
              Legacy fine-tuning jobs
            </h3>
            <span className="text-2xs text-fg-faint font-mono">
              {data.fineTuningJobs.length} jobs
            </span>
          </div>
          <p className="text-2xs text-fg-faint mb-2">
            These rows were created by the old "Fine-Tuning" page (now retired). Hit Delete on any "pending" row that never got past export — Prompt Lab is the supported workflow now.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-2xs">
              <thead className="text-fg-faint">
                <tr>
                  <th className="text-left font-normal px-2 py-1">Job</th>
                  <th className="text-left font-normal px-2 py-1">Status</th>
                  <th className="text-left font-normal px-2 py-1">Model</th>
                  <th className="text-right font-normal px-2 py-1">Samples</th>
                  <th className="text-left font-normal px-2 py-1">Created</th>
                  <th className="text-right font-normal px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.fineTuningJobs.map((job) => (
                  <tr key={job.id} className="border-t border-edge-subtle">
                    <td className="px-2 py-1.5 font-mono text-fg-muted">{job.id.slice(0, 8)}…</td>
                    <td className="px-2 py-1.5">
                      <Badge
                        className={
                          job.status === 'pending'
                            ? 'bg-warn/15 text-warn border border-warn/30'
                            : job.status === 'rejected'
                              ? 'bg-danger/15 text-danger border border-danger/30'
                              : 'bg-fg-faint/15 text-fg-muted border border-edge-subtle'
                        }
                      >
                        {job.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-fg-muted">{job.base_model ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{job.training_samples ?? '—'}</td>
                    <td className="px-2 py-1.5 text-fg-muted"><RelativeTime value={job.created_at} /></td>
                    <td className="px-2 py-1.5 text-right">
                      <Btn
                        size="sm"
                        variant="danger"
                        disabled={busy === job.id}
                        onClick={() => deleteFineTuningJob(job)}
                      >
                        Delete
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card elevated className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-fg-secondary">
            Eval dataset · recent classified reports
          </h3>
          <span className="text-2xs text-fg-faint font-mono">
            {data.dataset.labelled.toLocaleString()} labelled
          </span>
        </div>
        {data.dataset.recentSamples.length === 0 ? (
          <EmptyState
            title="No labelled reports yet"
            description="Once Stage 2 classifies reports, they appear here as the eval dataset for your next prompt experiment."
          />
        ) : (
          <ul className="space-y-1.5 text-xs">
            {data.dataset.recentSamples.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-2 border-t border-edge-subtle pt-1.5 first:border-0 first:pt-0"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/reports/${s.id}`}
                    className="text-fg-secondary hover:text-fg underline-offset-2 hover:underline"
                  >
                    {s.description?.slice(0, 140) ?? '(no description)'}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-2xs font-mono text-fg-muted">
                    {s.category && <span>cat: {s.category}</span>}
                    {s.severity && <span>sev: {s.severity}</span>}
                    {s.component && <span>cmp: {s.component}</span>}
                  </div>
                </div>
                <RelativeTime
                  value={s.created_at}
                  className="text-2xs text-fg-faint shrink-0"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {diffing && (() => {
        const parent = data.prompts.find((p) => p.id === diffing.parent_version_id)
        const lines = parent ? lineDiff(parent.prompt_template, diffing.prompt_template) : []
        const meta = diffing.auto_generation_metadata
        return (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3"
            onClick={() => setDiffing(null)}
          >
            <Card
              elevated
              className="w-full max-w-5xl p-4 space-y-2 max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">
                  Diff · {diffing.stage} / {diffing.version} vs {parent?.version ?? 'parent'}
                </h3>
                <button
                  type="button"
                  className="text-fg-muted hover:text-fg text-lg leading-none"
                  onClick={() => setDiffing(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {meta && (
                <div className="text-2xs text-fg-muted space-y-1 border border-edge-subtle rounded-sm p-2 bg-surface-overlay">
                  {meta.changeSummary && (
                    <p className="text-fg-secondary">
                      <span className="text-fg-faint">Why: </span>
                      {meta.changeSummary}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 font-mono">
                    {meta.failureCount != null && <span>failures: {meta.failureCount}</span>}
                    {meta.model && <span>model: {meta.model}</span>}
                    {meta.generatedAt && <span>generated: <RelativeTime value={meta.generatedAt} /></span>}
                  </div>
                  {meta.topBuckets && meta.topBuckets.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 font-mono">
                      <span className="text-fg-faint">buckets:</span>
                      {meta.topBuckets.map((b) => (
                        <span key={b.reason} className="px-1 rounded-sm bg-fg-faint/10">
                          {b.reason} ×{b.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!parent ? (
                <p className="text-2xs text-fg-faint">Parent prompt not found (it may have been deleted).</p>
              ) : (
                <pre className="flex-1 overflow-auto bg-surface-overlay border border-edge-subtle rounded-sm p-2 text-2xs font-mono leading-snug">
                  {lines.map((l, idx) => (
                    <div
                      key={idx}
                      className={
                        l.kind === 'add'
                          ? 'bg-ok/10 text-ok'
                          : l.kind === 'del'
                            ? 'bg-danger/10 text-danger'
                            : 'text-fg-muted'
                      }
                    >
                      <span className="select-none mr-2 text-fg-faint">
                        {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                      </span>
                      {l.text || '\u00A0'}
                    </div>
                  ))}
                </pre>
              )}
              <div className="flex justify-end gap-1.5">
                <Btn variant="ghost" onClick={() => setDiffing(null)}>
                  Close
                </Btn>
              </div>
            </Card>
          </div>
        )
      })()}

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3"
          onClick={() => setEditing(null)}
        >
          <Card
            elevated
            className="w-full max-w-3xl p-4 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">
                Edit prompt · {editing.stage} / {editing.version}
              </h3>
              <button
                type="button"
                className="text-fg-muted hover:text-fg text-lg leading-none"
                onClick={() => setEditing(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-2xs text-fg-faint">
              The prompt is hot-reloaded by the pipeline within seconds. Use{' '}
              <code className="font-mono text-fg-secondary">{'{{report_text}}'}</code>{' '}
              and other template variables that the worker substitutes.
            </p>
            <textarea
              className="w-full h-72 bg-surface-overlay border border-edge-subtle rounded-sm p-2 text-2xs font-mono text-fg-secondary focus:outline-none focus:ring-1 focus:ring-brand/40"
              value={editing.prompt_template}
              onChange={(e) =>
                setEditing({ ...editing, prompt_template: e.currentTarget.value })
              }
              spellCheck={false}
            />
            <div className="flex justify-end gap-1.5">
              <Btn variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Btn>
              <Btn onClick={saveEdit} disabled={busy === editing.id}>
                {busy === editing.id ? 'Saving…' : 'Save'}
              </Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
