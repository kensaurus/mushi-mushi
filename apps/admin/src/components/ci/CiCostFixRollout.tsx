/**
 * FILE: apps/admin/src/components/ci/CiCostFixRollout.tsx
 * PURPOSE: "Apply to every app" next to the CI advice (ADR 0047 amendment):
 *          every CI cost fix Mushi can open across the apps you may change,
 *          grouped per repo with the estimated saving, checkboxes, one
 *          confirm, then each repo's result: its draft PR, or why there is
 *          none, with every refused fix in plain words. One pull request per
 *          repo, so each repo runs CI once for all its fixes.
 *
 *          Data: GET /v1/admin/ci/cost-fix-rollout (preview), POST the same
 *          path (one bundle per repo), GET /v1/admin/ci/cost-fix-bundles/:id
 *          (each bundle until its worker finishes).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import {
  bundleItemText,
  bundleResultText,
  defaultSelection,
  isBundleInFlight,
  repoKey,
  rolloutSavingText,
  selectionRequest,
  type CiBundleResult,
  type CiCostFixBundle,
  type CiRolloutPreview,
  type CiRolloutRepo,
} from '../../lib/ciCostFixRollout'
import { costFixErrorText } from '../../lib/ciCostFix'
import { ConfirmDialog } from '../ConfirmDialog'
import { Modal } from '../Modal'
import { Btn } from '../ui'
import { IconExternalLink } from '../icons'

/** How often a bundle in flight is read again, and for how long. */
const BUNDLE_POLL_MS = 3_000
const BUNDLE_POLL_LIMIT = 60

const KIND_LABEL: Record<string, string> = {
  add_concurrency: 'Cancel superseded runs',
  skip_drafts: 'Skip draft pull requests',
  weekly_cron: 'Run the schedule weekly',
  ignore_docs_paths: 'Skip docs-only changes',
}

const fileOf = (path: string) => path.split('/').pop() ?? path

/** Always every app the caller may change, whatever app the page shows: that is the point of it. */
export function CiCostFixRollout() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="ci-rollout-open">
        Apply to every app
      </Btn>
      {open && <RolloutModal onClose={() => setOpen(false)} />}
    </>
  )
}

