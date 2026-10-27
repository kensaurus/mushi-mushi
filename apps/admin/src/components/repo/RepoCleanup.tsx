/**
 * FILE: apps/admin/src/components/repo/RepoCleanup.tsx
 * PURPOSE: Repo → Clean up (ADR 0051): delete the branches Mushi made whose
 *          pull request merged or closed, close Mushi's own stale, replaced
 *          or held fix PRs, turn on GitHub's automatic branch deletion, and
 *          restore a branch Mushi deleted.
 *
 * Nothing changes on GitHub from one click. Anyone who can edit the app asks
 * for a list; an owner or admin approves exactly that list (it expires after
 * an hour) and runs it once; Mushi checks every item again when it runs and
 * says, per item, what it did or why it refused.
 *
 * Data: GET  /v1/admin/projects/:id/repo-cleanup
 *       POST /v1/admin/projects/:id/repo-cleanup/requests         (ask)
 *       POST /v1/admin/projects/:id/repo-cleanup/restore          (ask to restore)
 *       POST /v1/admin/projects/:id/repo-cleanup/requests/:actionId/approve|reject|execute
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Badge, Btn, Callout, Card, Checkbox, DisclosurePanel, Loading } from '../ui'
import { ConfirmDialog } from '../ConfirmDialog'
import { PageLoadError } from '../PageLoadError'
import { formatRelative } from '../ui/metrics'
import { apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import {
  actionTitle,
  CLEANUP_STATUS,
  OUTCOME,
  shortSha,
  WHY_LABEL,
  type CleanupAction,
  type CleanupRepo,
  type CleanupView,
} from '../../lib/repoCleanup'

type Notice = { tone: 'info' | 'danger'; text: string } | null

export function RepoCleanup({ projectId }: { projectId: string }) {
  const base = `/v1/admin/projects/${projectId}/repo-cleanup`
  const { data, loading, error, reload } = usePageData<CleanupView>(base)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [confirm, setConfirm] = useState<{ action: CleanupAction; kind: 'execute' | 'reject' } | null>(null)

  const post = async (url: string, body: unknown, okText: (data: unknown) => string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<unknown>(url, { method: 'POST', body: JSON.stringify(body ?? {}) })
      setNotice(res.ok ? { tone: 'info', text: okText(res.data) } : { tone: 'danger', text: res.error?.message ?? 'That did not work. Try again in a minute.' })
      return res.ok
    } finally {
      setBusy(false)
      reload()
    }
  }

  const ask = (repo: string, action: 'delete_branches' | 'close_prs' | 'set_delete_branch_on_merge', keys?: string[]) =>
    post(`${base}/requests`, { action, repo, ...(keys ? { keys } : {}) }, () => 'Asked. An owner or admin approves it under "Waiting for a decision" before anything changes on GitHub.')

  const waiting = useMemo(() => (data?.actions ?? []).filter((a) => a.status === 'pending_approval' || a.status === 'approved' || a.status === 'executing'), [data])
  const finished = useMemo(() => (data?.actions ?? []).filter((a) => !waiting.includes(a)).slice(0, 10), [data, waiting])

  if (error) return <PageLoadError error={error} resource="clean-up list" endpoint={base} onRetry={reload} />
  if (loading && !data) return <Loading text="Reading your repositories…" />
  if (!data) return null

  return (
    <div className="flex flex-col gap-3">
      <Callout tone="info" label="How clean-up works">
        <p className="text-xs text-fg-secondary">
          Mushi lists only branches and pull requests it opened itself, each with the reason and the commit it points at.
          Nothing changes until an owner or admin approves that exact list; the approval lasts {data.limits.approvalMinutes} minutes and runs once.
          When it runs, Mushi checks every item again and refuses the default branch, protected branches, branches an open pull request uses, and anything that moved.
          At most {data.limits.maxItems} items in one clean-up and {data.limits.perHour} clean-ups an hour per app.
        </p>
        <p className="mt-1 text-xs text-fg-muted">{data.raceNote}</p>
      </Callout>
      {data.migrationPending && (
        <Callout tone="warn">
          <span className="text-xs">The clean-up log is not in this database yet (update 20261027183000_repo_housekeeping_items). You can read the list; running a clean-up waits for it.</span>
        </Callout>
      )}
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status" className="text-xs">{notice.text}</span>
        </Callout>
      )}

      {waiting.length > 0 && (
        <Card className="p-3">
          <h3 className="mb-2 text-sm font-semibold text-fg">Waiting for a decision</h3>
          <ul className="flex flex-col divide-y divide-edge-subtle">
            {waiting.map((a) => (
              <ActionRow key={a.id} action={a}>
                {!data.canDecide && <p className="text-2xs text-fg-faint">An owner or admin of the team decides.</p>}
                {data.canDecide && (
                  <div className="flex flex-wrap gap-2">
                    {a.status === 'pending_approval' && (
                      <Btn size="sm" disabled={busy || data.migrationPending} onClick={() => post(`${base}/requests/${a.id}/approve`, { payloadSha256: a.payloadSha256 }, () => 'Approved for one hour. Run it when you are ready.')}>
                        Approve this list
                      </Btn>
                    )}
                    {a.status === 'approved' && (
                      <Btn size="sm" variant="danger" disabled={busy} onClick={() => setConfirm({ action: a, kind: 'execute' })}>
                        Run now
                      </Btn>
                    )}
                    {(a.status === 'pending_approval' || a.status === 'approved') && (
                      <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({ action: a, kind: 'reject' })}>
                        Reject
                      </Btn>
                    )}
                  </div>
                )}
              </ActionRow>
            ))}
          </ul>
        </Card>
      )}

      {data.repos.map((r) => (
        <RepoCard key={r.repo} repo={r} canRequest={data.canRequest} busy={busy} staleDays={data.staleDays} onAsk={ask} />
      ))}
      {data.repos.length === 0 && <p className="text-xs text-fg-muted">No GitHub repository is connected to this app.</p>}

      {data.restorable.length > 0 && (
        <RestoreCard items={data.restorable} canRequest={data.canRequest} busy={busy} onRestore={(itemIds) => post(`${base}/restore`, { itemIds }, () => 'Asked to restore. An owner or admin approves it before Mushi recreates the branches.')} />
      )}

      {finished.length > 0 && (
        <DisclosurePanel title="Recent clean-ups" trailing={<span className="text-2xs font-normal text-fg-faint">{finished.length}</span>}>
          <ul className="flex flex-col divide-y divide-edge-subtle px-3">
            {finished.map((a) => <ActionRow key={a.id} action={a} />)}
          </ul>
        </DisclosurePanel>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'execute' ? `${actionTitle(confirm.action)} now?` : `Reject "${actionTitle(confirm.action)}"?`}
          body={
            confirm.kind === 'execute'
              ? 'Mushi checks each item again first and skips anything that moved or that an open pull request uses. Deleted branches can be restored from this tab at the commit shown; a closed pull request can be reopened on GitHub.'
              : 'The request closes and cannot be approved later. Ask again if you change your mind.'
          }
          details={confirm.kind === 'execute' ? <ItemList action={confirm.action} /> : undefined}
          confirmLabel={confirm.kind === 'execute' ? 'Run now' : 'Reject'}
          tone="danger"
          loading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const { action, kind } = confirm
            if (kind === 'execute') await post(`${base}/requests/${action.id}/execute`, {}, (d) => (d as { detail?: string; status?: string } | null)?.detail ?? 'Still running. Each item’s result appears below as it finishes.')
            else await post(`${base}/requests/${action.id}/reject`, {}, () => 'Rejected.')
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

function ItemList({ action }: { action: CleanupAction }) {
  const items = action.payload.items ?? []
  if (items.length === 0) return null
  return (
    <ul className="max-h-48 overflow-y-auto font-mono text-2xs text-fg-secondary">
      {items.map((i) => (
        <li key={i.key}>
          {i.branch ?? (i.prNumber ? `#${i.prNumber}` : i.key)} {shortSha(i.headSha ?? i.sha)}
        </li>
      ))}
    </ul>
  )
}

function ActionRow({ action, children }: { action: CleanupAction; children?: ReactNode }) {
  const st = CLEANUP_STATUS[action.status] ?? CLEANUP_STATUS.pending_approval
  const results = action.result?.items ?? []
  return (
    <li className="flex flex-col gap-1.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-fg">{actionTitle(action)}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="text-2xs text-fg-faint">
        Asked {formatRelative(action.requestedAt)}
        {action.expiresAt && action.status === 'approved' ? ` · approval ends ${new Date(action.expiresAt).toLocaleTimeString()}` : ''}
        {action.reason ? ` · ${action.reason}` : ''}
      </p>
      {results.length === 0 && action.status !== 'executed' && <ItemList action={action} />}
      {action.error && results.length === 0 && <p className="text-xs text-danger">{action.error}</p>}
      {results.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {results.map((r) => (
            <li key={r.key} className="flex flex-wrap items-baseline gap-2 text-2xs">
              <Badge tone={OUTCOME[r.outcome]?.tone ?? 'neutral'}>{OUTCOME[r.outcome]?.label ?? r.outcome}</Badge>
              <span className="font-mono text-fg-secondary">{r.branch ?? (r.prNumber ? `#${r.prNumber}` : r.key)}</span>
              <span className="text-fg-muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </li>
  )
}

function RepoCard({ repo, canRequest, busy, staleDays, onAsk }: {
  repo: CleanupRepo
  canRequest: boolean
  busy: boolean
  staleDays: number
  onAsk: (repo: string, action: 'delete_branches' | 'close_prs' | 'set_delete_branch_on_merge', keys?: string[]) => Promise<boolean>
}) {
  const [branches, setBranches] = useState<Set<string>>(() => new Set(repo.branches.map((b) => b.key)))
  const [prs, setPrs] = useState<Set<string>>(() => new Set(repo.prs.map((p) => p.key)))
  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(key)
    else next.delete(key)
    return next
  }
  const chosenBranches = repo.branches.filter((b) => branches.has(b.key)).map((b) => b.key)
  const chosenPrs = repo.prs.filter((p) => prs.has(p.key)).map((p) => p.key)

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{repo.repo}</h3>
        {repo.defaultBranch && <span className="text-2xs text-fg-faint">default branch {repo.defaultBranch}</span>}
      </div>
      {repo.error && (
        <Callout tone="warn">
          <span className="text-xs">{repo.error}</span>
        </Callout>
      )}
      {repo.truncated && <p className="text-2xs text-fg-muted">GitHub listed more than Mushi reads at once; run another clean-up after this one to see the rest.</p>}

      {!repo.error && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-fg">Branches to delete ({repo.branches.length})</h4>
          {repo.branches.length === 0 ? (
            <p className="text-2xs text-fg-muted">Nothing to delete: every branch Mushi made is gone or still in use.{repo.gone > 0 ? ` ${repo.gone} are already gone from GitHub.` : ''}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {repo.branches.map((b) => (
                  <li key={b.key} className="flex flex-col gap-0.5">
                    <Checkbox label={`${b.branch} at ${shortSha(b.headSha)}`} checked={branches.has(b.key)} disabled={!canRequest} onChange={(on) => setBranches((s) => toggle(s, b.key, on))} />
                    <span className="pl-5 text-2xs text-fg-muted">{b.reason}</span>
                  </li>
                ))}
              </ul>
              <div>
                <Btn size="sm" disabled={busy || !canRequest || chosenBranches.length === 0 || chosenBranches.length > 50} onClick={() => onAsk(repo.repo, 'delete_branches', chosenBranches)}>
                  Ask to delete {chosenBranches.length} branch{chosenBranches.length === 1 ? '' : 'es'}
                </Btn>
              </div>
            </>
          )}
        </section>
      )}

      {!repo.error && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-fg">Fix pull requests to close ({repo.prs.length})</h4>
          {repo.prs.length === 0 ? (
            <p className="text-2xs text-fg-muted">None: no open Mushi fix is replaced by a newer one, held by Opus, or without new commits for {staleDays} days.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {repo.prs.map((p) => (
                  <li key={p.key} className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Checkbox label={`#${p.prNumber} (${p.branch})`} checked={prs.has(p.key)} disabled={!canRequest} onChange={(on) => setPrs((s) => toggle(s, p.key, on))} />
                      {p.why.map((w) => <Badge key={w} tone="neutral">{WHY_LABEL[w]}</Badge>)}
                    </div>
                    <span className="pl-5 text-2xs text-fg-muted">{p.reason} The reason is kept as a note on the report.</span>
                  </li>
                ))}
              </ul>
              <div>
                <Btn size="sm" disabled={busy || !canRequest || chosenPrs.length === 0 || chosenPrs.length > 50} onClick={() => onAsk(repo.repo, 'close_prs', chosenPrs)}>
                  Ask to close {chosenPrs.length} pull request{chosenPrs.length === 1 ? '' : 's'}
                </Btn>
              </div>
            </>
          )}
        </section>
      )}

      {!repo.error && repo.deleteBranchOnMerge === false && (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-fg">Delete branches when a pull request merges</h4>
          <p className="text-2xs text-fg-muted">
            GitHub can delete a pull request’s branch as soon as it merges, so branches stop piling up. This turns on “Automatically delete head branches” for {repo.repo}; Mushi never turns it off.
            {!repo.canChangeSetting && ' The stored GitHub token cannot change repository settings: it needs "Administration: Read and write" on this repository.'}
          </p>
          <div>
            <Btn size="sm" variant="ghost" disabled={busy || !canRequest || !repo.canChangeSetting || repo.settingPending} onClick={() => onAsk(repo.repo, 'set_delete_branch_on_merge')}>
              {repo.settingPending ? 'Waiting for a decision' : 'Ask to turn it on'}
            </Btn>
          </div>
        </section>
      )}
      {repo.deleteBranchOnMerge === true && <p className="text-2xs text-fg-muted">GitHub deletes merged branches here on its own (“Automatically delete head branches” is on).</p>}

      {repo.keptCount > 0 && (
        <DisclosurePanel title="Kept, and why" trailing={<span className="text-2xs font-normal text-fg-faint">{repo.keptCount}</span>}>
          <ul className="flex flex-col gap-0.5 px-3 py-2">
            {repo.kept.map((k) => (
              <li key={k.key} className="text-2xs">
                <span className="font-mono text-fg-secondary">{k.key.replace(/^branch:/, '').replace(/^pr:/, '#')}</span> <span className="text-fg-muted">{k.reason}</span>
              </li>
            ))}
          </ul>
        </DisclosurePanel>
      )}
    </Card>
  )
}

function RestoreCard({ items, canRequest, busy, onRestore }: {
  items: CleanupView['restorable']
  canRequest: boolean
  busy: boolean
  onRestore: (itemIds: string[]) => Promise<boolean>
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const repos = [...new Set(items.filter((i) => chosen.has(i.id)).map((i) => i.repo))]
  return (
    <DisclosurePanel title="Restore a deleted branch" trailing={<span className="text-2xs font-normal text-fg-faint">{items.length}</span>}>
      <div className="flex flex-col gap-2 px-3 py-2">
        <p className="text-2xs text-fg-muted">Mushi recreates the branch at the commit it pointed at when Mushi deleted it. It never overwrites a branch that exists again under the same name.</p>
        <ul className="flex flex-col gap-1">
          {items.map((i) => (
            <li key={i.id}>
              <Checkbox
                label={`${i.repo}: ${i.branch} at ${shortSha(i.deleted_sha)} (deleted ${formatRelative(i.created_at)})`}
                checked={chosen.has(i.id)}
                disabled={!canRequest}
                onChange={(on) => setChosen((s) => {
                  const next = new Set(s)
                  if (on) next.add(i.id)
                  else next.delete(i.id)
                  return next
                })}
              />
            </li>
          ))}
        </ul>
        {repos.length > 1 && <p className="text-2xs text-warn">Restore branches of one repository at a time.</p>}
        <div>
          <Btn size="sm" variant="ghost" disabled={busy || !canRequest || chosen.size === 0 || repos.length > 1} onClick={async () => { if (await onRestore([...chosen])) setChosen(new Set()) }}>
            Ask to restore {chosen.size} branch{chosen.size === 1 ? '' : 'es'}
          </Btn>
        </div>
      </div>
    </DisclosurePanel>
  )
}
