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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { DisclosurePanel, SegmentedControl } from '../components/ui'
import { PageLoadError } from '../components/PageLoadError'
import { describeApiError } from '../lib/humanizeApiError'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { shouldHideGuideWhenBannerActive, COMMON_HEALTHY_PRIORITIES } from '../lib/pagePostureHelpers'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { usePublishPageContext } from '../lib/pageContext'
import { STAGE_LABELS, type PromptLabData, type PromptVersion } from '../components/prompt-lab/types'
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

export function PromptLabPage() {
  const { data, loading, error, errorCode, reload } = usePageData<PromptLabData>('/v1/admin/prompt-lab')
  const {
    data: statsData,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
    reload: reloadStats,
  } = usePageData<PromptLabStats>('/v1/admin/prompt-lab/stats')
  const [searchParams] = useSearchParams()
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

  // Banner and deep links send ?tab=prompts&stage=<stage>: open that stage's
  // table and bring it into view (the param used to be ignored, so the
  // banner's only action re-rendered the same page). ?tab=dataset (the Eval
  // dataset tile) scrolls to the dataset card.
  const tabParam = searchParams.get('tab')
  const stageParam = searchParams.get('stage')
  // Applied once per link, so a background reload does not scroll again.
  const appliedLinkRef = useRef<string | null>(null)
  useEffect(() => {
    if (!data) return
    const key = `${tabParam ?? ''}|${stageParam ?? ''}`
    if (appliedLinkRef.current === key) return
    appliedLinkRef.current = key
    if (stageParam && grouped[stageParam]) setActiveStage(stageParam)
    if (tabParam === 'prompts' || stageParam) {
      document.getElementById('prompt-lab-stages')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (tabParam === 'dataset') {
      document.getElementById('prompt-lab-dataset')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [data, grouped, tabParam, stageParam])

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
      reloadStats()
    } else {
      const e = describeApiError(res.error, 'Could not clone the prompt')
      toast.error(e.title, e.hint)
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
      const e = describeApiError(res.error, 'Could not activate the prompt')
      toast.error(e.title, e.hint)
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
      const e = describeApiError(res.error, 'Could not change the traffic split')
      toast.error(e.title, e.hint)
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
      const e = describeApiError(res.error, 'Could not delete the prompt')
      toast.error(e.title, e.hint)
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
      const e = describeApiError(res.error, 'Could not save the prompt')
      toast.error(e.title, e.hint)
    }
  }

  // Publish context: "Prompt Lab · 4 active · 2 candidates — Mushi Mushi"
  const promptList = data?.prompts ?? []
  const activePrompts = promptList.filter((p) => p.is_active).length
  const candidatePrompts = promptList.length - activePrompts
  usePublishPageContext({
    route: '/prompt-lab',
    title: 'AI prompts',
    summary: loading
      ? 'Loading prompts…'
      : promptList.length === 0
        ? 'No prompt versions yet'
        : `${activePrompts} active · ${candidatePrompts} candidate${candidatePrompts === 1 ? '' : 's'}`,
  })

  if (loading) return <TableSkeleton rows={6} columns={5} showFilters showKpiStrip label="Loading prompt lab" />
  if (error) return <PageLoadError error={error} code={errorCode} onRetry={reload} />
  if (!data) return null

  const parentForDiff = diffing
    ? data.prompts.find((p) => p.id === diffing.parent_version_id)
    : undefined

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-prompt-lab">
      <PageHeaderBar
        title="AI prompts"

        helpTitle="About AI prompts"
        helpWhatIsIt="The control plane for the LLM prompts that drive fast-filter (Stage 1) and classify-report (Stage 2). Clone a baseline, edit it, run it as a candidate at 10% traffic, and promote when the judge score beats the active version."
        helpUseCases={[
          'A/B test a sharper Stage 2 prompt before flipping it on for everyone',
          'Iterate on category rules without redeploying — prompts hot-reload from the DB',
          'Audit who changed what, when, and what the judge thought of it',
          'Validate prompt changes against synthetic reports before they reach real users',
        ]}
        helpHowToUse="Pick a baseline → Clone → Edit → set Traffic % to a small number (e.g. 10) → wait for the judge to score it → Promote if it beats the active prompt. Global defaults are read-only; clone first."
      />

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <PromptLabStatusBanner
                stats={promptLabStats}
                onRefresh={() => {
                  reload()
                  reloadStats()
                }}
                refreshing={statsValidating}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            children: (
              <PromptLabSnapshotStrip
                stats={promptLabStats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                dataset={{ total: data.dataset.total, labelled: data.dataset.labelled }}
                bestIsBuiltIn={data.prompts.some(
                  (p) =>
                    p.project_id == null &&
                    p.stage === promptLabStats.bestStage &&
                    p.version === promptLabStats.bestVersion,
                )}
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

      {orderedStages.length > 0 && visibleStage && (
        <div id="prompt-lab-stages" className="flex min-w-0 items-center gap-1.5 scroll-mt-4">
          <ConfigHelp helpId="prompt-lab.stage" />
          <SegmentedControl<string>
            size="sm"
            scrollable
            ariaLabel="Prompt stage"
            value={visibleStage}
            options={orderedStages.map((stage) => ({
              id: stage,
              label: STAGE_LABELS[stage] ?? stage,
              count: grouped[stage]?.length ?? 0,
            }))}
            onChange={setActiveStage}
          />
        </div>
      )}

      {visibleStage && (
        <PromptStageTable
          key={visibleStage}
          stage={visibleStage}
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

      <EvalDatasetCard
        total={data.dataset.total}
        labelled={data.dataset.labelled}
        recentSamples={data.dataset.recentSamples}
      />

      {/* Rare-use tools: vendor fine-tuning jobs and synthetic test reports. */}
      <DisclosurePanel title="Advanced: fine-tuning & synthetic">
        <div className="space-y-4">
          <FineTuningJobsCard jobs={data.fineTuningJobs ?? []} onChange={reload} />
          <SyntheticReportsCard />
        </div>
      </DisclosurePanel>

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
