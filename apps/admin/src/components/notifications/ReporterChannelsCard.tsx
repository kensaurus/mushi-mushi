/**
 * FILE: apps/admin/src/components/notifications/ReporterChannelsCard.tsx
 * PURPOSE: "Email and push updates" for reporters (Plan 018 Phase 3) — the
 *          per-project switches, whether this server can send them at all,
 *          why recent updates did not go out, and the wording of each
 *          automatic message.
 *
 * Backed by GET/PUT /v1/admin/projects/:id/reporter-settings. Reporters
 * always get updates inside the app; email and push are extra channels they
 * opt into themselves, and only once this project turns them on.
 */

import { useEffect, useState } from 'react'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import {
  TEMPLATE_KEYS,
  TEMPLATE_LABEL,
  TEMPLATE_MAX,
  deliveryLabel,
  deliveryNeedsAttention,
  templateProblem,
  templatesPayload,
  type ReporterSettingsView,
  type TemplateKey,
} from '../../lib/reporterChannels'
import { Badge, Btn, ErrorAlert, InfoHint, Textarea, Toggle } from '../ui'
import { reporterChannelBadge } from '../../lib/notificationsView'

/**
 * Server first, then the switch: a channel switched OFF reads "Off" in grey,
 * never a green "Ready to send" (round-2 review 2026-11-18).
 */
function ChannelBadge({ enabled, provider }: { enabled: boolean; provider: 'configured' | 'not_configured' }) {
  const badge = reporterChannelBadge(enabled, provider)
  // Off is the switch's own state: no second "Off" chip beside it (2026-11-19).
  if (badge.kind === 'off') return null
  const tone = badge.kind === 'server_missing' ? 'warnSubtle' : badge.kind === 'ready' ? 'okSubtle' : 'neutral'
  return (
    <span data-testid="reporter-channel-badge" data-kind={badge.kind}>
      <Badge tone={tone}>{badge.label}</Badge>
    </span>
  )
}

export function ReporterChannelsCard({ projectId }: { projectId: string }) {
  const toast = useToast()
  const path = `/v1/admin/projects/${encodeURIComponent(projectId)}/reporter-settings`
  const { data, loading, error, reload } = usePageData<ReporterSettingsView>(path, { deps: [projectId] })
  const [saving, setSaving] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Partial<Record<TemplateKey, string>>>({})
  const [showWording, setShowWording] = useState(false)

  useEffect(() => {
    if (data) setDrafts(data.templates ?? {})
  }, [data])

  const save = async (what: string, body: Record<string, unknown>, done: string) => {
    setSaving(what)
    try {
      const res = await apiFetch<ReporterSettingsView>(path, { method: 'PUT', body: JSON.stringify(body) })
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not save')
      toast.success(done)
      reload()
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(null)
    }
  }

  if (error) return <ErrorAlert title="Email and push settings unavailable" message={error} onRetry={reload} />
  if (loading && !data) {
    return (
      <p className="text-xs text-fg-muted">Loading email and push settings…</p>
    )
  }
  if (!data) return null

  const problems = TEMPLATE_KEYS.map((k) => [k, templateProblem(drafts[k] ?? '')] as const).filter(([, p]) => p)
  const wordingChanged = TEMPLATE_KEYS.some((k) => (drafts[k] ?? '').trim() !== (data.templates[k] ?? ''))

  return (
    // No card of its own: the "How reporters hear back" section is the card.
    <div className="space-y-4">
      {/* The how-it-works text sits behind the (i): it ran 3-4 lines above two switches (2026-11-19). */}
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        Email and push updates
        <InfoHint content="Reporters always see updates in your app. Turn these on to let them also ask for an email or a browser notification. Nobody gets one unless they opt in, and every email has a one-click unsubscribe." />
      </h3>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Toggle
              label="Email updates"
              checked={data.email_enabled}
              disabled={saving !== null}
              onChange={(next) =>
                void save('email', { email_enabled: next }, next ? 'Reporters can now ask for email updates.' : 'Email updates are off.')
              }
            />
            <ChannelBadge enabled={data.email_enabled} provider={data.providers.email} />
          </div>
          <p className="text-2xs text-fg-muted">
            {data.providers.email === 'not_configured'
              ? 'This server has no email sender yet (RESEND_API_KEY and RESEND_FROM_EMAIL). Until it does, reporters are not offered email and get in-app updates only.'
              : `${data.subscribers.email} reporter${data.subscribers.email === 1 ? '' : 's'} confirmed an email address. At most 3 emails a day each; the rest arrive in one daily digest.`}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Toggle
              label="Browser push"
              checked={data.push_enabled}
              disabled={saving !== null}
              onChange={(next) =>
                void save('push', { push_enabled: next }, next ? 'Reporters can now turn on browser notifications.' : 'Browser push is off.')
              }
            />
            <ChannelBadge enabled={data.push_enabled} provider={data.providers.push} />
          </div>
          <p className="text-2xs text-fg-muted">
            {data.providers.push === 'not_configured'
              ? 'This server has no push keys yet (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).'
              : `${data.subscribers.push} browser${data.subscribers.push === 1 ? '' : 's'} subscribed. Your web app also needs a service worker (notifications.webPush in the SDK). At most 2 a day, only for replies, questions and fixes.`}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-fg">Last 7 days</h4>
        {data.deliveries_7d.length === 0 ? (
          <p className="text-2xs text-fg-muted">No email or push updates were due.</p>
        ) : (
          <ul className="space-y-1">
            {data.deliveries_7d.map((row) => (
              <li key={`${row.channel}-${row.status}-${row.reason ?? ''}`} className="flex items-center justify-between gap-2 text-xs">
                <span className={deliveryNeedsAttention(row) ? 'text-warn' : 'text-fg-secondary'}>{deliveryLabel(row)}</span>
                <span className="font-mono text-fg-muted">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Btn size="sm" variant="ghost" aria-expanded={showWording} onClick={() => setShowWording((v) => !v)}>
          {showWording ? 'Hide message wording' : 'Change the wording of automatic messages'}
        </Btn>
        {showWording && (
          <div className="space-y-3">
            <p className="text-2xs text-fg-muted">
              Leave a box empty to keep the default. You can use {'{version}'}, {'{app}'} and {'{n}'} (how many reports a
              release fixed). Your own replies are never changed. Up to {TEMPLATE_MAX} characters each.
            </p>
            {TEMPLATE_KEYS.map((key) => (
              <Textarea
                key={key}
                label={TEMPLATE_LABEL[key]}
                rows={2}
                maxLength={TEMPLATE_MAX}
                placeholder={data.default_copy[key]}
                value={drafts[key] ?? ''}
                error={templateProblem(drafts[key] ?? '') ?? undefined}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            ))}
            <Btn
              size="sm"
              loading={saving === 'templates'}
              disabled={saving !== null || problems.length > 0 || !wordingChanged}
              onClick={() => void save('templates', { templates: templatesPayload(drafts) }, 'Message wording saved.')}
            >
              Save wording
            </Btn>
          </div>
        )}
      </div>
    </div>
  )
}
