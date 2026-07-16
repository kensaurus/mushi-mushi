/**
 * FILE: apps/admin/src/components/integrations/DiscordIntegrationCard.tsx
 * PURPOSE: Connect card for Discord incoming webhook notifications.
 *
 * OVERVIEW:
 * - Shows connected / not-connected status (discordConfigured from stats).
 * - Paste-webhook-URL form with Discord URL validation.
 * - "Send test" button calls POST /v1/admin/projects/:pid/integrations/discord/test.
 * - Health sparkline from integration probes.
 * - Clear-webhook (disconnect) control.
 *
 * DEPENDENCIES:
 * - apiFetch  (admin API client)
 * - discordWebhookUrl validator from lib/validators.ts
 * - HealthSparkline component
 * - useToast
 *
 * USAGE:
 *   <DiscordIntegrationCard
 *     projectId={project.id}
 *     discordConfigured={Boolean(settings?.discordConfigured)}
 *     latestProbe={latestByKind['discord']}
 *     sparkline={sparklineByKind['discord'] ?? []}
 *   />
 */

import { useState, useEffect } from 'react'
import { Btn, Input } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { discordWebhookUrl } from '../../lib/validators'
import { HealthSparkline } from './HealthSparkline'
import type { HealthRow } from './types'

// ─── Friendly error translation for test failures ─────────────────────────────

function translateDiscordTestError(raw: string): string {
  if (!raw) return 'Discord test failed — check the webhook URL is active.'
  if (/\b401\b/.test(raw)) return 'Discord rejected the request — the webhook token may be invalid. Check the URL is copied correctly.'
  if (/\b403\b/.test(raw)) return 'Discord denied access — the webhook URL may have been revoked. Delete the webhook in Discord and create a new one.'
  if (/\b404\b/.test(raw)) return 'Webhook not found in Discord — it may have been deleted. Create a new incoming webhook and update the URL.'
  if (/\b429\b/.test(raw)) return 'Discord rate-limited the test — wait a moment and try again.'
  if (/\b5\d\d\b/.test(raw)) return 'Discord returned a server error — try again in a moment.'
  if (/fetch|network|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(raw)) return 'Could not reach Discord — check your internet connection and try again.'
  return 'Discord returned an error — check the webhook URL is valid and the channel still exists.'
}

// ─── Discord brand SVG ────────────────────────────────────────────────────────
// mushi-mushi-allowlist: Discord trademark SVG uses exact brand blurple hex.

function DiscordIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.04.036.05a19.906 19.906 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
        fill="var(--color-brand-discord-blurple)"
      />
    </svg>
  )
}

// ─── URL validator instance ───────────────────────────────────────────────────

