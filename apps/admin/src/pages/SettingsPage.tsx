import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Section, Input, SelectField, Btn, Loading, Checkbox, ErrorAlert, Card, Toggle } from '../components/ui'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { isDebugEnabled, setDebugEnabled } from '../lib/debug'

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

      <PageHelp
        title="About Settings"
        whatIsIt="Tunable knobs for the bug pipeline: which model classifies reports, how strict the dedup threshold is, where to send notifications, and which Sentry feedback to ingest."
        useCases={[
          'Swap in a fine-tuned model once Fine-Tuning produces one',
          'Tighten the confidence threshold to reduce false positives, or loosen it to catch more',
          'Pipe alerts into Slack and Sentry for unified incident response',
        ]}
        howToUse="Save persists changes immediately and writes an audit-log entry. Use Connection Status below to verify your config before relying on it in production."
      />

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
          value={settings.stage2_model ?? 'claude-sonnet-4-6'}
          onChange={(e) => setSettings({ ...settings, stage2_model: e.target.value })}
        >
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="claude-opus-4-6">Claude Opus 4.6</option>
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

      {/* Connection Health */}
      <Card className="p-4">
        <ConnectionStatus />
      </Card>

      {/* SDK Endpoint Reference */}
      <Section title="SDK Configuration Reference">
        <p className="text-2xs text-fg-faint mb-2">Use these values when configuring the Mushi SDK in your app:</p>
        <div className="space-y-1.5">
          <div>
            <span className="text-2xs text-fg-faint">API Endpoint</span>
            <code className="block text-xs font-mono text-fg-secondary bg-surface-raised px-2 py-1 rounded-sm mt-0.5 select-all">
              {import.meta.env.VITE_API_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`}
            </code>
          </div>
        </div>
      </Section>

      {/* Quick Test */}
      <QuickTestSection />

      {/* Debug mode */}
      <Section title="Developer Tools">
        <Toggle
          label="Debug mode — log all API calls, auth events, and timings to browser console"
          checked={isDebugEnabled()}
          onChange={(v) => { setDebugEnabled(v); window.location.reload() }}
        />
      </Section>
    </div>
  )
}

function QuickTestSection() {
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [detail, setDetail] = useState('')

  async function runTest() {
    setStatus('running')
    setDetail('')
    const res = await apiFetch<{ reportId: string }>('/v1/reports', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'settings-test',
        description: 'Settings page quick test — verifying pipeline',
        category: 'other',
        environment: { url: 'admin://settings-test', browser: 'mushi-admin', userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, viewport: { width: window.innerWidth, height: window.innerHeight }, referrer: '', timestamp: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        reporterToken: 'settings-test',
      }),
    })
    if (res.ok) {
      setStatus('pass')
      setDetail(res.data?.reportId ? `Report ID: ${res.data.reportId}` : 'Report submitted')
    } else {
      setStatus('fail')
      setDetail(res.error?.message ?? 'Submission failed')
    }
  }

  return (
    <Section title="Pipeline Quick Test">
      <p className="text-2xs text-fg-faint mb-2">Submit a test report to verify the ingest pipeline works end-to-end.</p>
      <div className="flex items-center gap-3">
        <Btn size="sm" variant={status === 'pass' ? 'ghost' : 'primary'} onClick={runTest} disabled={status === 'running'}>
          {status === 'running' ? 'Sending…' : status === 'pass' ? '✓ Passed' : 'Send test report'}
        </Btn>
        {detail && (
          <span className={`text-2xs ${status === 'pass' ? 'text-ok' : 'text-danger'}`}>{detail}</span>
        )}
      </div>
    </Section>
  )
}
