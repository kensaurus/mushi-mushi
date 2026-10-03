import { useEffect, useState } from 'react'
import { Card } from '../../components/ui'
import { SelectField, Btn } from '../ui'
import { STATUS_LABELS, SEVERITY_LABELS } from '../../lib/tokens'
import { IconArrowRight, IconExternalLink } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'
import type { DispatchState } from '../../lib/dispatchFix'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import type { ReportDetail } from './types'
import { CHIP_TONE } from '../../lib/chipTone'
import { ConfirmDialog } from '../ConfirmDialog'
import { dispatchConfirmBody, featureRequestDispatchBlock, shortRepoName } from '../../lib/dispatchConfirm'
import type { DispatchTargetRepo } from '../../lib/useDispatchTargetRepo'

// One option per label: 'resolved' is the legacy spelling of 'fixed' (both
// read "Fixed"), so listing both showed "Fixed" twice. A legacy row selects
// the option that shares its label via selectableStatus().
const STATUS_OPTS = ['new', 'classified', 'fixing', 'fixed', 'verified', 'reopened', 'dismissed']

function selectableStatus(status: string): string {
  if (STATUS_OPTS.includes(status)) return status
  const label = STATUS_LABELS[status]
  return STATUS_OPTS.find((s) => STATUS_LABELS[s] === label) ?? status
}
const SEV_OPTS = ['critical', 'high', 'medium', 'low']

/**
 * Why a report is closed. The reporter sees matching copy ("We couldn't
 * reproduce it. Reply if it happens again."); spam closes silently. Values are
 * `reports_closed_reason_check`. Missing info is not a close — use "Ask for
 * more info" in the Reporter view instead.
 */
const CLOSE_REASONS: Array<{ value: string; label: string; needsGroup?: boolean }> = [
  { value: 'not_reproducible', label: "Couldn't reproduce it" },
  { value: 'wont_fix', label: "Won't fix" },
  { value: 'working_as_intended', label: 'Works as intended' },
  { value: 'duplicate', label: 'Same as another report', needsGroup: true },
  { value: 'spam', label: 'Spam (reporter is not told)' },
]

interface RoutingIntegration {
  id: string
  integration_type: string
  is_active: boolean
}

interface ReportTriageBarProps {
  report: ReportDetail
  onTriage: (updates: Record<string, string>) => Promise<void>
  saving: boolean
  savedAt: number | null
  dispatchState: DispatchState
  onDispatch: () => void | Promise<void>
  isDispatchBusy: boolean
  preflight?: PreflightState
  /** The project's linked repos and the one the fix goes to. The Repo
   *  select shows only when there is more than one. */
  repoChoice?: DispatchTargetRepo
}

const PROVIDER_LABEL: Record<string, string> = {
  jira: 'Jira',
  linear: 'Linear',
  github: 'GitHub Issues',
  pagerduty: 'PagerDuty',
}

