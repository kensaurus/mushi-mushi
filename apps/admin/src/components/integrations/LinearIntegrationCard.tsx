/**
 * FILE: apps/admin/src/components/integrations/LinearIntegrationCard.tsx
 *
 * First-class Linear integration card with:
 * - OAuth "Connect Linear workspace" flow (redirects to /v1/admin/linear-oauth/authorize)
 * - API key fallback (paste linear_api_key_ref + team ID)
 * - Health sparkline (linear probe from integration-probes)
 * - "Disconnect" button (clears vault refs via DELETE /v1/admin/linear-oauth/disconnect)
 *
 * LinearIntegrationCard is a "first-class" card (like SlackIntegrationCard), not a
 * RoutingProviderCard — it controls OAuth tokens and the two-way sync/agent features,
 * not just outbound routing.
 */

import { useState } from 'react'
import { Btn, Input } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { HealthSparkline } from './HealthSparkline'
import type { HealthRow } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

// ── Linear wordmark SVG (brand color, see allowlist below) ───────────────────
function LinearLogo({ size = 20 }: { size?: number }) {
  return (
    /* mushi-mushi-allowlist: Linear trademark SVG uses brand hex #5E6AD2 */
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857l36.5093 36.5094c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228z"
        fill="#5E6AD2"
      />
      <path
        d="M.00189135 46.8891c-.01764375.5518.21817865 1.0849.64549065 1.512l50.9560993 50.956c.4272.4273.9603.6631 1.512.6455C58.5705 99.7303 64.8215 99 70.7361 97.5573c1.0726-.2699 1.4095-1.6087.5714-2.4468L2.42338 25.2257c-.83808-.83808-2.17689-.50517-2.44683.57142C.53006 31.1786-.0174642 38.8224.00189135 46.8891z"
        fill="#5E6AD2"
      />
      <path
        d="M6.8154 22.3002c-.5755-.5756-.5765-1.5027-.0147-2.0902C17.7999 7.47285 33.1437.0012 50.001.0012c27.6142 0 49.9997 22.3858 49.9997 50 0 16.857-7.4715 32.2009-19.2088 43.1995-.5875.5618-1.5146.5608-2.0902-.0147L6.8154 22.3002z"
        fill="#5E6AD2"
      />
    </svg>
  )
}

interface Props {
  projectId: string | null
  /** Whether any Linear credentials are configured (OAuth or API key). */
  linearConnected: boolean
  /** Workspace display name from project_settings.linear_workspace_name. */
  workspaceName?: string | null
  /** Default Linear team ID (for API-key fallback). */
  teamId?: string | null
  latestProbe?: HealthRow
  sparkline?: HealthRow[]
  onReload?: () => void
}