const validateDiscordUrl = discordWebhookUrl({ optional: true })

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string | null
  discordConfigured: boolean
  latestProbe?: HealthRow
  sparkline?: HealthRow[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DiscordIntegrationCard({
  projectId,
  discordConfigured,
  latestProbe,
  sparkline = [],
}: Props) {
  const toast = useToast()

  const [connected, setConnected] = useState(discordConfigured)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Sync if parent re-fetches and the prop changes
  useEffect(() => { setConnected(discordConfigured) }, [discordConfigured])

  const probeStatus = latestProbe?.status

  // ── Validate on change ────────────────────────────────────────────────────

  function handleUrlChange(val: string) {
    setWebhookUrl(val)
    const err = validateDiscordUrl(val)
    setUrlError(err?.message ?? null)
  }

  // ── Save webhook URL ──────────────────────────────────────────────────────

  async function handleSave() {
    const trimmed = webhookUrl.trim()
    const err = validateDiscordUrl(trimmed)
    if (err) { setUrlError(err.message); return }
    if (!trimmed || !projectId) return

    setSaving(true)
    try {
      const res = await apiFetch('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ discord_webhook_url: trimmed }),
      })
      if (res.ok) {
        setConnected(true)
        toast.success('Discord webhook saved — test it below.')
        setWebhookUrl('')
        setUrlError(null)
      } else {
        toast.error(res.error?.message ?? 'Could not save Discord webhook URL.')
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Send test message ─────────────────────────────────────────────────────

  async function handleTest() {
    if (!projectId) return
    setTesting(true)
    try {
      const res = await apiFetch(
        `/v1/admin/projects/${projectId}/integrations/discord/test`,
        { method: 'POST' },
      )
      if (res.ok) {
        toast.success('Test message sent to Discord!')
      } else {
        toast.error(translateDiscordTestError(res.error?.message ?? ''))
      }
    } catch {
      toast.error('Could not reach the Discord test endpoint — check your connection.')
    } finally {
      setTesting(false)
    }
  }

  // ── Clear (disconnect) ────────────────────────────────────────────────────

  async function handleClear() {
    if (!projectId) return
    setClearing(true)
    try {
      const res = await apiFetch('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ discord_webhook_url: null }),
      })
      if (res.ok) {
        setConnected(false)
        toast.success('Discord webhook removed.')
      } else {
        toast.error('Could not remove Discord webhook.')
      }
    } finally {
      setClearing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-edge-subtle bg-surface p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* mushi-mushi-allowlist: Discord brand blurple tint behind the trademark icon chip. */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-discord-blurple/10">
            <DiscordIcon size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">Discord</h3>
            {connected ? (
              <p className="text-xs text-ok truncate">Webhook connected — receiving report alerts</p>
            ) : (
              <p className="text-xs text-fg-muted truncate">
                Not connected — paste an incoming webhook URL to enable alerts
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {sparkline.length > 0 && (
            <span
              className="hidden sm:flex"
              title={probeStatus ? `Discord health: ${probeStatus}` : undefined}
            >
              <HealthSparkline rows={sparkline} />
            </span>
          )}

          {connected && (
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleTest()}
              disabled={!projectId}
              loading={testing}
            >
              {testing ? 'Sending…' : 'Send test'}
            </Btn>
          )}
        </div>
      </div>

      {/* Connected state — show clear control */}
      {connected && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-ok/30 bg-ok-muted/50 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 text-ok-foreground text-sm" aria-hidden>✓</span>
            <p className="text-xs font-medium text-ok-foreground">Discord webhook active</p>
          </div>
          <Btn
            type="button"
            variant="danger"
            size="sm"
            onClick={() => void handleClear()}
            loading={clearing}
            className="shrink-0"
          >
            {clearing ? 'Removing…' : 'Remove'}
          </Btn>
        </div>
      )}

      {/* Webhook URL form */}
      <div className="space-y-1.5">
        <label htmlFor="discord-webhook-url" className="block text-xs font-medium text-fg-secondary">
          {connected ? 'Replace webhook URL' : 'Incoming webhook URL'}
        </label>
        <div className="flex gap-2 items-start">
          <div className="flex-1 min-w-0">
            <Input
              id="discord-webhook-url"
              type="url"
              placeholder="https://discord.com/api/webhooks/…"
              value={webhookUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              error={urlError ?? undefined}
              className="font-mono text-xs"
              aria-describedby="discord-url-hint"
            />
          </div>
          <Btn
            type="button"
            variant="accent"
            onClick={() => void handleSave()}
            disabled={!webhookUrl.trim() || Boolean(urlError) || !projectId}
            loading={saving}
            className="shrink-0"
          >
            {saving ? 'Saving…' : connected ? 'Update' : 'Save'}
          </Btn>
        </div>
        <p id="discord-url-hint" className="text-2xs text-fg-muted">
          In Discord: <strong>Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL</strong>.
        </p>
      </div>

      {/* What you'll receive */}
      {!connected && (
        <div className="rounded-lg border border-edge-subtle bg-surface-hover/40 px-3 py-2.5 text-xs text-fg-muted space-y-1">
          <p className="font-medium text-fg">What you'll receive</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>New report triaged (severity + category)</li>
            <li>QA story failures with run details</li>
            <li>Fix merged / deployed events (when plugins enabled)</li>
          </ul>
        </div>
      )}
    </div>
  )
}
