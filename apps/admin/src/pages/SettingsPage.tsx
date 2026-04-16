import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, Section, Input, SelectField, Btn, Loading, Checkbox, ErrorAlert } from '../components/ui'

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

export function SettingsPage() {
  const [settings, setSettings] = useState<ProjectSettings>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  function loadSettings() {
    setLoading(true)
    setError(false)
    apiFetch<ProjectSettings>('/v1/admin/settings')
      .then((res) => {
        if (res.ok && res.data) setSettings(res.data)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadSettings() }, [])

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setMessage(res.ok ? 'Settings saved' : `Error: ${res.error?.message}`)
  }

  if (loading) return <Loading text="Loading settings..." />
  if (error) return <ErrorAlert message="Failed to load settings." onRetry={loadSettings} />

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Project Settings" />

      <Section title="Notifications" className="space-y-3">
        <Input
          label="Slack Webhook URL"
          type="url"
          value={settings.slack_webhook_url ?? ''}
          onChange={(e) => setSettings({ ...settings, slack_webhook_url: e.target.value })}
          placeholder="https://hooks.slack.com/services/..."
        />
      </Section>

      <Section title="Sentry Integration" className="space-y-3">
        <Input
          label="Sentry DSN"
          type="text"
          value={settings.sentry_dsn ?? ''}
          onChange={(e) => setSettings({ ...settings, sentry_dsn: e.target.value })}
        />
        <Input
          label="Webhook Secret"
          type="password"
          value={settings.sentry_webhook_secret ?? ''}
          onChange={(e) => setSettings({ ...settings, sentry_webhook_secret: e.target.value })}
        />
        <Checkbox
          label="Consume Sentry User Feedback as Mushi reports"
          checked={settings.sentry_consume_user_feedback ?? true}
          onChange={(v) => setSettings({ ...settings, sentry_consume_user_feedback: v })}
        />
      </Section>

      <Section title="LLM Pipeline" className="space-y-3">
        <SelectField
          label="Stage 2 Model"
          value={settings.stage2_model ?? 'claude-sonnet-4-20250514'}
          onChange={(e) => setSettings({ ...settings, stage2_model: e.target.value })}
        >
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
          <option value="gpt-4.1">GPT-4.1</option>
        </SelectField>
        <label className="block">
          <span className="text-xs text-fg-muted mb-1 block">
            Stage 1 Confidence Threshold: <span className="font-mono text-fg-secondary">{settings.stage1_confidence_threshold ?? 0.85}</span>
          </span>
          <input
            type="range" min="0.5" max="0.99" step="0.01"
            className="w-full accent-brand"
            value={settings.stage1_confidence_threshold ?? 0.85}
            onChange={(e) => setSettings({ ...settings, stage1_confidence_threshold: parseFloat(e.target.value) })}
          />
        </label>
      </Section>

      <Section title="Deduplication" className="space-y-3">
        <label className="block">
          <span className="text-xs text-fg-muted mb-1 block">
            Similarity Threshold: <span className="font-mono text-fg-secondary">{settings.dedup_threshold ?? 0.82}</span>
          </span>
          <input
            type="range" min="0.5" max="0.99" step="0.01"
            className="w-full accent-brand"
            value={settings.dedup_threshold ?? 0.82}
            onChange={(e) => setSettings({ ...settings, dedup_threshold: parseFloat(e.target.value) })}
          />
        </label>
      </Section>

      <div className="flex items-center gap-3">
        <Btn onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Btn>
        {message && <span className="text-xs text-fg-muted">{message}</span>}
      </div>
    </div>
  )
}
