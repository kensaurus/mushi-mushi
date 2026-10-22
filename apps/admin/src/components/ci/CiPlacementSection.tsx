/**
 * FILE: apps/admin/src/components/ci/CiPlacementSection.tsx
 * PURPOSE: /ci "Where CI runs" (Plan 022 Phase 7b, ADR 0037). Per repo: the
 *          runner variable its workflows read and where those jobs run now,
 *          a choice of GitHub-hosted or one of your runner labels (greyed out
 *          with the reason when your CI agreement forbids it), a dry-run
 *          preview, and a request. Owners and admins approve exactly the
 *          payload they read and run it within the hour; every change is
 *          watched over the next jobs and can be reverted the same way.
 *
 *          A repo an external controller manages (another tool's dispatcher)
 *          is shown read-only. Mushi never changes runner labels or
 *          registrations: only LINUX_RUNNER / RUNNER_<WORKFLOW>.
 *
 *          Data: GET /v1/admin/ci/placement?project_id=; POST …/preview,
 *          …/requests, …/requests/:id/{approve,reject,execute,revert}.
 */

import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CiPlacement, PlacementPreview, PlacementRepo, PlacementRequestRow } from '../../lib/ciPlacementTypes'
import {
  currentPlacement,
  hostedDisabledReason,
  labelChoices,
  minutesLeft,
  REQUEST_STATUS,
  requestSummary,
  targetLabel,
  WATCH_STATUS,
} from '../../lib/ciPlacementView'
import { formatDelta } from '../../lib/ciCompareView'
import { formatSeconds } from '../../lib/ciView'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useNow } from '../../lib/useNow'
import { Badge, Btn, Callout, ErrorAlert, Input, Loading, RelativeTime, ResultChip, SelectField } from '../ui'
import { IconAlertTriangle, IconLock, IconShield } from '../icons'
import { RepoVisibilityBadge } from './RepoVisibilityBadge'

const CI_POLICY_SETTINGS_HREF = '/settings?tab=ci-policy'

type Choice = { kind: 'hosted' } | { kind: 'label'; label: string }