export function LinearIntegrationCard({
  projectId,
  linearConnected,
  workspaceName,
  teamId: initialTeamId,
  latestProbe,
  sparkline = [],
  onReload,
}: Props) {
  const toast = useToast()

  // API-key fallback tab
  const [apiKey, setApiKey] = useState('')
  const [teamId, setTeamId] = useState(initialTeamId ?? '')
  const [savingApiKey, setSavingApiKey] = useState(false)

  // Disconnect
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const probeStatus = latestProbe?.status

  const handleOAuthConnect = () => {
    if (!projectId) return
    // Redirect to the OAuth authorize route — Linear redirects back to /integrations?connected=linear
    window.location.href = `/api/v1/admin/linear-oauth/authorize?project_id=${encodeURIComponent(projectId)}`
  }

  const handleSaveApiKey = async () => {
    if (!apiKey.trim() || !projectId) return
    setSavingApiKey(true)
    try {
      const body: Record<string, string> = { linear_api_key_ref: apiKey.trim() }
      if (teamId.trim()) body.linear_team_id = teamId.trim()

      const res = await apiFetch(`/v1/admin/integrations/platform/linear`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      if (res.ok) {
        toast.success('Linear API key saved', 'Reports will now create Linear issues.')
        setApiKey('')
        onReload?.()
      } else {
        toast.error('Could not save Linear API key', res.error?.message)
      }
    } finally {
      setSavingApiKey(false)
    }
  }

  const handleDisconnect = async () => {
    if (!projectId) return
    setDisconnecting(true)
    try {
      const res = await apiFetch(`/v1/admin/linear-oauth/disconnect`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Linear disconnected', 'Credentials have been cleared.')
        setConfirmDisconnect(false)
        onReload?.()
      } else {
        toast.error('Could not disconnect Linear', res.error?.message)
      }
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="rounded-xl border border-edge-subtle bg-surface p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center flex-shrink-0">
            <LinearLogo size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-fg truncate">Linear</h3>
            {linearConnected ? (
              <p className="text-xs text-ok truncate">
                {workspaceName ? `Connected to ${workspaceName}` : 'Connected'}
              </p>
            ) : (
              <p className="text-xs text-fg-secondary truncate">
                Not connected — link your workspace to create issues and sync status
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {sparkline.length > 0 && (
            <span
              className="hidden sm:flex"
              title={probeStatus ? `Linear health: ${probeStatus}` : undefined}
            >
              <HealthSparkline rows={sparkline} />
            </span>
          )}

          {linearConnected && !confirmDisconnect && (
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </Btn>
          )}

          {confirmDisconnect && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-warn">Disconnect Linear?</span>
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </Btn>
              <Btn
                type="button"
                variant="danger"
                size="sm"
                loading={disconnecting}
                onClick={() => void handleDisconnect()}
              >
                {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
              </Btn>
            </div>
          )}

          <Btn
            type="button"
            variant={linearConnected ? 'ghost' : 'accent'}
            size="sm"
            onClick={handleOAuthConnect}
            disabled={!projectId}
            title={linearConnected ? 'Reconnect to refresh permissions' : 'Connect your Linear workspace via OAuth'}
          >
            {linearConnected ? 'Reconnect' : 'Connect workspace'}
          </Btn>
        </div>
      </div>

      {/* Connected features summary */}
      {linearConnected && (
        <div className={`rounded-lg px-3 py-2 text-xs space-y-1 ${CHIP_TONE.okSubtle}`}>
          <p className="font-medium">Active features</p>
          <ul className="text-fg-secondary leading-relaxed space-y-0.5 ml-2">
            <li>✓ Auto-create issues for triaged bugs</li>
            <li>✓ Two-way status sync (issue resolved → report resolved)</li>
            <li>✓ Mushi available as a Linear AI Agent</li>
            <li>✓ Linear tools available in Mushi MCP server</li>
          </ul>
        </div>
      )}

      {/* API-key fallback */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-fg-tertiary hover:text-fg-secondary transition-opacity list-none flex items-center gap-1">
          <span className="group-open:rotate-90 transition-transform inline-block">›</span>
          Use a Linear API key instead (no OAuth required)
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-2xs text-fg-muted leading-snug">
            Generates a personal API key at{' '}
            <a
              href="https://linear.app/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline"
            >
              linear.app/settings/api
            </a>
            . Using OAuth above is recommended for two-way sync and agent features.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <label className="block text-xs text-fg-secondary mb-1">API key</label>
              <Input
                type="password"
                placeholder="lin_api_…"
                className="font-mono text-xs"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="w-32 shrink-0">
              <label className="block text-xs text-fg-secondary mb-1">Team ID (optional)</label>
              <Input
                type="text"
                placeholder="e.g. ENG"
                className="font-mono text-xs"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              />
            </div>
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              disabled={!apiKey.trim()}
              loading={savingApiKey}
              onClick={() => void handleSaveApiKey()}
              className="shrink-0 self-end"
            >
              {savingApiKey ? 'Saving…' : 'Save'}
            </Btn>
          </div>
        </div>
      </details>
    </div>
  )
}
