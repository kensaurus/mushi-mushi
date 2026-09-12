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
import { Link } from 'react-router-dom'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Badge, Btn, Checkbox, CopyButton, ErrorAlert, Input, ResultChip, Section, Toggle } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfirmDialog } from '../ConfirmDialog'
import { SettingEffectCallout } from '../FeatureExplainPanel'
import { InlineProof, SignalChip } from '../report-detail/ReportSurface'
import { ConfiguredSecretField } from './ConfiguredSecretField'
import { SettingsChangeHint } from './SettingsChangeHint'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsCard, SettingsPanelLayout } from './SettingsPanelLayout'
import { countChangedFields } from './settingsDiff'
import { PushNotifyCard } from '../voice/PushNotifyCard'

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

/** GET returns either a masked hint or the vault ref; only hints are displayable. */
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
      toast.error('Failed to save voice settings', res.error?.message)
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
      note('success', 'Code minted — send it to the bot within 10 minutes.')
    } else {
      note('error', res.error?.message ?? 'Could not mint a bind code')
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
      note('error', res.error?.message ?? 'Could not register the webhook')
    }
  }

  async function removeBinding(chatId: string) {
    setTgBusy('remove')
    const res = await apiFetch(`/v1/admin/telegram/bindings/${encodeURIComponent(chatId)}`, { method: 'DELETE' })
    setTgBusy(null)
    setRemoveChat(null)
    if (res.ok) {
      note('info', `Chat ${chatId} unbound.`)
      telegram.reload()
    } else {
      note('error', res.error?.message ?? 'Could not remove the binding')
    }
  }

  if (loading) return <PanelSkeleton rows={4} label="Loading voice settings" inCard={false} />
  if (error) return <ErrorAlert message={`Failed to load settings: ${error}`} onRetry={reload} />

  const telegramConfigured = Boolean(saved.telegram_bot_token_ref) || telegram.data?.configured === true
  const githubConfigured = Boolean(saved.github_user_token_ref)
  const bindings = telegram.data?.bindings ?? []

  return (
    <>
      <SettingsPanelLayout
        fullWidth={
          <SettingEffectCallout label="Overview">
            Voice is personal data: it stays off until you turn it on, clips are deleted right after transcription
            unless you set a retention window, and only the sanitised transcript — never the audio — reaches a coding agent.
            Every dispatch still needs your explicit Confirm on the transcript.
          </SettingEffectCallout>
        }
        footer={
          <SettingsFormFooter dirty={dirty} saving={saving} changeCount={changeCount} onSave={() => void save()} onDiscard={resetDraft} />
        }
      >
        <Section title="Voice intake" className="space-y-3">
          <SettingsCard>
            <div className="flex flex-wrap items-center gap-3">
              <Toggle label="Accept voice requests" checked={enabled} onChange={(v) => update({ voice_intake_enabled: v })} />
              <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? 'ON' : 'OFF'}</Badge>
            </div>
            <SettingsChangeHint current={enabled} saved={saved.voice_intake_enabled ?? false} kind="bool" />
            <p className="text-2xs text-fg-muted">
              Gates the Voice page, the Telegram and Slack inboxes, and <code className="font-mono">POST /v1/intake/voice</code>.
            </p>
          </SettingsCard>

          <SettingsCard>
            <Input
              label="Keep audio for (days)"
              type="number"
              min={0}
              max={365}
              step={1}
              value={String(retention)}
              onChange={(e) => update({ voice_audio_retention_days: Number.parseInt(e.target.value || '0', 10) || 0 })}
              tooltip="0 deletes the clip as soon as the transcript is stored. The transcript and its SHA-256 stay on the report either way."
            />
            <SettingsChangeHint current={retention} saved={saved.voice_audio_retention_days ?? DEFAULT_RETENTION_DAYS} kind="number" />
          </SettingsCard>

          <SettingsCard>
            <span className="text-2xs text-fg-muted">Transcription languages</span>
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
            <SettingsChangeHint current={[...languages].sort().join(', ')} saved={[...(saved.voice_languages ?? DEFAULT_LANGUAGES)].sort().join(', ')} />
            <p className="text-2xs text-fg-muted">Passed to the transcriber as hints — matches the widget locales (en, ja, es, th). At least one is used.</p>
          </SettingsCard>

          <SettingsCard>
            <span className="text-2xs text-fg-muted">iPhone Shortcut / any phone</span>
            <p className="text-2xs text-fg-secondary">
              A Shortcut dictates on-device and POSTs the text with a narrow <code className="font-mono">voice:write</code> key — it cannot call any other admin route.
            </p>
            <Link to="/projects?keyScope=voice" className="inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-2 hover:underline">
              Mint a voice:write key on Projects →
            </Link>
          </SettingsCard>
        </Section>

        <Section title="Telegram bot (Android voice notes)" className="space-y-3">
          <SettingsCard>
            <div className="flex flex-wrap items-center gap-2">
              <SignalChip tone={telegramConfigured ? 'ok' : 'neutral'}>{telegramConfigured ? 'token in vault' : 'no bot yet'}</SignalChip>
              <SignalChip tone={telegram.data?.webhook_url ? 'ok' : 'neutral'}>{telegram.data?.webhook_url ? 'webhook set' : 'webhook not set'}</SignalChip>
              <SignalChip tone={bindings.length > 0 ? 'ok' : 'neutral'}>
                {bindings.length} bound chat{bindings.length === 1 ? '' : 's'}
              </SignalChip>
            </div>
            <ConfiguredSecretField
              label="Bot token (from @BotFather)"
              configured={telegramConfigured}
              keyHint={secretHint(saved.telegram_bot_token_ref)}
              fallbackPrefix="12345:"
              value={telegramTokenDraft}
              onChange={setTelegramTokenDraft}
              placeholder="123456789:AA…"
            />
            {telegramTokenDraft.trim() && telegramConfigured && (
              <SettingsChangeHint current={telegramTokenDraft} saved={secretHint(saved.telegram_bot_token_ref) ?? '(configured)'} kind="secret" prefix="Replacing" />
            )}
            <p className="text-2xs text-fg-muted">Save the token first, then bind a chat and connect the webhook. The webhook secret is hashed server-side; rotate by connecting again.</p>
          </SettingsCard>

          <SettingsCard>
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="ghost" size="sm" onClick={() => void generateBindCode()} loading={tgBusy === 'code'} disabled={!telegramConfigured || tgBusy !== null} title={telegramConfigured ? 'Mint a one-time /start code' : 'Save a bot token first'}>
                Generate bind code
              </Btn>
              <Btn variant="accent" size="sm" onClick={() => void connectWebhook()} loading={tgBusy === 'webhook'} disabled={!telegramConfigured || tgBusy !== null} title={telegramConfigured ? 'Register this project’s webhook with Telegram' : 'Save a bot token first'}>
                Connect webhook
              </Btn>
            </div>
            {bindCode && (
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-sm border border-edge bg-surface-raised px-2 py-1 font-mono text-sm tracking-widest text-fg">{bindCode.code}</code>
                <CopyButton value={bindCode.code} label="Copy code" />
                <InlineProof>
                  send <span className="font-mono">/start {bindCode.code}</span> to the bot · expires {new Date(bindCode.expires_at).toLocaleTimeString()}
                </InlineProof>
              </div>
            )}
            {tgResult && (
              <ResultChip tone={tgResult.tone} at={tgResult.at}>
                {tgResult.text}
              </ResultChip>
            )}
            {bindings.length > 0 && (
              <ul className="divide-y divide-edge-subtle">
                {bindings.map((b) => (
                  <li key={b.chat_id} className="flex flex-wrap items-center gap-2 py-1.5 text-2xs">
                    <span className="font-mono text-fg-secondary">chat {b.chat_id}</span>
                    {b.bound_at && <span className="text-fg-faint">since {new Date(b.bound_at).toLocaleDateString()}</span>}
                    <Btn variant="cancel" size="sm" className="ml-auto" onClick={() => setRemoveChat(b.chat_id)} disabled={tgBusy !== null} title="Stop accepting voice notes from this chat">
                      Remove
                    </Btn>
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>
        </Section>

        <Section title="GitHub cloud agent" className="space-y-3">
          <SettingsCard>
            <ConfiguredSecretField
              label="GitHub user token (for GitHub cloud agent tasks)"
              configured={githubConfigured}
              keyHint={secretHint(saved.github_user_token_ref)}
              fallbackPrefix="github_pat_"
              value={githubTokenDraft}
              onChange={setGithubTokenDraft}
              placeholder="github_pat_… (fine-grained: Agent tasks read+write, Contents, Pull requests)"
            />
            {githubTokenDraft.trim() && githubConfigured && (
              <SettingsChangeHint current={githubTokenDraft} saved={secretHint(saved.github_user_token_ref) ?? '(configured)'} kind="secret" prefix="Replacing" />
            )}
            <p className="text-2xs text-fg-muted">
              GitHub&apos;s agent-tasks API only accepts user-to-server tokens; the installation token used for indexing is not enough. Stored in the vault, only used when the GitHub backend is chosen for a fix.
            </p>
          </SettingsCard>
        </Section>

        <Section title="Push to this device" className="space-y-3">
          <SettingsCard>
            <PushNotifyCard compact />
          </SettingsCard>
        </Section>
      </SettingsPanelLayout>

      {removeChat && (
        <ConfirmDialog
          title="Unbind this Telegram chat?"
          body={`Chat ${removeChat} will no longer be able to send voice notes to this project. It can be re-bound with a new code.`}
          confirmLabel="Remove"
          tone="danger"
          loading={tgBusy === 'remove'}
          onConfirm={() => void removeBinding(removeChat)}
          onCancel={() => setRemoveChat(null)}
        />
      )}
    </>
  )
}
