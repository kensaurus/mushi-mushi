/**
 * FILE: apps/admin/src/components/integrations/TeamsIntegrationCard.tsx
 * PURPOSE: Connect card for Microsoft Teams incoming webhook notifications.
 *
 * OVERVIEW:
 * - Shows connected / not-connected status (teamsConfigured from stats).
 * - Paste-webhook-URL form with HTTPS URL validation.
 *   Supports both Power Automate "Post message in a chat or channel" webhooks
 *   and the legacy Office 365 Connector (incoming webhook) URLs.
 * - "Send test" button calls POST /v1/admin/projects/:pid/integrations/teams/test.
 * - Clear-webhook (disconnect) control.
 * - Step-by-step setup instructions for both webhook types.
 *
 * DEPENDENCIES:
 * - apiFetch  (admin API client)
 * - useToast
 *
 * USAGE:
 *   <TeamsIntegrationCard
 *     projectId={project.id}
 *     teamsConfigured={Boolean(settings?.teamsConfigured)}
 *   />
 */

import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

// ─── Teams brand SVG ──────────────────────────────────────────────────────────
// mushi-mushi-allowlist: Microsoft Teams trademark SVG uses exact brand purple hex.

function TeamsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.625 5.848c0 1.518-1.231 2.749-2.75 2.749s-2.748-1.231-2.748-2.749C15.127 4.33 16.358 3.1 17.876 3.1s2.75 1.231 2.75 2.748z"
        fill="#5059C9"
      />
      <path
        d="M22.5 10.25h-4.74a.386.386 0 0 0-.385.385V15.5a4.625 4.625 0 0 1-3.124 4.376 5.25 5.25 0 0 0 4.874-5.226v-2.023a2.376 2.376 0 0 1 2.375-2.376H22.5z"
        fill="#5059C9"
      />
      <path
        d="M13.875 5.598a3.125 3.125 0 1 1-6.25 0 3.125 3.125 0 0 1 6.25 0z"
        fill="#7B83EB"
      />
      <path
        d="M16.5 10.25H4.875A.875.875 0 0 0 4 11.125v5.5a5.875 5.875 0 1 0 11.75 0v-5.5a.875.875 0 0 0-.75-.875z"
        fill="#7B83EB"
      />
    </svg>
  )
}

// ─── Simple HTTPS URL validator ───────────────────────────────────────────────

function validateTeamsUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'https:') return 'URL must start with https://'
    if (!u.hostname.includes('.')) return 'Enter a valid webhook URL'
    return null
  } catch {
    return 'Enter a valid HTTPS webhook URL'
  }
}

// ─── Friendly error translation for test failures ─────────────────────────────

