import { useEffect, useState } from 'react'
import { SelectField, Btn } from '../ui'
import { STATUS_LABELS, SEVERITY_LABELS } from '../../lib/tokens'
import { IconArrowRight, IconExternalLink } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'

const STATUS_OPTS = ['new', 'classified', 'fixing', 'fixed', 'dismissed']
const SEV_OPTS = ['critical', 'high', 'medium', 'low']

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
}: ReportTriageBarProps) {
  const [showSaved, setShowSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const toast = useToast()
  const { data: integrationsData } = usePageData<{ integrations: RoutingIntegration[] }>('/v1/admin/integrations')
  const activeRoutes = (integrationsData?.integrations ?? []).filter((r) => r.is_active)

  useEffect(() => {
    if (!savedAt) return
    setShowSaved(true)
    const t = setTimeout(() => setShowSaved(false), 2_000)
    return () => clearTimeout(t)
  }, [savedAt])

  const dispatchDisabled = report.status === 'fixed' || report.status === 'dismissed' || isDispatchBusy
  const dispatchLabel =
    dispatchState.status === 'idle' ? 'Dispatch fix' :
    dispatchState.status === 'queueing' ? 'Dispatching…' :
    dispatchState.status === 'queued' ? 'Queued…' :
    dispatchState.status === 'running' ? 'Agent running…' :
    dispatchState.status === 'completed' ? 'PR ready' :
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
    <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-edge-subtle bg-surface-raised/50 p-3">
      <SelectField
        label="Status"
        value={report.status}
        onChange={(e) => onTriage({ status: e.currentTarget.value })}
        disabled={saving}
        className="!w-auto"
      >
        {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
      </SelectField>

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
        <div className="flex flex-col items-end gap-1">
          <Btn
            variant="primary"
            onClick={onDispatch}
            disabled={dispatchDisabled}
            loading={isDispatchBusy && dispatchState.status !== 'completed' && dispatchState.status !== 'failed'}
            leadingIcon={<IconArrowRight />}
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
            <span className="text-2xs text-danger max-w-xs text-right">{dispatchState.error}</span>
          )}
        </div>
      </div>
    </div>
  )
}
