/**
 * FILE: apps/admin/src/components/integrations/SlackIntegrationCard.tsx
 *
 * First-class Slack integration card with:
 * - "Add to Slack" OAuth button (per-project bot token flow)
 * - Channel picker (proxied conversations.list)
 * - Send-test button
 * - Health sparkline (slack probe from integration-probes)
 * - Legacy webhook URL fallback behind a <details>
 */

import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { HealthSparkline } from './HealthSparkline'
import type { HealthRow } from './types'

interface Props {
  projectId: string | null
  slackConfigured: boolean
  teamName: string | null
  latestProbe?: HealthRow
  sparkline?: HealthRow[]
  /** Currently saved channel ID from project_settings (for informational display). */
  channelId?: string | null
}

interface SlackChannel {
  id: string
  name: string
  private: boolean
}

/** Decode the Slack error code from the backend into an actionable UI message. */
function slackErrorToMessage(errorCode: string | undefined, rawMessage: string): string {
  if (errorCode === 'missing_scope') {
    return "Your Slack app doesn't have 'channels:read' permission. Click \"Re-add to Slack\" below to reinstall with the correct scopes."
  }
  if (['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked'].includes(errorCode ?? '')) {
    return 'Slack token is invalid or revoked. Click "Re-add to Slack" below to reconnect.'
  }
  if (rawMessage) return rawMessage
  return 'Failed to load channels. Check your Slack connection or click "Re-add to Slack".'
}