function PreviewPanel({ preview }: { preview: PlacementPreview }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-edge-subtle bg-surface-overlay/40 p-2.5 text-xs" data-testid="ci-placement-preview">
      <p className="font-medium text-fg">
        {targetLabel(preview.now.target)} → {targetLabel(preview.next.target)}
      </p>
      {preview.blocked && (
        <p className="flex items-start gap-1 text-danger" role="alert">
          <IconAlertTriangle size={12} className="mt-px shrink-0" />
          {preview.blocked.message}
        </p>
      )}
      <div>
        <p className="font-medium text-fg-secondary">Moves ({preview.jobs.moves.length})</p>
        {preview.jobs.moves.length === 0 ? (
          <p className="text-fg-muted">Nothing.</p>
        ) : (
          <ul className="flex list-disc flex-col pl-5 text-fg-secondary">
            {preview.jobs.moves.map((m) => (
              <li key={`${m.workflowPath}|${m.job}`}>
                {m.workflow} · {m.job}
                {(m.mainStays || m.dependabotStays) && <span className="text-fg-muted"> (main{m.dependabotStays ? ' and Dependabot' : ''} runs stay on GitHub)</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {preview.jobs.stays.length > 0 && (
        <div>
          <p className="font-medium text-fg-secondary">Stays ({preview.jobs.stays.length})</p>
          <ul className="flex list-disc flex-col pl-5 text-fg-muted">
            {preview.jobs.stays.map((s) => (
              <li key={`${s.workflowPath}|${s.job}`}>
                {s.workflow} · {s.job} — {s.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.target && preview.next.target.kind === 'self_hosted' && (
        <p className="text-fg-secondary">
          {preview.target.online} of {preview.target.runners} runner{preview.target.runners === 1 ? '' : 's'} with “{preview.target.label}” online
          {preview.target.waitP95s != null ? ` · wait p95 ${formatSeconds(preview.target.waitP95s)} (measured)` : ''}
        </p>
      )}
      {preview.cost && (
        <p className="text-fg-secondary">
          Cost: <span className="font-semibold tabular-nums">{formatDelta(preview.cost.monthCostDelta, preview.cost.currency)}</span> a month{' '}
          <span className="text-warn-foreground">(estimated)</span>. <span className="text-fg-muted">{preview.cost.note}</span>
        </p>
      )}
      {preview.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {preview.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1 text-warn-foreground">
              <IconAlertTriangle size={12} className="mt-px shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RepoCard({ projectId, repo, data, onChanged }: { projectId: string; repo: PlacementRepo; data: CiPlacement; onChanged: () => void }) {
  const allowed = repo.variables.filter((v) => v.allowed)
  const [variable, setVariable] = useState(allowed[0]?.name ?? '')
  const v = allowed.find((x) => x.name === variable) ?? allowed[0]
  const hostedReason = hostedDisabledReason(data.policy, repo)
  const choices = labelChoices(data.policy, repo)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [other, setOther] = useState('')
  const [preview, setPreview] = useState<PlacementPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'request' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const groupId = useId()

  const value = choice?.kind === 'hosted' ? null : choice?.kind === 'label' ? (choice.label === '__other__' ? other.trim() : choice.label) : undefined
  const body = () => ({ projectId, repo: repo.repo, variable: v?.name ?? '', value: value ?? null })

  async function runPreview() {
    if (value === undefined || (value !== null && !value)) return
    setBusy('preview')
    setError(null)
    setNotice(null)
    const res = await apiFetch<PlacementPreview>('/v1/admin/ci/placement/preview', { method: 'POST', body: JSON.stringify(body()) })
    setBusy(null)
    if (!res.ok || !res.data) {
      setPreview(null)
      setError(res.error?.message ?? 'Mushi could not build the preview.')
      return
    }
    setPreview(res.data)
  }

  async function request() {
    setBusy('request')
    setError(null)
    const res = await apiFetch<{ id: string }>('/v1/admin/ci/placement/requests', { method: 'POST', body: JSON.stringify(body()) })
    setBusy(null)
    if (!res.ok) {
      setError(res.error?.message ?? 'Mushi could not save the request.')
      return
    }
    setPreview(null)
    setChoice(null)
    setNotice(data.canDecide ? 'Requested. Approve it below, then run it.' : 'Requested. A team owner or admin approves and runs it.')
    onChanged()
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-edge-subtle p-3" data-testid={`ci-placement-repo-${repo.repo}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-fg">{repo.repo}</span>
        <RepoVisibilityBadge visibility={repo.visibility} />
      </div>
      {repo.controller ? (
        <Callout tone="neutral" label="Read-only" icon={<IconLock size={14} />}>
          Managed by {repo.controller.name}
          {repo.controller.owner ? ` (${repo.controller.owner})` : ''}. Mushi shows where its CI runs and does not change it.
        </Callout>
      ) : !repo.workflowsRead ? (
        <p className="text-xs text-fg-muted">Mushi has not read this repo’s workflow files yet (they come with the daily GitHub snapshot).</p>
      ) : allowed.length === 0 ? (
        <p className="text-xs text-fg-muted">No job reads LINUX_RUNNER or a RUNNER_&lt;WORKFLOW&gt; variable: every job names its runner in the workflow. Moving them is a workflow change.</p>
      ) : (
        <>
          {allowed.length > 1 && (
            <div className="max-w-xs">
              <SelectField
                label="Variable"
                value={v?.name}
                onChange={(e) => {
                  setVariable(e.target.value)
                  setPreview(null)
                }}
              >
                {allowed.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          {v && (
            <p className="text-xs text-fg-secondary">
              <span className="font-mono">vars.{v.name}</span> picks the runner for {v.jobs} job{v.jobs === 1 ? '' : 's'}. Now: <span className="font-medium text-fg">{currentPlacement(v).text}</span>
            </p>
          )}
          {data.canRequest && v && (
            <fieldset className="flex flex-col gap-1.5" aria-describedby={`${groupId}-hint`}>
              <legend className="text-xs font-medium text-fg">Run these jobs on</legend>
              <label className={`flex items-start gap-2 text-xs ${hostedReason ? 'text-fg-faint' : 'text-fg-secondary'}`}>
                <input
                  type="radio"
                  name={`${groupId}-choice`}
                  className="mt-0.5"
                  disabled={!!hostedReason}
                  checked={choice?.kind === 'hosted'}
                  onChange={() => {
                    setChoice({ kind: 'hosted' })
                    setPreview(null)
                  }}
                />
                <span>
                  GitHub-hosted (remove the variable{v.fallbacks[0] ? `; jobs use ${v.fallbacks[0]}` : ''})
                  {hostedReason && <span className="block text-2xs">{hostedReason}</span>}
                </span>
              </label>
              {choices.map((l) => (
                <label key={l.label} className="flex items-center gap-2 text-xs text-fg-secondary">
                  <input
                    type="radio"
                    name={`${groupId}-choice`}
                    checked={choice?.kind === 'label' && choice.label === l.label}
                    onChange={() => {
                      setChoice({ kind: 'label', label: l.label })
                      setPreview(null)
                    }}
                  />
                  <span>
                    Self-hosted: <span className="font-mono">{l.label}</span>{' '}
                    <span className={l.online > 0 ? 'text-ok' : 'text-warn-foreground'}>
                      ({l.online} of {l.runners} online)
                    </span>
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <input
                  type="radio"
                  name={`${groupId}-choice`}
                  checked={choice?.kind === 'label' && choice.label === '__other__'}
                  onChange={() => {
                    setChoice({ kind: 'label', label: '__other__' })
                    setPreview(null)
                  }}
                />
                <span>Another label</span>
              </label>
              {choice?.kind === 'label' && choice.label === '__other__' && (
                <div className="max-w-xs pl-5">
                  <Input label="Runner label" value={other} onChange={(e) => setOther(e.target.value)} placeholder="kensaurus-local" />
                </div>
              )}
              <p id={`${groupId}-hint`} className="text-2xs text-fg-muted">
                Preview changes nothing. A request changes nothing until an owner or admin approves it and runs it within the hour.
              </p>
              <div className="flex flex-wrap gap-2">
                <Btn size="sm" variant="ghost" onClick={() => void runPreview()} disabled={busy !== null || value === undefined || (value !== null && !value)}>
                  {busy === 'preview' ? 'Previewing…' : 'Preview'}
                </Btn>
                {preview && !preview.blocked && preview.payload && (
                  <Btn size="sm" onClick={() => void request()} disabled={busy !== null}>
                    {busy === 'request' ? 'Asking…' : 'Ask for this change'}
                  </Btn>
                )}
              </div>
            </fieldset>
          )}
          {preview && <PreviewPanel preview={preview} />}
        </>
      )}
      {error && <ErrorAlert title="Not done" message={error} />}
      {notice && <ResultChip tone="success">{notice}</ResultChip>}
    </li>
  )
}

function RequestRow({ r, data, onChanged }: { r: PlacementRequestRow; data: CiPlacement; onChanged: () => void }) {
  const now = useNow(30_000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = REQUEST_STATUS[r.status]
  const left = minutesLeft(r, now)

  async function act(verb: 'approve' | 'reject' | 'execute' | 'revert') {
    setBusy(true)
    setError(null)
    const id = encodeURIComponent(r.id)
    const path =
      verb === 'approve'
        ? `/v1/admin/ci/placement/requests/${id}/approve`
        : verb === 'reject'
          ? `/v1/admin/ci/placement/requests/${id}/reject`
          : verb === 'execute'
            ? `/v1/admin/ci/placement/requests/${id}/execute`
            : `/v1/admin/ci/placement/requests/${id}/revert`
    const res = await apiFetch<unknown>(path, {
      method: 'POST',
      body: verb === 'approve' ? JSON.stringify({ payloadSha256: r.payload_sha256 }) : undefined,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'Mushi could not do that.')
      return
    }
    onChanged()
  }

  return (
    <li className="flex flex-col gap-1 py-2 text-xs" data-testid={`ci-placement-request-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone === 'ok' ? 'okSubtle' : status.tone === 'danger' ? 'dangerSubtle' : status.tone === 'warn' ? 'warnSubtle' : status.tone === 'info' ? 'infoSubtle' : 'neutral'}>{status.label}</Badge>
        <span className="font-mono text-fg">{r.payload.repo}</span>
        <span className="font-mono text-fg-secondary">{requestSummary(r)}</span>
        <span className="text-2xs text-fg-muted">
          <RelativeTime value={r.requested_at} />
        </span>
      </div>
      {r.reason && <p className="text-2xs text-fg-muted">“{r.reason}”</p>}
      {r.error && <p className="text-2xs text-danger">{r.error}</p>}
      {r.status === 'pending_approval' && data.canDecide && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-fg-muted">
            You approve exactly this payload (hash <span className="font-mono">{r.payload_sha256.slice(0, 12)}</span>): expected now{' '}
            {r.payload.expected.exists ? `“${r.payload.expected.value}”` : 'not set'}.
          </span>
          <Btn size="sm" onClick={() => void act('approve')} disabled={busy}>
            Approve
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => void act('reject')} disabled={busy}>
            Reject
          </Btn>
        </div>
      )}
      {r.status === 'approved' && data.canDecide && (
        <div className="flex flex-wrap items-center gap-2">
          <Btn size="sm" onClick={() => void act('execute')} disabled={busy}>
            Run it now
          </Btn>
          {left != null && <span className="text-2xs text-warn-foreground">The approval expires in {left} min.</span>}
        </div>
      )}
      {r.status === 'executed' && data.canRequest && !r.payload.revertOf && (
        <div>
          <Btn size="sm" variant="ghost" onClick={() => void act('revert')} disabled={busy}>
            Ask to revert
          </Btn>
        </div>
      )}
      {error && (
        <p className="text-2xs text-danger" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

export function CiPlacementSection({ projectId, scope }: { projectId: string | null; scope: 'project' | 'all' }) {
  const path = scope === 'project' && projectId ? `/v1/admin/ci/placement?project_id=${encodeURIComponent(projectId)}` : null
  const page = usePageData<CiPlacement>(path)
  if (!path || !projectId) return <p className="text-xs text-fg-muted">Pick one app to see and change where its CI runs.</p>
  const data = page.data
  if (!data) {
    if (page.error) return <ErrorAlert title="Where CI runs" message={page.error} onRetry={page.reload} />
    return page.loading ? <Loading text="Reading where your CI runs…" /> : null
  }
  const open = data.requests.filter((r) => r.status === 'pending_approval' || r.status === 'approved')
  const recent = data.requests.filter((r) => r.status !== 'pending_approval' && r.status !== 'approved').slice(0, 5)
  const watches = data.watches.filter((w) => w.status === 'watching' || w.status === 'alert')
  return (
    <div className="flex flex-col gap-3" data-testid="ci-placement-section">
      {data.policy ? (
        <Callout tone="info" label="Your CI agreement" icon={<IconShield size={14} />}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {data.policy.noPaidHostedOnPrivate ? 'No paid GitHub-hosted minutes on private repos' : 'GitHub-hosted runners allowed'}
              {data.policy.hostedAllowedRepos.length > 0 ? ` (except ${data.policy.hostedAllowedRepos.join(', ')})` : ''}
              {data.policy.standbyRunners.length > 0 ? `; standby runners are never a target (${data.policy.standbyRunners.join(', ')})` : ''}.
              {data.policy.sourceNote ? ` Source: ${data.policy.sourceNote}.` : ''}
            </span>
            <Link to={CI_POLICY_SETTINGS_HREF} className="font-medium text-brand hover:underline">
              Edit
            </Link>
          </span>
        </Callout>
      ) : (
        <Callout tone="neutral" label="No CI agreement recorded" icon={<IconShield size={14} />}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Mushi checks changes against your rules once you record them: paid minutes, other tools that manage some repos, standby runners.</span>
            <Link to={CI_POLICY_SETTINGS_HREF} className="font-medium text-brand hover:underline">
              Import from your CI agreement
            </Link>
          </span>
        </Callout>
      )}
      {!data.tokenStored && (
        <Callout tone="warn" label="GitHub access">
          No GitHub token is stored for this app, so Mushi cannot read or change runner variables. Store a fine-grained token with “Variables: Read and write” on these repositories.
        </Callout>
      )}
      <ul className="grid gap-3 xl:grid-cols-2">
        {data.repos.map((r) => (
          <RepoCard key={r.repo} projectId={projectId} repo={r} data={data} onChanged={page.reload} />
        ))}
      </ul>
      {data.repos.length === 0 && <p className="text-xs text-fg-muted">No repository is connected to this app.</p>}
      {open.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-fg">Waiting for a decision</h3>
          <ul className="flex flex-col divide-y divide-edge-subtle" data-testid="ci-placement-open">
            {open.map((r) => (
              <RequestRow key={r.id} r={r} data={data} onChanged={page.reload} />
            ))}
          </ul>
        </div>
      )}
      {watches.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs" data-testid="ci-placement-watches">
          {watches.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={w.status === 'alert' ? 'dangerSubtle' : 'infoSubtle'}>{WATCH_STATUS[w.status].label}</Badge>
              <span className="font-mono text-fg">{w.repo}</span>
              <span className="text-fg-secondary">
                {w.variable} {w.new_value === null ? 'removed' : `→ ${w.new_value}`} · {w.jobs_seen}/10 jobs
                {w.unexpected ? ` · ${w.unexpected} on another runner` : ''}
                {w.slow ? ` · ${w.slow} waited over 30 min` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <details className="rounded-md border border-edge-subtle px-2.5 py-1.5">
          <summary className="cursor-pointer select-none text-xs font-medium text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">Recent changes</summary>
          <ul className="flex flex-col divide-y divide-edge-subtle">
            {recent.map((r) => (
              <RequestRow key={r.id} r={r} data={data} onChanged={page.reload} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
