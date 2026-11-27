/**
 * FILE: apps/admin/src/components/releases/SecurityProofPanel.tsx
 * PURPOSE: A release's Security proof (Plan 025 P4, ADR 0074): did the scans
 *          that ran in the app's own CI come back green for the commit this
 *          release ships? Four lanes as a pipeline (Dependencies → Secrets →
 *          AI review → Live site), each with its state, findings by severity,
 *          last run and a drill-down to the findings and their reports.
 *
 *          A lane that never ran reads "No result", never green. A release
 *          without a commit reads "Not pinned" and offers to pin it. With no
 *          scans at all the panel offers the workflow (copy it, or a PR).
 *
 * Data: GET  /v1/admin/projects/:pid/security-proof?release=<rid>
 *       PUT  /v1/admin/projects/:pid/releases/:rid/commit        { commit_sha }
 *       GET  /v1/admin/projects/:pid/security-workflow           { path, yaml }
 *       POST /v1/admin/projects/:pid/security-workflow/pr        { prUrl }
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { LINK_ACCENT } from '../../lib/chipTone'
import {
  connectorClass,
  dedupeText,
  LANE_STATE_LABEL,
  LANE_TOOL,
  laneFindings,
  locationText,
  PROOF_BADGE,
  proofNeverRan,
  proveCommand,
  severitySummary,
  severityTone,
  SHA_RE,
  TONE_BADGE,
  TONE_DOT,
  type LaneProof,
  type SecurityLane,
  type SecurityProofData,
} from '../../lib/releaseShipView'
import { Badge, Card, Btn, Callout, CodeValue, CopyButton, Input, LogBlock, RelativeTime, Skeleton } from '../ui'
import { PageLoadError } from '../PageLoadError'

interface Props {
  projectId: string
  releaseId: string
  /** Viewers read the proof but cannot pin a commit or open a PR. */
  canEdit: boolean
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; proof: SecurityProofData }
  | { kind: 'pending' }
  | { kind: 'error'; message: string; code: string | null }

