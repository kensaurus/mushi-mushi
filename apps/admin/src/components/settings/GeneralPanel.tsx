/**
 * FILE: apps/admin/src/components/settings/GeneralPanel.tsx
 * PURPOSE: General project knobs — Slack notifications, Sentry forwarding,
 *          LLM pipeline model + thresholds, and dedup similarity.
 *          Loads + persists `/v1/admin/settings` with optimistic save toasts.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Section, Input, SelectField, Btn, Loading, ErrorAlert, Checkbox } from '../ui'

interface ProjectSettings {
  slack_webhook_url?: string
  sentry_dsn?: string
  sentry_webhook_secret?: string
  sentry_consume_user_feedback?: boolean
  stage2_model?: string
  stage1_confidence_threshold?: number
  dedup_threshold?: number
  embedding_model?: string
}

export function GeneralPanel() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<ProjectSettings>('/v1/admin/settings')
  const [draft, setDraft] = useState<ProjectSettings | null>(null)
  const [saving, setSaving] = useState(false)

  const settings: ProjectSettings = draft ?? data ?? {}

  const update = (patch: Partial<ProjectSettings>) =>
    setDraft({ ...settings, ...patch })

  async function save() {
    setSaving(true)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    })
    setSaving(false)
    if (res.ok) {
      toast.success('Settings saved')
      setDraft(null)
      reload()
    } else {
      toast.error('Failed to save settings', res.error?.message)
    }
  }

  if (loading) return <Loading text="Loading settings…" />
  if (error) return <ErrorAlert message={`Failed to load settings: ${error}`} onRetry={reload} />

  return (
    <div className="space-y-4 max-w-2xl">
      <Section title="Notifications" className="space-y-3">
        <Input
          label="Slack Webhook URL"
          type="url"
          value={settings.slack_webhook_url ?? ''}
          onChange={(e) => update({ slack_webhook_url: e.target.value })}
          placeholder="https://hooks.slack.com/services/..."
        />
      </Section>

      <Section title="Sentry Integration" className="space-y-3">
        <Input
          label="Sentry DSN"
          type="text"
          value={settings.sentry_dsn ?? ''}
          onChange={(e) => update({ sentry_dsn: e.target.value })}
        />
        <Input
          label="Webhook Secret"
          type="password"
          value={settings.sentry_webhook_secret ?? ''}
          onChange={(e) => update({ sentry_webhook_secret: e.target.value })}
        />
        <Checkbox
          label="Consume Sentry User Feedback as Mushi reports"
          checked={settings.sentry_consume_user_feedback ?? true}
          onChange={(v) => update({ sentry_consume_user_feedback: v })}
        />
      </Section>

      <Section title="LLM Pipeline" className="space-y-3">
        <SelectField
          label="Stage 2 Model"
          value={settings.stage2_model ?? 'claude-sonnet-4-6'}
          onChange={(e) => update({ stage2_model: e.target.value })}
        >
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="claude-opus-4-6">Claude Opus 4.6</option>
          <option value="gpt-4.1">GPT-4.1</option>
        </SelectField>
        <Slider
          label="Stage 1 Confidence Threshold"
          value={settings.stage1_confidence_threshold ?? 0.85}
          onChange={(v) => update({ stage1_confidence_threshold: v })}
        />
      </Section>

      <Section title="Deduplication" className="space-y-3">
        <Slider
          label="Similarity Threshold"
          value={settings.dedup_threshold ?? 0.82}
          onChange={(v) => update({ dedup_threshold: v })}
        />
      </Section>

      <div className="flex items-center gap-3">
        <Btn onClick={save} disabled={saving || !draft}>
          {saving ? 'Saving…' : draft ? 'Save changes' : 'No changes'}
        </Btn>
        {draft && (
          <Btn variant="ghost" onClick={() => setDraft(null)}>Discard</Btn>
        )}
      </div>
    </div>
  )
}

interface SliderProps {
  label: string
  value: number
  onChange: (v: number) => void
}

function Slider({ label, value, onChange }: SliderProps) {
  return (
    <label className="block">
      <span className="text-xs text-fg-muted mb-1 block">
        {label}: <span className="font-mono text-fg-secondary">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min="0.5"
        max="0.99"
        step="0.01"
        className="w-full accent-brand"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}
