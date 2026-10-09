import { useEffect, useState } from 'react'
import { Card } from '../../components/ui'
import { SelectField, Btn } from '../ui'
import { STATUS_LABELS, SEVERITY_LABELS, CATEGORY_LABELS } from '../../lib/tokens'
import { IconArrowRight, IconExternalLink } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'
import { CHIP_TONE } from '../../lib/chipTone'
import { featureRequestDispatchBlock, shortRepoName } from '../../lib/dispatchConfirm'
import type { DispatchTargetRepo } from '../../lib/useDispatchTargetRepo'
import { CLOSE_REASONS } from '../../lib/closeReasons'

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
/** The classifier's categories; setting one here is a person's triage decision. */
const CATEGORY_OPTS = ['bug', 'slow', 'visual', 'confusing', 'other']

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
  /** Opens the page's dispatch confirm (useConfirmedDispatch().request). */
  onRequestDispatch: () => void
  /** The page's dispatch gate (dispatchBlock()); disables the button. */
  dispatchBlock: { blocked: boolean; reason: string | null }
  isDispatchBusy: boolean
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
  onRequestDispatch,
  dispatchBlock,
  isDispatchBusy,
  repoChoice,
}: ReportTriageBarProps) {
  const [showSaved, setShowSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const toast = useToast()
  const { data: integrationsData } = usePageData<{ integrations: RoutingIntegration[]; syncDestinations?: string[] }>(
    '/v1/admin/integrations',
  )
  // Where a sync really goes: the server's list, which includes Linear
  // connected from the console (no project_integrations row). Counting only
  // the rows read "Sync to 0 destinations" and never called the server.
  const destinations =
    integrationsData?.syncDestinations ??
    (integrationsData?.integrations ?? []).filter((r) => r.is_active).map((r) => r.integration_type)

  useEffect(() => {
    if (!savedAt) return
    setShowSaved(true)
    const t = setTimeout(() => setShowSaved(false), 2_000)
    return () => clearTimeout(t)
  }, [savedAt])

  // One gate for every dispatch control on the page (dispatchBlock()).
  const dispatchDisabled = dispatchBlock.blocked
  const dispatchBlockReason = dispatchBlock.reason ?? undefined
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
    if (destinations.length === 0) {
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
      toast.error('Sync failed', 'No external issues were created. Check Integrations for status and credentials.')
      return
    }
    const synced = res.data?.synced ?? []
    if (synced.length === 0) {
      toast.error('Sync attempts failed', 'All routing destinations rejected the request. Check Integrations for status and credentials.')
      return
    }
    if (synced.length < destinations.length) {
      toast.push({
        tone: 'warning',
        message: `Synced to ${synced.length} of ${destinations.length} destinations: ${synced.map((s) => PROVIDER_LABEL[s.provider] ?? s.provider).join(', ')}. Some destinations failed \u2014 check Integrations health.`,
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

      <SelectField
        label="Category"
        value={report.category ?? 'other'}
        onChange={(e) => onTriage({ category: e.currentTarget.value, category_confirmed_at: new Date().toISOString() })}
        disabled={saving}
        className="!w-auto"
      >
        {CATEGORY_OPTS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
      </SelectField>
      {/* A select cannot "confirm" the value it already shows, so a feature
          request the classifier already called a defect gets a button. */}
      {featureRequestDispatchBlock(report) && report.category && report.category !== 'other' && (
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => void onTriage({ category: report.category, category_confirmed_at: new Date().toISOString() })}
          disabled={saving}
          title="The reporter filed this as a feature request. Confirming the category sends it to auto-fix like any bug."
        >
          It&apos;s a bug: confirm {CATEGORY_LABELS[report.category] ?? report.category}
        </Btn>
      )}

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
          title={destinations.length === 0 ? 'No routing destinations active' : `Push to: ${destinations.map((t) => PROVIDER_LABEL[t] ?? t).join(', ')}`}
        >
          {syncing ? 'Syncing\u2026' : `Sync to ${destinations.length} ${destinations.length === 1 ? 'destination' : 'destinations'}`}
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
            onClick={onRequestDispatch}
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
    </Card>
  )
}