export function SecurityProofPanel({ projectId, releaseId, canEdit }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [open, setOpen] = useState<SecurityLane | null>(null)
  const path = `/v1/admin/projects/${projectId}/security-proof?release=${encodeURIComponent(releaseId)}`

  const reload = useCallback(async () => {
    const res = await apiFetch<SecurityProofData>(path, { cache: 'no-store' })
    if (res.ok && res.data && Array.isArray(res.data.lanes) && res.data.state in PROOF_BADGE) setLoad({ kind: 'ready', proof: { ...res.data, findings: res.data.findings ?? [] } })
    else if (res.error?.code === 'MIGRATION_PENDING') setLoad({ kind: 'pending' })
    else setLoad({ kind: 'error', message: res.error?.message ?? 'The Security proof could not be read.', code: res.error?.code ?? null })
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <section aria-labelledby={`proof-${releaseId}`} data-testid="security-proof-panel">
      <Card className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`proof-${releaseId}`} className="text-xs font-semibold text-fg-secondary">Security proof</h3>
        {load.kind === 'ready' && (
          <Badge tone={PROOF_BADGE[load.proof.state].tone} aria-label={`Security proof: ${PROOF_BADGE[load.proof.state].label}`}>
            {PROOF_BADGE[load.proof.state].label}
          </Badge>
        )}
        {load.kind === 'ready' && load.proof.commitSha && <CodeValue value={load.proof.commitSha.slice(0, 12)} inline copyable={false} />}
      </div>

      {load.kind === 'loading' && (
        <div className="space-y-2" aria-busy="true" aria-label="Reading the Security proof">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {load.kind === 'pending' && (
        <Callout tone="neutral">
          <span role="status">The Security proof is not switched on for this server yet (its database update is not applied). Releases still ship as before.</span>
        </Callout>
      )}

      {load.kind === 'error' && <PageLoadError error={load.message} code={load.code} resource="Security proof" endpoint={path} onRetry={() => void reload()} />}

      {load.kind === 'ready' && (
        <>
          <p className="text-xs text-fg-muted">{load.proof.headline}</p>
          <LanePipeline lanes={load.proof.lanes} open={open} onToggle={(l) => setOpen((cur) => (cur === l ? null : l))} />
          {open && (
            <LaneDetail
              lane={load.proof.lanes.find((l) => l.lane === open) ?? null}
              findings={laneFindings(load.proof.findings, open)}
            />
          )}
          {load.proof.state === 'not_pinned' && <PinCommit projectId={projectId} releaseId={releaseId} canEdit={canEdit} onPinned={() => void reload()} />}
          {load.proof.commitSha && (
            <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
              <span>Prove this commit from your terminal:</span>
              <CodeValue value={proveCommand(load.proof.commitSha)} inline />
            </div>
          )}
          {proofNeverRan(load.proof) && <WorkflowSetup projectId={projectId} canEdit={canEdit} workflowPath={load.proof.workflowPath} />}
        </>
      )}
      </Card>
    </section>
  )
}

function LanePipeline({ lanes, open, onToggle }: { lanes: LaneProof[]; open: SecurityLane | null; onToggle: (l: SecurityLane) => void }) {
  return (
    <ol role="list" aria-label="Scan lanes" className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:gap-0">
      {lanes.map((l, i) => {
        const findingsText = severitySummary(l.counts)
        return (
          <li key={l.lane} className="relative flex min-w-0 sm:pr-3" data-testid={`lane-${l.lane}`}>
            {i < lanes.length - 1 && (
              <span aria-hidden className={`absolute right-0 top-4 hidden h-px w-3 sm:block ${connectorClass(l.tone, lanes[i + 1].tone)}`} />
            )}
            <div className={`flex w-full min-w-0 flex-col gap-1 rounded-md border p-2 ${open === l.lane ? 'border-accent/40 bg-surface' : 'border-edge-subtle bg-surface'}`}>
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border ${TONE_DOT[l.tone]} ${l.state === 'unknown' && l.required ? 'motion-safe:animate-pulse' : ''}`}
                />
                <span className="truncate text-xs font-medium text-fg">{l.label}</span>
                {!l.required && <span className="text-3xs text-fg-faint">optional</span>}
              </div>
              <Badge tone={TONE_BADGE[l.tone]}>{LANE_STATE_LABEL[l.state]}</Badge>
              <span className="text-2xs text-fg-muted">{findingsText || (l.state === 'passed' ? 'No findings' : '—')}</span>
              <span className="text-3xs text-fg-faint">
                {l.run ? <>Last run <RelativeTime value={l.run.finished_at} /></> : 'Never ran for this release'}
              </span>
              <Btn
                size="sm"
                variant="ghost"
                aria-expanded={open === l.lane}
                aria-controls={`lane-detail-${l.lane}`}
                onClick={() => onToggle(l.lane)}
              >
                {open === l.lane ? 'Hide details' : 'Details'}
              </Btn>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function LaneDetail({ lane, findings }: { lane: LaneProof | null; findings: ReturnType<typeof laneFindings> }) {
  if (!lane) return null
  return (
    <div id={`lane-detail-${lane.lane}`} className="space-y-2 rounded-md border border-edge-subtle bg-surface p-3" data-testid="lane-detail">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-fg">{lane.label}</span>
        <span className="text-fg-faint">{LANE_TOOL[lane.lane]}</span>
        {lane.run?.run_url && (
          <a href={lane.run.run_url} target="_blank" rel="noreferrer" className={`text-2xs ${LINK_ACCENT}`}>
            Open the CI run
          </a>
        )}
      </div>
      <p className="text-2xs text-fg-muted">{lane.detail}</p>
      {lane.run?.target_url && <p className="text-2xs text-fg-muted">Scanned {lane.run.target_url}</p>}
      {findings.length === 0 ? (
        <p className="text-2xs text-fg-faint">No findings stored for this lane.</p>
      ) : (
        <ul role="list" className="flex flex-col divide-y divide-edge-subtle">
          {findings.map((f) => {
            const where = locationText(f.location)
            const why = dedupeText(f.deduped_by)
            return (
              <li key={f.id} className="flex flex-col gap-0.5 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={severityTone(String(f.severity))}>{String(f.severity)}</Badge>
                  <span className="min-w-0 text-xs text-fg">{f.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-3xs text-fg-faint">
                  <span className="font-mono">{f.rule_id}</span>
                  {where && <span className="font-mono">{where}</span>}
                  {why && <span>{why}</span>}
                  {f.report_id && (
                    <Link to={`/reports/${f.report_id}`} className={LINK_ACCENT}>
                      Open report
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function PinCommit({ projectId, releaseId, canEdit, onPinned }: { projectId: string; releaseId: string; canEdit: boolean; onPinned: () => void }) {
  const [sha, setSha] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const id = useId()
  const valid = SHA_RE.test(sha.trim())
  const pin = async () => {
    if (!valid) {
      setProblem('A commit is 7 to 40 hex characters, like 4d193533.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const res = await apiFetchMutate(`/v1/admin/projects/${projectId}/releases/${releaseId}/commit`, { method: 'PUT', body: JSON.stringify({ commit_sha: sha.trim().toLowerCase() }) })
      if (res.ok) onPinned()
      else setProblem(actionErrorText(res.error, 'The commit could not be saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-describedby={`${id}-hint`}
      onSubmit={(e) => {
        e.preventDefault()
        void pin()
      }}
    >
      <div className="min-w-48 flex-1">
        <Input label="Release commit" value={sha} onChange={(e) => setSha(e.target.value)} placeholder="4d193533" spellCheck={false} autoComplete="off" error={problem ?? undefined} disabled={!canEdit} />
      </div>
      <Btn type="submit" size="sm" loading={busy} disabled={!canEdit || busy} title={canEdit ? 'Pin this release to the commit it ships' : 'Viewers cannot change releases.'}>
        Pin commit
      </Btn>
      <p id={`${id}-hint`} className="w-full text-3xs text-fg-faint">Auto-release pins it from the deploy. A release you drafted by hand needs it once.</p>
    </form>
  )
}

function WorkflowSetup({ projectId, canEdit, workflowPath }: { projectId: string; canEdit: boolean; workflowPath: string }) {
  const [yaml, setYaml] = useState<string | null>(null)
  const [busy, setBusy] = useState<'copy' | 'pr' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string; href?: string } | null>(null)

  const showWorkflow = async () => {
    setBusy('copy')
    setNotice(null)
    try {
      const res = await apiFetch<{ path: string; yaml: string }>(`/v1/admin/projects/${projectId}/security-workflow`, { cache: 'no-store' })
      if (res.ok && res.data) setYaml(res.data.yaml)
      else setNotice({ tone: 'danger', text: actionErrorText(res.error, 'The workflow could not be read.') })
    } finally {
      setBusy(null)
    }
  }
  const openPr = async () => {
    setBusy('pr')
    setNotice(null)
    try {
      const res = await apiFetchMutate<{ prUrl: string }>(`/v1/admin/projects/${projectId}/security-workflow/pr`, { method: 'POST', body: '{}' })
      if (res.ok && res.data) setNotice({ tone: 'ok', text: 'Pull request opened. Merge it, add the MUSHI_API_KEY secret, and the next PR is scanned.', href: res.data.prUrl })
      else setNotice({ tone: 'danger', text: actionErrorText(res.error, 'GitHub did not open the pull request.') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-edge-subtle p-3" data-testid="security-setup">
      <p className="text-xs font-medium text-fg">No scans have reached Mushi yet</p>
      <p className="text-2xs text-fg-muted">
        The scanners run in your own CI, on your runner and with your keys: OSV-Scanner and Gitleaks on every PR, an AI review on your own PRs if you opt in, and a weekly passive scan of your staging site. Mushi only reads their results. Add <code className="font-mono">{workflowPath}</code>.
      </p>
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" variant="ghost" loading={busy === 'copy'} disabled={busy !== null} onClick={() => void showWorkflow()}>Show the workflow</Btn>
        <Btn size="sm" loading={busy === 'pr'} disabled={!canEdit || busy !== null} title={canEdit ? 'Mushi opens a PR that adds the workflow' : 'Viewers cannot open pull requests.'} onClick={() => void openPr()}>Open a pull request</Btn>
      </div>
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">
            {notice.text}{' '}
            {notice.href && (
              <a href={notice.href} target="_blank" rel="noreferrer" className={LINK_ACCENT}>Open the PR</a>
            )}
          </span>
        </Callout>
      )}
      {yaml && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-2xs text-fg-muted">
            <span>{workflowPath}</span>
            <CopyButton value={yaml} label="Copy the workflow" />
          </div>
          <LogBlock value={yaml} maxHeightClass="max-h-56" copyable={false} />
        </div>
      )}
    </div>
  )
}