export function ReportTriageBar({
  report,
  onTriage,
  saving,
  savedAt,
  dispatchState,
  onDispatch,
  isDispatchBusy,
  preflight,
  repoChoice,
}: ReportTriageBarProps) {
  const [showSaved, setShowSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [confirmDispatch, setConfirmDispatch] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const toast = useToast()
  const { data: integrationsData } = usePageData<{ integrations: RoutingIntegration[] }>('/v1/admin/integrations')
  const activeRoutes = (integrationsData?.integrations ?? []).filter((r) => r.is_active)

  useEffect(() => {
    if (!savedAt) return
    setShowSaved(true)
    const t = setTimeout(() => setShowSaved(false), 2_000)
    return () => clearTimeout(t)
  }, [savedAt])

  // The reporter filed a feature request: the server refuses to auto-fix it
  // until someone re-categorizes it, so say so on the button.
  const featureBlock = featureRequestDispatchBlock(report)
  const dispatchDisabled =
    report.status === 'fixed' ||
    report.status === 'dismissed' ||
    isDispatchBusy ||
    featureBlock != null ||
    (preflight != null && !preflight.loading && !preflight.ready)
  const dispatchBlockReason =
    featureBlock ??
    (preflight != null && !preflight.loading && !preflight.ready
      ? `Preflight: ${preflight.failing.map((c) => c.label).join(', ')}`
      : undefined)
  const dispatchLabel =
    dispatchState.status === 'idle' ? 'Dispatch fix' :
    dispatchState.status === 'queueing' ? 'Dispatching…' :
    dispatchState.status === 'queued' ? 'Queued…' :
    dispatchState.status === 'running' ? 'Agent running…' :
    dispatchState.status === 'completed' ? 'PR ready' :
    // Distinct labels: 'completed_no_pr' is a setup gap and 'skipped' a
    // policy stop — both used to render as "Failed — retry", which retried
    // straight into the same wall (2026-08-16 audit P1-4).
    dispatchState.status === 'completed_no_pr' ? 'Fix ready — connect GitHub' :
    dispatchState.status === 'skipped' ? 'Skipped — see reason' :
    'Failed — retry'

  const syncToIntegrations = async () => {
    if (activeRoutes.length === 0) {
      toast.info('No routing destinations active', 'Connect Jira, Linear, GitHub Issues, or PagerDuty in Integrations.')
      return
    }
    setSyncing(true)
    const res = await apiFetch<{ synced: Array<{ externalId: string; url: string; provider: string }> }>(
      `/v1/admin/integrations/sync/${report.id}`,
      { method: 'POST' },
    )
    setSyncing(false)
    if (!res.ok) {
      toast.error('Sync failed', res.error?.message ?? 'No external issues were created.')
      return
    }
    const synced = res.data?.synced ?? []
    if (synced.length === 0) {
      toast.error('Sync attempts failed', 'All routing destinations rejected the request. Check Integrations for status and credentials.')
      return
    }
    if (synced.length < activeRoutes.length) {
      toast.push({
        tone: 'warning',
        message: `Synced to ${synced.length} of ${activeRoutes.length} destinations: ${synced.map((s) => PROVIDER_LABEL[s.provider] ?? s.provider).join(', ')}. Some destinations failed \u2014 check Integrations health.`,
      })
      return
    }
    toast.success(
      `Synced to ${synced.length} ${synced.length === 1 ? 'destination' : 'destinations'}`,
      synced.map((s) => PROVIDER_LABEL[s.provider] ?? s.provider).join(', '),
    )
  }

  return (
    <Card  className="mb-3 flex flex-wrap items-end gap-3 p-3">
      <SelectField
        label="Status"
        value={selectableStatus(report.status)}
        onChange={(e) => {
          const next = e.currentTarget.value
          // Closing asks why first: the reason decides what the reporter is told.
          if (next === 'dismissed' && report.status !== 'dismissed') {
            setCloseReason('')
            setClosing(true)
            return
          }
          void onTriage({ status: next })
        }}
        disabled={saving}
        className="!w-auto"
      >
        {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
      </SelectField>

      {closing && (
        <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Close this report">
          <SelectField
            label="Why close it?"
            value={closeReason}
            onChange={(e) => setCloseReason(e.currentTarget.value)}
            disabled={saving}
            className="!w-auto"
          >
            <option value="">No reason</option>
            {CLOSE_REASONS.map((r) => (
              <option key={r.value} value={r.value} disabled={r.needsGroup && !report.report_group_id}>
                {r.label}
                {r.needsGroup && !report.report_group_id ? ' (group it first)' : ''}
              </option>
            ))}
          </SelectField>
          <Btn
            size="sm"
            onClick={() => {
              setClosing(false)
              void onTriage(closeReason ? { status: 'dismissed', closed_reason: closeReason } : { status: 'dismissed' })
            }}
            disabled={saving}
          >
            Close report
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setClosing(false)} disabled={saving}>
            Cancel
          </Btn>
        </div>
      )}

      <SelectField
        label="Severity"
        value={report.severity ?? ''}
        onChange={(e) => onTriage({ severity: e.currentTarget.value })}
        disabled={saving}
        className="!w-auto"
      >
        <option value="">Unset</option>
        {SEV_OPTS.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s] ?? s}</option>)}
      </SelectField>

      {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
      <div className="flex items-center gap-1.5 text-2xs h-[26px]" aria-live="polite">
        {saving && <span className="text-brand">Saving…</span>}
        {!saving && showSaved && <span className="text-ok">✓ Saved</span>}
      </div>

      <div className="ml-auto flex flex-wrap items-end gap-2">
        <Btn
          variant="ghost"
          size="sm"
          onClick={syncToIntegrations}
          disabled={syncing}
          loading={syncing}
          title={activeRoutes.length === 0 ? 'No routing destinations active' : `Push to: ${activeRoutes.map((r) => PROVIDER_LABEL[r.integration_type] ?? r.integration_type).join(', ')}`}
        >
          {syncing ? 'Syncing\u2026' : `Sync to ${activeRoutes.length || 0} ${activeRoutes.length === 1 ? 'destination' : 'destinations'}`}
        </Btn>
        {repoChoice && repoChoice.repos.length > 1 && (
          <SelectField
            label="Repo"
            value={repoChoice.targetRepoId}
            onChange={(e) => repoChoice.setTargetRepoId(e.currentTarget.value)}
            disabled={isDispatchBusy}
            className="!w-auto"
            title="The linked repo the fix PR opens against"
          >
            {!repoChoice.repos.some((r) => r.is_primary) && <option value="">Project default</option>}
            {repoChoice.repos.map((r) => (
              <option key={r.id} value={r.id}>
                {shortRepoName(r.repo_url)}
                {r.is_primary ? ' (primary)' : ''}
              </option>
            ))}
          </SelectField>
        )}
        <div className="flex flex-col items-end gap-1">
          <Btn
            variant="primary"
            onClick={() => setConfirmDispatch(true)}
            disabled={dispatchDisabled}
            loading={isDispatchBusy && dispatchState.status !== 'completed' && dispatchState.status !== 'failed'}
            leadingIcon={<IconArrowRight />}
            title={dispatchBlockReason}
          >
            {dispatchLabel}
          </Btn>
          {dispatchState.status === 'completed' && dispatchState.prUrl && (
            <a
              href={dispatchState.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-2xs text-accent hover:text-accent-hover inline-flex items-center gap-1"
            >
              View PR <IconExternalLink />
            </a>
          )}
          {dispatchState.status === 'failed' && dispatchState.error && (
            <span className={`rounded-sm px-2 py-1 text-2xs max-w-xs text-right ${CHIP_TONE.dangerSubtle}`}>
              {dispatchState.error}
            </span>
          )}
          {(dispatchState.status === 'skipped' || dispatchState.status === 'completed_no_pr') &&
            dispatchState.error && (
              <span className={`rounded-sm px-2 py-1 text-2xs max-w-xs text-right ${CHIP_TONE.warnSubtle}`}>
                {dispatchState.error}
              </span>
            )}
        </div>
      </div>
      {confirmDispatch && (
        <ConfirmDialog
          title="Dispatch a fix for this report?"
          body={dispatchConfirmBody(
            repoChoice?.target
              ? { repoUrl: repoChoice.target.repo_url, baseBranch: repoChoice.target.default_branch }
              : { repoUrl: preflight?.repoUrl, baseBranch: preflight?.baseBranch },
          )}
          confirmLabel="Dispatch fix"
          onCancel={() => setConfirmDispatch(false)}
          onConfirm={() => {
            setConfirmDispatch(false)
            void onDispatch()
          }}
        />
      )}
    </Card>
  )
}