function RolloutModal({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<CiRolloutPreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [results, setResults] = useState<CiBundleResult[] | null>(null)

  useEffect(() => {
    let live = true
    void apiFetch<CiRolloutPreview>('/v1/admin/ci/cost-fix-rollout', { cache: 'no-store', scope: 'enumeration' }).then((res) => {
      if (!live) return
      if (res.ok && res.data) {
        setPreview(res.data)
        setSelected(defaultSelection(res.data))
      } else {
        setLoadError(res.error?.message ?? 'Mushi could not read the CI advice. Try again in a minute.')
      }
    })
    return () => {
      live = false
    }
  }, [])

  const request = useMemo(() => (preview ? selectionRequest(preview, selected) : null), [preview, selected])

  const toggle = useCallback((keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }, [])

  async function send() {
    if (!request || request.repos.length === 0) return
    setBusy(true)
    setSendError(null)
    const res = await apiFetchMutate<{ results: CiBundleResult[]; queued: number }>('/v1/admin/ci/cost-fix-rollout', {
      method: 'POST',
      body: JSON.stringify({ repos: request.repos }),
      scope: 'enumeration',
    })
    setBusy(false)
    setConfirming(false)
    if (res.ok && res.data) {
      setResults(res.data.results)
      return
    }
    setSendError(costFixErrorText(res.error?.code, res.error?.message))
  }

  const capNote =
    request && preview && (request.overRepoCap || request.overItemCap)
      ? `Mushi opens at most ${preview.caps.reposPerRequest} repos at a time and ${preview.caps.itemsPerRepo} fixes per repo. Untick some, then open the rest next time.`
      : null

  const footer = results ? (
    <div className="flex justify-end">
      <Btn variant="ghost" onClick={onClose}>
        Close
      </Btn>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-2xs text-fg-secondary" role="status">
        {request && request.repos.length > 0
          ? `${request.repos.length} ${request.repos.length === 1 ? 'repo' : 'repos'}, ${request.items} ${request.items === 1 ? 'fix' : 'fixes'}: ${rolloutSavingText(request.monthSavingUsd, request.unpriced)}.`
          : 'Pick the fixes to open.'}
      </p>
      <div className="flex gap-1.5">
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn
          variant="primary"
          disabled={!request || request.repos.length === 0 || !!capNote}
          onClick={() => setConfirming(true)}
          data-testid="ci-rollout-continue"
        >
          {request && request.repos.length > 0 ? `Open ${request.repos.length} draft ${request.repos.length === 1 ? 'PR' : 'PRs'}` : 'Open draft PRs'}
        </Btn>
      </div>
    </div>
  )

  return (
    <Modal open onClose={onClose} title="Apply CI cost fixes to every app" size="lg" footer={footer} dismissible={!busy}>
      <div className="flex flex-col gap-3 text-xs" data-testid="ci-rollout">
        {results ? (
          <RolloutResults results={results} />
        ) : loadError ? (
          <p role="alert" className="text-danger">
            {loadError}
          </p>
        ) : !preview ? (
          <p className="text-fg-muted">Reading the CI advice for your apps…</p>
        ) : preview.repos.length === 0 ? (
          <p className="text-fg-secondary">No CI cost fix Mushi can open for your apps right now.{preview.partial ? ` ${preview.partial}` : ''}</p>
        ) : (
          <>
            <p className="text-fg-secondary">
              Each repo gets <strong>one draft pull request</strong> with all its fixes, so it runs CI once. Nothing changes until you review, mark ready and
              merge each one. Mushi still refuses an edit that could do harm, and lists it in the pull request.
            </p>
            {preview.partial && <p className="text-warn">{preview.partial}</p>}
            <ul className="flex flex-col gap-2">
              {preview.repos.map((r) => (
                <RepoGroup key={repoKey(r)} repo={r} selected={selected} onToggle={toggle} />
              ))}
            </ul>
            {capNote && <p className="text-warn">{capNote}</p>}
            {sendError && (
              <p role="alert" className="text-danger">
                {sendError}
              </p>
            )}
          </>
        )}
      </div>
      {confirming && request && (
        <ConfirmDialog
          title={`Open ${request.repos.length} draft ${request.repos.length === 1 ? 'pull request' : 'pull requests'}?`}
          body={`One per repo, with ${request.items} ${request.items === 1 ? 'fix' : 'fixes'} in total: ${rolloutSavingText(request.monthSavingUsd, request.unpriced)}.`}
          details={
            <ul className="list-disc pl-4">
              {request.repos.map((r) => (
                <li key={repoKey(r)} className="wrap-break-word">
                  <code className="font-mono">{r.repo}</code>: {r.items.length} {r.items.length === 1 ? 'fix' : 'fixes'}
                </li>
              ))}
            </ul>
          }
          confirmLabel="Open draft PRs"
          loading={busy}
          onConfirm={send}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  )
}

function RepoGroup({ repo, selected, onToggle }: { repo: CiRolloutRepo; selected: ReadonlySet<string>; onToggle: (keys: string[], on: boolean) => void }) {
  const ready = repo.items.filter((i) => i.state === 'ready')
  const picked = ready.filter((i) => selected.has(i.key))
  const all = ready.length > 0 && picked.length === ready.length
  return (
    <li className="rounded-sm border border-edge-subtle p-2" data-testid="ci-rollout-repo">
      <label className="flex min-w-0 items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-brand"
          checked={all}
          disabled={ready.length === 0}
          aria-label={`All fixes in ${repo.repo}`}
          onChange={(e) => onToggle(ready.map((i) => i.key), e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-fg wrap-break-word">{repo.repo}</span>
          {repo.projectName && <span className="text-fg-muted"> · {repo.projectName}</span>}
          <span className="block text-2xs text-fg-secondary">
            {ready.length > 0 ? `${ready.length} ready: ${rolloutSavingText(repo.monthSavingUsd, repo.unpricedItems)}` : 'Nothing new to open here.'}
          </span>
        </span>
      </label>
      {repo.block && (
        <p className="mt-1 text-2xs text-warn wrap-break-word" role="note">
          {repo.block.message}
        </p>
      )}
      <ul className="mt-1.5 flex flex-col gap-1 pl-5">
        {repo.items.map((i) => (
          <li key={i.key} className="flex min-w-0 items-start gap-2 text-2xs">
            <input
              type="checkbox"
              className="mt-0.5 h-3 w-3 accent-brand"
              checked={i.state === 'ready' && selected.has(i.key)}
              disabled={i.state !== 'ready'}
              aria-label={`${KIND_LABEL[i.kind] ?? i.kind} in ${i.workflowPath}`}
              onChange={(e) => onToggle([i.key], e.target.checked)}
            />
            <span className="min-w-0 flex-1 wrap-break-word">
              <span className="text-fg">{KIND_LABEL[i.kind] ?? i.kind}</span> in <code className="font-mono">{fileOf(i.workflowPath)}</code>
              <span className="text-fg-muted">
                {' '}
                · {i.monthSavingUsd == null ? 'not priced' : `about $${i.monthSavingUsd.toFixed(2)}/mo`}
                {i.state === 'in_progress' && ' · being opened'}
              </span>
              {i.state === 'pr_open' && (
                <>
                  <span className="text-fg-muted"> · already open: </span>
                  {i.prUrl ? (
                    <a href={i.prUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                      pull request
                    </a>
                  ) : (
                    'pull request'
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}

/** Each repo's answer, with its bundle read until the worker finishes. */
function RolloutResults({ results }: { results: CiBundleResult[] }) {
  const [bundles, setBundles] = useState<Record<string, CiCostFixBundle>>({})
  const [polls, setPolls] = useState(0)
  const ids = results.flatMap((r) => (r.bundleId ? [r.bundleId] : []))
  const pending = ids.filter((id) => !bundles[id] || isBundleInFlight(bundles[id]))
  const pendingKey = pending.join(',')

  useEffect(() => {
    if (!pendingKey || polls >= BUNDLE_POLL_LIMIT) return
    let live = true
    const t = setTimeout(
      () => {
        void Promise.all(
          pendingKey.split(',').map((id) => apiFetch<{ bundle: CiCostFixBundle }>(`/v1/admin/ci/cost-fix-bundles/${id}`, { cache: 'no-store' })),
        ).then((answers) => {
          if (!live) return
          setBundles((prev) => {
            const next = { ...prev }
            for (const a of answers) if (a.ok && a.data?.bundle) next[a.data.bundle.id] = a.data.bundle
            return next
          })
          setPolls((n) => n + 1)
        })
      },
      polls === 0 ? 0 : BUNDLE_POLL_MS,
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [pendingKey, polls])

  return (
    <ul className="flex flex-col gap-2" data-testid="ci-rollout-results">
      {results.map((r) => {
        const bundle = r.bundleId ? (bundles[r.bundleId] ?? null) : null
        const failed = r.status === 'error' || bundle?.status === 'failed' || bundle?.status === 'nothing_opened'
        return (
          <li key={repoKey(r)} className="rounded-sm border border-edge-subtle p-2" data-testid="ci-rollout-result">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-fg wrap-break-word">{r.repo}</span>
              {bundle?.prUrl && (
                <a href={bundle.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-2xs text-brand hover:underline">
                  {bundle.prNumber ? `PR #${bundle.prNumber}` : 'Pull request'}
                  <IconExternalLink size={11} />
                </a>
              )}
            </div>
            <p role="status" className={`text-2xs wrap-break-word ${failed ? 'text-danger' : 'text-fg-secondary'}`}>
              {bundleResultText(r, bundle)}
            </p>
            {bundle && !isBundleInFlight(bundle) && (
              <ul className="mt-1 flex flex-col gap-0.5 pl-3 text-2xs text-fg-secondary">
                {bundle.items.map((j) => (
                  <li key={j.id} className={`wrap-break-word ${j.status === 'refused' || j.status === 'failed' ? 'text-danger' : ''}`}>
                    <span className="text-fg">{KIND_LABEL[j.kind] ?? j.kind}</span> in <code className="font-mono">{fileOf(j.workflowPath)}</code>: {bundleItemText(j)}
                  </li>
                ))}
              </ul>
            )}
            {r.skipped.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 pl-3 text-2xs text-fg-muted">
                {r.skipped.map((s) => (
                  <li key={`${s.workflowPath}:${s.kind}`} className="wrap-break-word">
                    {KIND_LABEL[s.kind] ?? s.kind} in <code className="font-mono">{fileOf(s.workflowPath)}</code>: {s.message}{' '}
                    {s.prUrl && (
                      <a href={s.prUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                        Open it
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
      {pending.length > 0 && polls >= BUNDLE_POLL_LIMIT && (
        <li className="text-2xs text-fg-muted">Still opening. Reload the CI page in a few minutes to see each pull request on its fix card.</li>
      )}
    </ul>
  )
}
