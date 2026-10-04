/**
 * FILE: apps/admin/src/components/settings/VoiceIntakePanel.tsx
 * PURPOSE: Settings → Voice intake (plan docs/execplans/dead-code-voice-agent-loop.md,
 *          C6 privacy/retention + C7 "Voice intake settings card"). Toggles
 *          `voice_intake_enabled`, audio retention, transcription languages,
 *          the Telegram bot (token → bind code → webhook → status), the GitHub
 *          user token for cloud agent tasks, and the voice:write key hint.
 *          Loads + persists `/v1/admin/settings` like GeneralPanel; secret
 *          fields send the raw value in the `*_ref` column and the server
 *          vaults it (same contract as the integrations routes).
 */

import { useState } from 'react'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Btn, Checkbox, CopyButton, ErrorAlert, Input, ResultChip, SecretInput, Toggle } from '../ui'
import { BrandIcon } from '../ui/BrandIcon'
import { IconBell, IconClock, IconGlobe, IconMic, IconTerminal } from '../icons'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfirmDialog } from '../ConfirmDialog'
import { SettingsChangeHint } from './SettingsChangeHint'
import { SettingsFormFooter } from './SettingsFormFooter'
import { countChangedFields } from './settingsDiff'
import { PushNotifyCard } from '../voice/PushNotifyCard'
import { describeByokError } from '../../lib/byokErrors'
import { SettingsList, SettingsRow } from './SettingsRow'
import { telegramRowStatus } from './telegramStatus'

interface VoiceSettings {
  voice_intake_enabled?: boolean
  voice_audio_retention_days?: number | null
  voice_languages?: string[] | null
  /** Masked hint (`…x4f2`) or `vault://…` when configured; null otherwise. */
  telegram_bot_token_ref?: string | null
  github_user_token_ref?: string | null
}

interface TelegramBinding {
  chat_id: string
  bound_at?: string | null
  bound_by_telegram_user_id?: string | null
}

interface TelegramStatus {
  configured: boolean
  /** True once "Connect webhook" registered it with Telegram. */
  webhook_registered?: boolean
  /** Where the webhook would point. Always present, so it says nothing about whether it is connected. */
  webhook_url?: string | null
  bindings: TelegramBinding[]
}

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' },
  { code: 'th', label: 'ไทย' },
]

const DEFAULT_LANGUAGES = ['en', 'ja']
const DEFAULT_RETENTION_DAYS = 0

/** GET returns a mask for a stored secret (older servers: the vault ref); only masks are displayable. */
function secretHint(value: string | null | undefined): string | null {
  if (!value) return null
  return value.startsWith('vault://') ? null : value
}

