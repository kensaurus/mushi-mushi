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
  ErrorAlert,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { shouldHideGuideWhenBannerActive, COMMON_HEALTHY_PRIORITIES } from '../lib/pagePostureHelpers'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { usePublishPageContext } from '../lib/pageContext'
import type { PromptLabData, PromptVersion } from '../components/prompt-lab/types'
import { PromptStageTable } from '../components/prompt-lab/PromptStageTable'
import { PromptEditorModal } from '../components/prompt-lab/PromptEditorModal'
import { PromptDiffModal } from '../components/prompt-lab/PromptDiffModal'
import { ConfirmDialog, PromptDialog } from '../components/ConfirmDialog'
import { EvalDatasetCard } from '../components/prompt-lab/EvalDatasetCard'
import { FineTuningJobsCard } from '../components/prompt-lab/FineTuningJobsCard'
import { SyntheticReportsCard } from '../components/prompt-lab/SyntheticReportsCard'
import { ConfigHelp } from '../components/ConfigHelp'
import { PromptLabStatusBanner } from '../components/prompt-lab/PromptLabStatusBanner'
import { PromptLabGuide } from '../components/prompt-lab/PromptLabGuide'
import { PromptLabSnapshotStrip } from '../components/prompt-lab/PromptLabSnapshotStrip'
import { PromptLabReadout } from '../components/prompt-lab/PromptLabReadout'
import { EMPTY_PROMPT_LAB_STATS, type PromptLabStats } from '../components/prompt-lab/PromptLabStatsTypes'
import {
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'

export function PromptLabPage() {
  const { data, loading, error, reload } = usePageData<PromptLabData>('/v1/admin/prompt-lab')
  const { data: statsData, lastFetchedAt: statsFetchedAt, isValidating: statsValidating } =
    usePageData<PromptLabStats>('/v1/admin/prompt-lab/stats')
  usePublishPageHeroStats('/prompt-lab', statsData)
  const promptLabStats = statsData ?? EMPTY_PROMPT_LAB_STATS
  const [editing, setEditing] = useState<PromptVersion | null>(null)
  const [diffing, setDiffing] = useState<PromptVersion | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [trafficTarget, setTrafficTarget] = useState<PromptVersion | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PromptVersion | null>(null)
  const [activateTarget, setActivateTarget] = useState<PromptVersion | null>(null)
  const toast = useToast()

  const grouped = useMemo(() => {
    // Wave R (2026-04-22): migration 20260422110000 added six new stages
    // (judge, intelligence, fix, prompt_tune, nl_plan, nl_summary, synthetic,
    // modernizer) to prompt_versions. The table is keyed by whatever stages
    // actually have rows — we no longer hardcode ['stage1', 'stage2'] so a
    // newly-introduced stage shows up without a frontend change.
    const out: Record<string, PromptVersion[]> = {}
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

  // Stable stage ordering: pipeline stages first in PDCA flow order, anything
  // unknown falls to the end alphabetically. Keeps the tab bar predictable
  // across deploys.
  const STAGE_ORDER = [
    'stage1', 'stage2', 'judge', 'fix', 'intelligence',
    'nl_plan', 'nl_summary', 'synthetic', 'modernizer', 'prompt_tune',
  ] as const
  const STAGE_LABEL: Record<string, string> = {
    stage1: 'Stage 1 (fast-filter)',
    stage2: 'Stage 2 (classify)',
    judge: 'Judge',
    fix: 'Fix-worker',
    intelligence: 'Intelligence digest',
    nl_plan: 'NL → SQL planner',
    nl_summary: 'NL → summary',
    synthetic: 'Synthetic generator',
    modernizer: 'Dep modernizer',
    prompt_tune: 'Prompt auto-tune',
  }
  const orderedStages = Object.keys(grouped).sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a as typeof STAGE_ORDER[number])
    const ib = STAGE_ORDER.indexOf(b as typeof STAGE_ORDER[number])
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
  const [activeStage, setActiveStage] = useState<string | null>(null)
  const visibleStage = activeStage ?? orderedStages[0] ?? null

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

  function activatePrompt(p: PromptVersion) {
    setActivateTarget(p)
  }

  async function commitActivatePrompt() {
    if (!activateTarget) return
    const p = activateTarget
    setActivateTarget(null)
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

  function setTraffic(p: PromptVersion) {
    setTrafficTarget(p)
  }

  async function commitTraffic(raw: string) {
    if (!trafficTarget) return
    const p = trafficTarget
    const n = Number(raw)
    const pct = Math.max(0, Math.min(100, Math.round(n)))
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ trafficPercentage: pct }),
    })
    setBusy(null)
    setTrafficTarget(null)
    if (res.ok) {
      toast.push({ tone: 'success', message: `Traffic set to ${pct}%` })
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Update failed' })
    }
  }

  function deletePrompt(p: PromptVersion) {
    setDeleteTarget(p)
  }

  async function commitDelete() {
    if (!deleteTarget) return
    const p = deleteTarget
    setBusy(p.id)
    const res = await apiFetch(`/v1/admin/prompt-lab/prompts/${p.id}`, { method: 'DELETE' })
    setBusy(null)
    setDeleteTarget(null)
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

  // Publish context: "Prompt Lab · 4 active · 2 candidates — Mushi Mushi"
  const promptList = data?.prompts ?? []
  const activePrompts = promptList.filter((p) => p.is_active).length
  const candidatePrompts = promptList.length - activePrompts
  usePublishPageContext({
    route: '/prompt-lab',
    title: 'Prompt Lab',
    summary: loading
      ? 'Loading prompts…'
      : promptList.length === 0
        ? 'No prompt versions yet'
        : `${activePrompts} active · ${candidatePrompts} candidate${candidatePrompts === 1 ? '' : 's'}`,
  })

  if (loading) return <TableSkeleton rows={6} columns={5} showFilters showKpiStrip label="Loading prompt lab" />
  if (error) return <ErrorAlert message={error} onRetry={reload} />
  if (!data) return null

  const totalEvals = data.prompts.reduce((s, p) => s + p.total_evaluations, 0)
  const candidates = data.prompts.filter((p) => p.is_candidate).length
  const parentForDiff = diffing
    ? data.prompts.find((p) => p.id === diffing.parent_version_id)
    : undefined

  return (
    <div className="space-y-5">
      <PageHeaderBar
        title="Prompt Lab"
        description="Test prompt versions live before promoting them to production. Diff outputs side-by-side."
        helpTitle="About Prompt Lab"
        helpWhatIsIt="The control plane for the LLM prompts that drive fast-filter (Stage 1) and classify-report (Stage 2). Clone a baseline, edit it, run it as a candidate at 10% traffic, and promote when the judge score beats the active version."
        helpUseCases={[
          'A/B test a sharper Stage 2 prompt before flipping it on for everyone',
          'Iterate on category rules without redeploying — prompts hot-reload from the DB',
          'Audit who changed what, when, and what the judge thought of it',
          'Validate prompt changes against synthetic reports before they reach real users',
        ]}
        helpHowToUse="Pick a baseline → Clone → Edit → set Traffic % to a small number (e.g. 10) → wait for the judge to score it → Promote if it beats the active prompt. Global defaults are read-only; clone first."
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <SignalChip tone="neutral">{data.prompts.length} prompts</SignalChip>
          <SignalChip tone="brand">{totalEvals.toLocaleString()} evals</SignalChip>
        </div>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: <PromptLabStatusBanner stats={promptLabStats} />,
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <PromptLabSnapshotStrip
                stats={promptLabStats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                hint="Active prompts, candidates, best judge score, and eval dataset coverage."
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: !shouldHideGuideWhenBannerActive(
              true,
              [...COMMON_HEALTHY_PRIORITIES, 'no_project'],
              promptLabStats.topPriority,
            ),
            children: <PromptLabGuide topPriority={promptLabStats.topPriority} stats={promptLabStats} />,
          },
        ]}
      />

      <PromptLabReadout
        stats={promptLabStats}
        fetchedAt={statsFetchedAt}
        isValidating={statsValidating}
      />

      {/* Workflow strip.
          Pre-2026-05-07 the page jumped straight from the help block into a
          KPI grid + stage tabs + a long table of prompt versions. New
          operators reported "hard to understand" because the *workflow*
          (clone → edit → A/B test → promote) is implied by the column
          actions but never made visible. This 4-step ribbon names the
          loop in plain language so the user sees the journey before the
          data, and each step's caption maps to a concrete control further
          down the page (action chips on the table rows, the traffic %
          dialog, the activate button). NN/g #10 (Help & Documentation)
          + Hick's Law: choices framed as a journey reduce decision load. */}
      <PromptLabWorkflow
        candidates={candidates}
        active={data.prompts.filter((p) => p.is_active).length}
      />

      {orderedStages.length > 0 && (
        // Stage tabs.
        // Earlier this was a transparent border-b strip with text-only
        // tabs — at 1024 px the active tab disappeared into the body
        // copy because both used `text-xs font-medium` and only a 2 px
        // border separated them. The new chrome (a) gives the strip a
        // tonal recess (`bg-surface-raised`) so it reads as a
        // discrete navigation primitive, and (b) lets the active tab
        // adopt a soft pill (`bg-surface-raised text-fg`) instead of a
        // hairline underline. Inactive tabs stay calm (`text-fg-muted`)
        // so the active one still wins the squint test. This matches
        // the SegmentedControl tone elsewhere in the app — see
        // ui.tsx → SegmentedControl — without forcing radio semantics
        // (these are page-level navigation, not a multi-select). The
        // count chip switches to a brand tint when active so the
        // "what stage am I in?" answer is double-encoded (background
        // + chip), satisfying NN/g #1 (Visibility) at a squint.
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-edge-subtle bg-surface-raised p-1">
          <ConfigHelp helpId="prompt-lab.stage" />
          {orderedStages.map((stage) => {
            const count = grouped[stage]?.length ?? 0
            const active = visibleStage === stage
            return (
              <button
                key={stage}
                type="button"
                onClick={() => setActiveStage(stage)}
                aria-pressed={active}
                className={`px-2.5 py-1.5 text-xs rounded-sm motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                  active
                    ? 'bg-surface-raised text-fg font-medium shadow-raised'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-overlay/60'
                }`}
              >
                {STAGE_LABEL[stage] ?? stage}
                <span className={`ml-1.5 text-2xs font-mono ${active ? 'text-brand' : 'text-fg-faint'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {visibleStage && (
        <PromptStageTable
          key={visibleStage}
          stage={visibleStage as 'stage1' | 'stage2'}
          prompts={grouped[visibleStage] ?? []}
          busy={busy}
          onClone={clonePrompt}
          onEdit={setEditing}
          onDiff={setDiffing}
          onActivate={activatePrompt}
          onTraffic={setTraffic}
          onDelete={deletePrompt}
        />
      )}

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

      {trafficTarget && (
        <PromptDialog
          title={`A/B traffic for ${trafficTarget.version}`}
          body="Set the percentage of live classifications routed to this prompt. The remainder stays on the currently-active prompt."
          label="Traffic share (0–100)"
          inputType="number"
          defaultValue={String(trafficTarget.traffic_percentage)}
          confirmLabel="Update traffic"
          loading={busy === trafficTarget.id}
          validate={(v) => {
            const n = Number(v)
            if (!Number.isFinite(n)) return 'Enter a number between 0 and 100.'
            if (n < 0 || n > 100) return 'Traffic must be between 0 and 100.'
            return null
          }}
          onConfirm={commitTraffic}
          onCancel={() => setTrafficTarget(null)}
        />
      )}

      {activateTarget && (
        <ConfirmDialog
          title={`Activate ${activateTarget.version} at 100%?`}
          body={`This sets "${activateTarget.version}" to serve 100% of ${activateTarget.stage} traffic immediately, replacing the current active prompt. All A/B splits will be removed. This is irreversible without a manual rollback.`}
          confirmLabel="Activate at 100%"
          onConfirm={commitActivatePrompt}
          onCancel={() => setActivateTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete prompt ${deleteTarget.version}?`}
          body={`This removes "${deleteTarget.version}" from the prompt registry. Its historical evaluations stay in the dataset, but the prompt can no longer serve traffic. This cannot be undone.`}
          confirmLabel="Delete prompt"
          tone="danger"
          loading={busy === deleteTarget.id}
          onConfirm={commitDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

/* ── Workflow ribbon ──────────────────────────────────────────────────── */

interface PromptLabWorkflowProps {
  candidates: number
  active: number
}

interface WorkflowStep {
  num: number
  label: string
  copy: string
  /** When set, the step renders a small status chip on the right showing
   *  live state (e.g. how many candidates are awaiting eval) so the
   *  ribbon is data-backed instead of decorative. */
  badge?: { value: string; tone: 'ok' | 'info' | 'muted' }
}

/**
 * Four-step workflow ribbon — Baseline → Clone & edit → A/B test →
 * Promote. Renders the prompt-lab journey as a horizontal scent trail so
 * a new operator can read the page in 5 seconds before they touch any
 * control. Live counts (active prompts, candidates awaiting eval) are
 * pulled from the same data the KPI row consumes — see #5 NN/g (Error
 * prevention) and #1 (Visibility of system status). On narrow viewports
 * the steps stack with the connector arrow rotating to a vertical glyph
 * so the ribbon doesn't spill horizontally.
 */
function PromptLabWorkflow({ candidates, active }: PromptLabWorkflowProps) {
  const steps: WorkflowStep[] = [
    {
      num: 1,
      label: 'Baseline',
      copy: 'Pick the active prompt for a stage. Global defaults are read-only.',
      badge: active > 0 ? { value: `${active} live`, tone: 'ok' } : { value: 'no active', tone: 'muted' },
    },
    {
      num: 2,
      label: 'Clone & edit',
      copy: 'Fork it into a project candidate. Editing the fork never touches production traffic.',
    },
    {
      num: 3,
      label: 'A/B test',
      copy: 'Set Traffic % to a small number. The judge scores its outputs against ground truth.',
      badge: candidates > 0 ? { value: `${candidates} testing`, tone: 'info' } : undefined,
    },
    {
      num: 4,
      label: 'Promote',
      copy: 'When the candidate beats the active by >2%, flip it to 100% — the swap is instant.',
    },
  ]
  const toneClass: Record<NonNullable<WorkflowStep['badge']>['tone'], string> = {
    ok: 'bg-ok-subtle text-ok',
    info: 'bg-info-subtle text-info',
    muted: 'bg-surface-overlay text-fg-faint',
  }
  return (
    <div
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 rounded-md border border-edge-subtle bg-surface-raised p-3"
      aria-label="Prompt lab workflow"
    >
      {steps.map((step, i) => (
        <div key={step.num} className="relative min-w-0">
          <div className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full border border-edge text-2xs font-mono text-fg-secondary bg-surface-raised"
            >
              {step.num}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-fg">{step.label}</span>
                {step.badge && (
                  <span className={`text-3xs font-mono px-1.5 py-0.5 rounded-sm ${toneClass[step.badge.tone]}`}>
                    {step.badge.value}
                  </span>
                )}
              </div>
              <InlineProof className="mt-1">{step.copy}</InlineProof>
            </div>
          </div>
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className="hidden lg:block absolute right-0 top-3 -translate-y-1/2 -mr-1.5 text-fg-faint"
            >
              →
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