export function SlackIntegrationCard({ projectId, slackConfigured, teamName, latestProbe, sparkline = [], channelId }: Props) {
  const toast = useToast()
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [channelLoadError, setChannelLoadError] = useState<string | null>(null)
  const [channelErrorCode, setChannelErrorCode] = useState<string | null>(null)
  const [selectedChannel, setSelectedChannel] = useState('')
  const [testingSlack, setTestingSlack] = useState(false)
  const [savingChannel, setSavingChannel] = useState(false)
  const [manualChannelId, setManualChannelId] = useState('')
  const [savingManual, setSavingManual] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')

  const probeStatus = latestProbe?.status

  const loadChannels = () => {
    if (!slackConfigured || !projectId) return
    setLoadingChannels(true)
    setChannelLoadError(null)
    setChannelErrorCode(null)
    apiFetch<{ channels?: SlackChannel[] }>('/v1/admin/integrations/slack/channels')
      .then((res) => {
        if (res.ok) {
          setChannels(res.data?.channels ?? [])
        } else {
          setChannels([])
          const errCode = res.error?.code as string | undefined
          const rawMsg = res.error?.message ?? ''
          setChannelErrorCode(errCode ?? null)
          setChannelLoadError(slackErrorToMessage(errCode, rawMsg))
        }
      })
      .catch(() => {
        setChannelLoadError('Could not reach the Slack channels endpoint. Check your connection.')
      })
      .finally(() => setLoadingChannels(false))
  }

  // Load channel list when connected
  useEffect(() => {
    loadChannels()
    // loadChannels is intentionally omitted: only re-fetch when the connection
    // state or project changes, not on every render-stable closure identity.
  }, [slackConfigured, projectId])

  const handleAddToSlack = () => {
    if (!projectId) return
    // Navigate to the OAuth install route — Slack redirects back after auth
    window.location.href = `/api/v1/admin/integrations/slack/install?project_id=${projectId}`
  }

  const handleSaveChannel = async () => {
    if (!selectedChannel || !projectId) return
    setSavingChannel(true)
    try {
      const res = await apiFetch('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ slack_channel_id: selectedChannel }),
      })
      if (res.ok) {
        toast.success('Channel saved — Slack notifications will go here.')
      } else {
        toast.error('Could not save channel.')
      }
    } finally {
      setSavingChannel(false)
    }
  }

  const handleSaveManualChannelId = async () => {
    const id = manualChannelId.trim()
    if (!id || !projectId) return
    setSavingManual(true)
    try {
      const res = await apiFetch('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ slack_channel_id: id }),
      })
      if (res.ok) {
        toast.success('Channel ID saved — Slack notifications will go here.')
        setManualChannelId('')
      } else {
        toast.error('Could not save channel ID.')
      }
    } finally {
      setSavingManual(false)
    }
  }

  const handleTest = async () => {
    setTestingSlack(true)
    try {
      const res = await apiFetch('/v1/admin/settings/test-slack', { method: 'POST' })
      if (res.ok) toast.success('Test message sent to Slack!')
      else toast.error(res.error?.message ?? 'Slack test failed.')
    } catch {
      toast.error('Could not reach Slack.')
    } finally {
      setTestingSlack(false)
    }
  }

  const handleSaveWebhook = async () => {
    if (!webhookUrl) return
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ slack_webhook_url: webhookUrl }),
    })
    if (res.ok) toast.success('Webhook URL saved.')
    else toast.error('Could not save webhook URL.')
  }

  return (
    <div className="rounded-xl border border-edge-subtle bg-surface p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center flex-shrink-0">
            {/* mushi-mushi-allowlist: Slack trademark SVG requires exact brand hex fills */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="var(--color-brand-slack-pink)"/>
              <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="var(--color-brand-slack-blue)"/>
              <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="var(--color-brand-slack-green)"/>
              <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="var(--color-brand-slack-yellow)"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-fg truncate">Slack</h3>
            {slackConfigured ? (
              <p className="text-xs text-ok truncate">{teamName ? `Connected to ${teamName}` : 'Connected'}</p>
            ) : (
              <p className="text-xs text-fg-secondary truncate">Not connected — add to a workspace to receive notifications</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {sparkline.length > 0 && (
            <span
              className="hidden sm:flex"
              title={probeStatus ? `Slack health: ${probeStatus}` : undefined}
            >
              <HealthSparkline rows={sparkline} />
            </span>
          )}
          {slackConfigured && (
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge-subtle px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
              onClick={handleTest}
              disabled={testingSlack}
            >
              {testingSlack ? 'Sending…' : 'Send test'}
            </button>
          )}
          {/* Always show the Add/Re-add button so the user can refresh scopes */}
          <button
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${slackConfigured ? 'border border-edge-subtle hover:bg-surface-hover' : 'bg-accent text-white hover:bg-accent-hover'}`}
            onClick={handleAddToSlack}
            disabled={!projectId}
            title={slackConfigured ? 'Reinstall Mushi Slack bot to refresh scopes or reconnect' : 'Install Mushi Slack bot'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className={slackConfigured ? 'opacity-60' : 'opacity-90'}>
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>
            </svg>
            {slackConfigured ? 'Re-add to Slack' : 'Add to Slack'}
          </button>
        </div>
      </div>

      {/* Channel picker (shown when connected) */}
      {slackConfigured && (
        <div className="pt-1 space-y-3">
          {/* Active channel status — shown prominently when a channel is configured */}
          {channelId ? (
            <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/8 px-3 py-2">
              <span className="shrink-0 text-ok text-sm" aria-hidden="true">✓</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-ok leading-tight">Notifications active</p>
                <p className="text-2xs text-fg-secondary leading-snug mt-0.5">
                  Sending to channel <code className="font-mono bg-surface-hover rounded px-1">{channelId}</code>
                  {' — '}use "Send test" above to verify.
                </p>
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-medium text-fg-secondary mb-1.5">
              {channelId ? 'Change notification channel' : 'Select notification channel'}
            </label>
            {loadingChannels ? (
              <div className="h-9 rounded-lg bg-surface-hover animate-pulse" />
            ) : channelLoadError ? (
              <div className="rounded-sm border border-warn/30 bg-warn/8 px-2.5 py-2 text-xs text-warn space-y-2">
                <p className="leading-snug font-medium">Channel picker unavailable</p>
                <p className="leading-snug text-fg-secondary">{channelLoadError}</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    className="inline-flex items-center gap-1 text-xs font-medium underline hover:no-underline text-fg-secondary"
                    onClick={loadChannels}
                  >
                    Retry
                  </button>
                  {/* Scope errors are fixed by re-auth; auth/token errors too */}
                  {(channelErrorCode === 'missing_scope' ||
                    ['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked'].includes(channelErrorCode ?? '')) && (
                    <button
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand underline hover:no-underline"
                      onClick={handleAddToSlack}
                      disabled={!projectId}
                    >
                      Re-add to Slack to fix →
                    </button>
                  )}
                </div>
                {/* Manual channel ID entry as fallback */}
                <div className="pt-1 border-t border-warn/20">
                  <p className="text-2xs text-fg-muted mb-1.5">
                    Or paste the channel ID directly (right-click a channel in Slack → View channel details → bottom of panel):
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="C0ABC123XYZ"
                      className="flex-1 rounded-lg border border-edge-subtle bg-surface px-3 py-1.5 text-xs font-mono focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:border-brand"
                      value={manualChannelId}
                      onChange={(e) => setManualChannelId(e.target.value)}
                    />
                    <button
                      className="rounded-lg border border-edge-subtle px-3 py-1.5 text-xs font-medium hover:bg-surface-hover disabled:opacity-50 transition-colors"
                      disabled={!manualChannelId.trim() || savingManual}
                      onClick={handleSaveManualChannelId}
                    >
                      {savingManual ? 'Saving…' : 'Save ID'}
                    </button>
                  </div>
                </div>
              </div>
            ) : channels.length > 0 ? (
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-lg border border-edge-subtle bg-surface px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:border-brand"
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                >
                  <option value="">Pick a channel…</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.private ? '🔒 ' : '#'}{ch.name}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-lg bg-brand text-brand-fg px-4 py-2 text-sm font-medium hover:bg-brand-hover disabled:opacity-50 motion-safe:transition-colors"
                  disabled={!selectedChannel || savingChannel}
                  onClick={handleSaveChannel}
                >
                  {savingChannel ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <p className="rounded-sm border border-warn/30 bg-warn/10 px-2.5 py-2 text-xs text-warn">
                No channels found — invite the Mushi bot to at least one Slack channel first, then retry.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Legacy webhook fallback */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-fg-tertiary hover:text-fg-secondary transition-colors list-none flex items-center gap-1">
          <span className="group-open:rotate-90 transition-transform inline-block">›</span>
          Use incoming webhook URL instead (legacy)
        </summary>
        <div className="mt-3 flex gap-2">
          <input
            type="url"
            placeholder="https://hooks.slack.com/services/…"
            className="flex-1 rounded-lg border border-edge-subtle bg-surface px-3 py-2 text-xs font-mono focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:border-brand"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <button
            className="rounded-lg border border-edge-subtle px-4 py-2 text-xs font-medium hover:bg-surface-hover disabled:opacity-50 transition-colors"
            disabled={!webhookUrl}
            onClick={handleSaveWebhook}
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-fg-tertiary">
          Webhook URL sends to a fixed channel; it cannot be changed per-project or thread replies. Use "Add to Slack" for the full experience.
        </p>
      </details>
    </div>
  )
}