function translateTeamsTestError(raw: string): string {
  if (!raw) return 'Teams test failed — check the webhook URL is active.'
  if (/\b403\b/.test(raw)) return 'Teams rejected the message — the webhook URL may have expired or been revoked. Create a new webhook and paste the updated URL.'
  if (/\b404\b/.test(raw)) return 'Webhook not found in Teams — the connector may have been deleted. Create a new incoming webhook and update the URL.'
  if (/\b410\b/.test(raw)) return 'This webhook URL has been retired by Teams. Create a new Power Automate flow or Incoming Webhook connector and replace the URL.'
  if (/\b5\d\d\b/.test(raw)) return 'Teams returned a server error — try again in a moment.'
  if (/fetch|network|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(raw)) return 'Could not reach Teams — check your internet connection and try again.'
  return 'Teams returned an error — check the webhook URL is valid and still active, then try again.'
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string | null
  teamsConfigured: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TeamsIntegrationCard({ projectId, teamsConfigured }: Props) {
  const toast = useToast()

  const [connected, setConnected] = useState(teamsConfigured)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  // Sync if parent re-fetches and the prop changes
  useEffect(() => { setConnected(teamsConfigured) }, [teamsConfigured])

  // ── Validate on change ────────────────────────────────────────────────────

  function handleUrlChange(val: string) {
    setWebhookUrl(val)
    setUrlError(validateTeamsUrl(val))
  }

  // ── Save webhook URL ──────────────────────────────────────────────────────

  async function handleSave() {
    const trimmed = webhookUrl.trim()
    const err = validateTeamsUrl(trimmed)
    if (err) { setUrlError(err); return }
    if (!trimmed || !projectId) return

    setSaving(true)
    try {
      const res = await apiFetch('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ teams_webhook_url: trimmed }),
      })
      if (res.ok) {
        setConnected(true)
        toast.success('Teams webhook saved — test it below.')
        setWebhookUrl('')
        setUrlError(null)
      } else {
        toast.error(res.error?.message ?? 'Could not save Teams webhook URL.')
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
        `/v1/admin/projects/${projectId}/integrations/teams/test`,
        { method: 'POST' },
      )
      if (res.ok) {
        toast.success('Test message sent to Microsoft Teams!')
      } else {
        toast.error(translateTeamsTestError(res.error?.message ?? ''))
      }
    } catch {
      toast.error('Could not reach the Teams test endpoint — check your connection.')
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
        body: JSON.stringify({ teams_webhook_url: null }),
      })
      if (res.ok) {
        setConnected(false)
        toast.success('Teams webhook removed.')
      } else {
        toast.error('Could not remove Teams webhook.')
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
          {/* mushi-mushi-allowlist: Teams brand purple tint behind the trademark icon chip. */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#7B83EB]/10">
            <TeamsIcon size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">Microsoft Teams</h3>
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
          {connected && (
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing || !projectId}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-edge-subtle px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
            >
              {testing ? 'Sending…' : 'Send test'}
            </button>
          )}
        </div>
      </div>

      {/* Connected state — show clear control */}
      {connected && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-ok/30 bg-ok/8 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 text-ok text-sm" aria-hidden>✓</span>
            <p className="text-xs font-medium text-ok">Teams webhook active</p>
          </div>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={clearing}
            className="shrink-0 rounded px-2 py-1 text-xs text-fg-muted hover:text-danger hover:bg-danger/8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {clearing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      )}

      {/* Webhook URL form */}
      <div className="space-y-1.5">
        <label htmlFor="teams-webhook-url" className="block text-xs font-medium text-fg-secondary">
          {connected ? 'Replace webhook URL' : 'Incoming webhook URL'}
        </label>
        <div className="flex gap-2">
          <input
            id="teams-webhook-url"
            type="url"
            placeholder="https://…webhook.office.com/webhookb2/…"
            value={webhookUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            className={`
              flex-1 min-w-0 rounded-lg border bg-surface px-3 py-2 font-mono text-xs
              focus:outline-none focus:ring-2 focus:ring-focus
              ${urlError ? 'border-danger/60' : 'border-edge-subtle'}
            `}
            aria-describedby={urlError ? 'teams-url-error teams-url-hint' : 'teams-url-hint'}
            aria-invalid={Boolean(urlError)}
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!webhookUrl.trim() || Boolean(urlError) || saving || !projectId}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
          >
            {saving ? 'Saving…' : connected ? 'Update' : 'Save'}
          </button>
        </div>
        {urlError && (
          <p id="teams-url-error" role="alert" className="text-xs text-danger">
            {urlError}
          </p>
        )}
        <p id="teams-url-hint" className="text-2xs text-fg-muted">
          Supports both Power Automate &ldquo;Post to a channel&rdquo; and legacy Office 365 Connector webhooks.
        </p>
      </div>

      {/* Collapsible setup guide */}
      <details
        className="group"
        open={showGuide && !connected}
        onToggle={(e) => setShowGuide((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
          {connected ? 'How to create a new webhook URL' : 'How to get a webhook URL'}
        </summary>
        <div className="mt-3 space-y-3 rounded-lg border border-edge-subtle bg-surface-hover/40 px-4 py-3 text-xs text-fg-muted">
          <div>
            <p className="font-semibold text-fg mb-1">Option A — Power Automate (recommended)</p>
            <ol className="list-decimal list-inside space-y-0.5 text-fg-muted">
              <li>Go to <strong>Power Automate</strong> → <em>Create</em> → <em>Instant cloud flow</em></li>
              <li>Choose trigger <strong>&ldquo;When an HTTP request is received&rdquo;</strong></li>
              <li>Add action <strong>&ldquo;Post message in a chat or channel&rdquo;</strong></li>
              <li>Copy the <strong>HTTP POST URL</strong> from the trigger step</li>
            </ol>
          </div>
          <div>
            <p className="font-semibold text-fg mb-1">Option B — Legacy Incoming Webhook Connector</p>
            <ol className="list-decimal list-inside space-y-0.5 text-fg-muted">
              <li>Right-click the Teams channel → <em>Manage channel</em> → <em>Connectors</em></li>
              <li>Search for <strong>&ldquo;Incoming Webhook&rdquo;</strong> and click <em>Configure</em></li>
              <li>Name it &ldquo;Mushi&rdquo;, then click <em>Create</em></li>
              <li>Copy the webhook URL and paste it above</li>
            </ol>
          </div>
        </div>
      </details>

      {/* What you'll receive */}
      {!connected && (
        <div className="rounded-lg border border-edge-subtle bg-surface-hover/40 px-3 py-2.5 text-xs text-fg-muted space-y-1">
          <p className="font-medium text-fg">What you&apos;ll receive</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>New report triaged (severity + category + direct link)</li>
            <li>QA story failures with run details</li>
            <li>Fix merged / deployed events (when plugins enabled)</li>
          </ul>
        </div>
      )}
    </div>
  )
}