export function VoiceIntakePanel() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<VoiceSettings>('/v1/admin/settings')
  const telegram = usePageData<TelegramStatus>('/v1/admin/telegram/status') // error-handled-by-parent

  const saved: VoiceSettings = data ?? {}
  const [draft, setDraft] = useState<Partial<VoiceSettings> | null>(null)
  const [telegramTokenDraft, setTelegramTokenDraft] = useState('')
  const [githubTokenDraft, setGithubTokenDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const enabled = draft?.voice_intake_enabled ?? saved.voice_intake_enabled ?? false
  const retention = draft?.voice_audio_retention_days ?? saved.voice_audio_retention_days ?? DEFAULT_RETENTION_DAYS
  const languages = draft?.voice_languages ?? saved.voice_languages ?? DEFAULT_LANGUAGES

  const update = (patch: Partial<VoiceSettings>) => setDraft({ ...(draft ?? {}), ...patch })
  const dirty = draft != null || telegramTokenDraft.trim().length > 0 || githubTokenDraft.trim().length > 0

  const changeCount = countChangedFields([
    { current: enabled, saved: saved.voice_intake_enabled ?? false },
    { current: retention, saved: saved.voice_audio_retention_days ?? DEFAULT_RETENTION_DAYS },
    { current: [...languages].sort().join(','), saved: [...(saved.voice_languages ?? DEFAULT_LANGUAGES)].sort().join(',') },
    { current: telegramTokenDraft.trim() ? 'new' : '', saved: '' },
    { current: githubTokenDraft.trim() ? 'new' : '', saved: '' },
  ])

  function resetDraft() {
    setDraft(null)
    setTelegramTokenDraft('')
    setGithubTokenDraft('')
  }

  async function save() {
    setSaving(true)
    const body: Record<string, unknown> = {
      voice_intake_enabled: enabled,
      voice_audio_retention_days: Math.max(0, Math.min(365, Math.round(retention))),
      voice_languages: languages.length > 0 ? languages : DEFAULT_LANGUAGES,
    }
    if (telegramTokenDraft.trim()) body.telegram_bot_token_ref = telegramTokenDraft.trim()
    if (githubTokenDraft.trim()) body.github_user_token_ref = githubTokenDraft.trim()
    const res = await apiFetch('/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(body) })
    setSaving(false)
    if (res.ok) {
      toast.success('Voice settings saved')
      resetDraft()
      reload()
      telegram.reload()
    } else {
      toast.error('Your voice settings were not saved', describeByokError(res.error, 'Retry in a moment.').message)
    }
  }

  // ── Telegram actions ────────────────────────────────────────────────────
  const [bindCode, setBindCode] = useState<{ code: string; expires_at: string } | null>(null)
  const [tgBusy, setTgBusy] = useState<'code' | 'webhook' | 'remove' | null>(null)
  const [tgResult, setTgResult] = useState<{ tone: 'success' | 'error' | 'info'; text: string; at: string } | null>(null)
  const [removeChat, setRemoveChat] = useState<string | null>(null)

  const note = (tone: 'success' | 'error' | 'info', text: string) => setTgResult({ tone, text, at: new Date().toISOString() })

  async function generateBindCode() {
    setTgBusy('code')
    const res = await apiFetchMutate<{ code: string; expires_at: string }>('/v1/admin/telegram/bind-code')
    setTgBusy(null)
    if (res.ok && res.data?.code) {
      setBindCode(res.data)
      note('success', 'Link code ready. Send it to the bot within 10 minutes.')
    } else {
      note('error', describeByokError(res.error, "Couldn't make a link code. Save the bot token first, then retry.").message)
    }
  }

  async function connectWebhook() {
    setTgBusy('webhook')
    const res = await apiFetchMutate<{ webhook_url: string }>('/v1/admin/telegram/setup')
    setTgBusy(null)
    if (res.ok) {
      note('success', `Webhook registered${res.data?.webhook_url ? ` at ${res.data.webhook_url}` : ''}.`)
      telegram.reload()
    } else {
      note('error', describeByokError(res.error, "Couldn't connect the webhook. Check the bot token, then retry.").message)
    }
  }

  async function removeBinding(chatId: string) {
    setTgBusy('remove')
    const res = await apiFetch(`/v1/admin/telegram/bindings/${encodeURIComponent(chatId)}`, { method: 'DELETE' })
    setTgBusy(null)
    setRemoveChat(null)
    if (res.ok) {
      note('info', 'Chat unlinked.')
      telegram.reload()
    } else {
      note('error', describeByokError(res.error, "Couldn't unlink the chat. Retry in a moment.").message)
    }
  }

  if (loading) return <PanelSkeleton rows={4} label="Loading voice settings" inCard={false} />
  if (error) return <ErrorAlert message={`Failed to load settings: ${error}`} onRetry={reload} />

  const telegramConfigured = Boolean(saved.telegram_bot_token_ref) || telegram.data?.configured === true
  const githubConfigured = Boolean(saved.github_user_token_ref)
  const bindings = telegram.data?.bindings ?? []
  const webhookConnected = telegram.data?.webhook_registered === true

  const telegramStatus = telegramRowStatus(telegramConfigured, telegram.data)

  return (
    <>
      <SettingsList
        title="Voice reports"
        description="Say a bug out loud and Mushi turns it into a report. Off until you turn it on; recordings are deleted after transcription unless you keep them, and you confirm every transcript before anything is sent to a coding agent."
      >
        <SettingsRow
          icon={<IconMic size={16} />}
          title="Accept voice reports"
          purpose="Turns on the Voice page, the Telegram and Slack inboxes, and phone shortcuts for this project."
          action={<Toggle label={enabled ? 'On' : 'Off'} checked={enabled} onChange={(v) => update({ voice_intake_enabled: v })} />}
        >
          <SettingsChangeHint current={enabled} saved={saved.voice_intake_enabled ?? false} kind="bool" />
        </SettingsRow>

        <SettingsRow
          icon={<IconClock size={16} />}
          title="Keep recordings for"
          purpose="0 deletes each recording as soon as it is transcribed. The transcript stays on the report either way."
        >
          <Input
            label="Days"
            type="number"
            min={0}
            max={365}
            step={1}
            value={String(retention)}
            onChange={(e) => update({ voice_audio_retention_days: Number.parseInt(e.target.value || '0', 10) || 0 })}
          />
          <SettingsChangeHint current={retention} saved={saved.voice_audio_retention_days ?? DEFAULT_RETENTION_DAYS} kind="number" />
        </SettingsRow>

        <SettingsRow
          icon={<IconGlobe size={16} />}
          title="Languages"
          purpose="The languages you speak in. They help transcription; pick at least one."
        >
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {LANGUAGES.map((l) => (
              <Checkbox
                key={l.code}
                label={l.label}
                checked={languages.includes(l.code)}
                onChange={(checked) =>
                  update({
                    voice_languages: checked ? [...languages, l.code] : languages.filter((c) => c !== l.code),
                  })
                }
              />
            ))}
          </div>
          <SettingsChangeHint
            current={[...languages].sort().join(', ')}
            saved={[...(saved.voice_languages ?? DEFAULT_LANGUAGES)].sort().join(', ')}
          />
        </SettingsRow>

        <SettingsRow
          icon={<IconTerminal size={16} />}
          title="iPhone Shortcut or any phone"
          purpose="A Shortcut dictates on your phone and sends the text with a voice-only key that can't do anything else."
          action={
            <Btn size="sm" variant="ghost" to="/projects?keyScope=voice">
              Make a voice key
            </Btn>
          }
        />
      </SettingsList>

      <SettingsList title="Telegram" description="Send voice notes to a Telegram bot, handy on Android.">
        <SettingsRow
          icon={<BrandIcon brand="telegram" size={18} decorative />}
          title="Telegram bot"
          purpose="Voice notes sent to your bot become reports for this project."
          status={telegramStatus}
          action={
            telegramConfigured ? (
              <>
                <Btn
                  variant={webhookConnected ? 'ghost' : 'primary'}
                  size="sm"
                  onClick={() => void connectWebhook()}
                  loading={tgBusy === 'webhook'}
                  disabled={tgBusy !== null}
                >
                  {webhookConnected ? 'Reconnect webhook' : 'Connect webhook'}
                </Btn>
                <Btn
                  variant={webhookConnected && bindings.length === 0 ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => void generateBindCode()}
                  loading={tgBusy === 'code'}
                  disabled={tgBusy !== null}
                >
                  Make link code
                </Btn>
              </>
            ) : null
          }
        >
          <SecretInput
            label={telegramConfigured ? 'Replace the bot token' : 'Bot token from @BotFather'}
            value={telegramTokenDraft}
            onChange={(e) => setTelegramTokenDraft(e.target.value)}
            placeholder={
              telegramConfigured
                ? `Saved (${secretHint(saved.telegram_bot_token_ref) ?? 'in Vault'}). Paste a new token to replace it.`
                : '123456789:AA…'
            }
          />
          <p className="text-xs text-fg-muted">
            Save the token, connect the webhook, then make a link code and send it to the bot from the chat you want to use.
          </p>
          {bindCode && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-sm border border-edge bg-surface-raised px-2 py-1 font-mono text-sm tracking-widest text-fg">
                {bindCode.code}
              </code>
              <CopyButton value={bindCode.code} label="Copy code" />
              <span className="text-sm text-fg-secondary">
                Send <span className="font-mono">/start {bindCode.code}</span> to the bot before{' '}
                {new Date(bindCode.expires_at).toLocaleTimeString()}.
              </span>
            </div>
          )}
          {tgResult && (
            <ResultChip tone={tgResult.tone} at={tgResult.at}>
              {tgResult.text}
            </ResultChip>
          )}
          {bindings.length > 0 && (
            <ul className="divide-y divide-edge-subtle border-t border-edge-subtle">
              {bindings.map((b) => (
                <li key={b.chat_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="text-fg-secondary">
                    Linked chat <span className="font-mono text-xs text-fg-muted">{b.chat_id}</span>
                  </span>
                  {b.bound_at && <span className="text-fg-muted">since {new Date(b.bound_at).toLocaleDateString()}</span>}
                  <Btn
                    variant="cancel"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setRemoveChat(b.chat_id)}
                    disabled={tgBusy !== null}
                  >
                    Unlink
                  </Btn>
                </li>
              ))}
            </ul>
          )}
        </SettingsRow>
      </SettingsList>

      <SettingsList title="Coding agents" description="Accounts Mushi uses when you send a voice fix request to an agent.">
        <SettingsRow
          icon={<BrandIcon brand="github" size={18} decorative />}
          title="GitHub cloud agent"
          purpose="Lets Mushi hand a fix to GitHub's cloud coding agent. GitHub only accepts a personal token here, not the app connection used for your code."
          status={
            githubConfigured
              ? { state: 'checking', detail: 'Saved. It is checked the first time a fix goes to GitHub.' }
              : { state: 'not_connected', detail: 'Paste a fine-grained token with Agent tasks, Contents and Pull requests access.' }
          }
        >
          <SecretInput
            label={githubConfigured ? 'Replace the GitHub token' : 'GitHub token'}
            value={githubTokenDraft}
            onChange={(e) => setGithubTokenDraft(e.target.value)}
            placeholder={
              githubConfigured
                ? `Saved (${secretHint(saved.github_user_token_ref) ?? 'in Vault'}). Paste a new token to replace it.`
                : 'github_pat_…'
            }
          />
        </SettingsRow>
      </SettingsList>

      <SettingsList title="Notifications" description="Get told on this device when a voice request needs you.">
        <SettingsRow
          icon={<IconBell size={16} />}
          title="Push to this device"
          purpose="A notification when a transcript is ready to confirm or a fix finishes."
        >
          <PushNotifyCard compact />
        </SettingsRow>
      </SettingsList>

      <SettingsFormFooter
        dirty={dirty}
        saving={saving}
        changeCount={changeCount}
        onSave={() => void save()}
        onDiscard={resetDraft}
      />

      {removeChat && (
        <ConfirmDialog
          title="Unlink this Telegram chat?"
          body="This chat can no longer send voice notes to this project. You can link it again with a new code."
          confirmLabel="Unlink"
          tone="danger"
          loading={tgBusy === 'remove'}
          onConfirm={() => void removeBinding(removeChat)}
          onCancel={() => setRemoveChat(null)}
        />
      )}
    </>
  )
}
