import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Section, Input, SelectField, Btn, Loading, Checkbox, ErrorAlert, Card, Toggle } from '../components/ui'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { isDebugEnabled, setDebugEnabled } from '../lib/debug'
import { RESOLVED_API_URL } from '../lib/env'

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

      <ByokSection />

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
              {RESOLVED_API_URL}
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

interface ByokKey {
  provider: 'anthropic' | 'openai'
  configured: boolean
  addedAt: string | null
  lastUsedAt: string | null
}

const BYOK_PROVIDER_LABELS: Record<ByokKey['provider'], { name: string; placeholder: string; help: string }> = {
  anthropic: {
    name: 'Anthropic',
    placeholder: 'sk-ant-…',
    help: 'Used for Stage 1 fast-filter, Stage 2 classifier, vision inspector, and judge primary.',
  },
  openai: {
    name: 'OpenAI',
    placeholder: 'sk-…',
    help: 'Used as the automatic fallback when Anthropic returns an error and for the judge fallback.',
  },
}

function ByokSection() {
  const [keys, setKeys] = useState<ByokKey[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<ByokKey['provider'] | null>(null)
  const [drafts, setDrafts] = useState<Record<ByokKey['provider'], string>>({ anthropic: '', openai: '' })
  const [feedback, setFeedback] = useState<{ provider: ByokKey['provider']; ok: boolean; message: string } | null>(null)

  function load() {
    setLoading(true)
    setError(false)
    apiFetch<{ keys: ByokKey[] }>('/v1/admin/byok')
      .then((res) => {
        if (res.ok && res.data) setKeys(res.data.keys)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function save(provider: ByokKey['provider']) {
    const key = drafts[provider].trim()
    if (key.length < 8) {
      setFeedback({ provider, ok: false, message: 'Paste the full provider API key.' })
      return
    }
    setPending(provider)
    setFeedback(null)
    const res = await apiFetch<{ provider: ByokKey['provider']; addedAt: string; hint: string }>(
      `/v1/admin/byok/${provider}`,
      { method: 'PUT', body: JSON.stringify({ key }) },
    )
    setPending(null)
    if (res.ok && res.data) {
      setDrafts((d) => ({ ...d, [provider]: '' }))
      setFeedback({ provider, ok: true, message: `Saved (${res.data.hint}).` })
      load()
    } else {
      setFeedback({ provider, ok: false, message: res.error?.message ?? 'Failed to save key.' })
    }
  }

  async function clearKey(provider: ByokKey['provider']) {
    if (!confirm(`Remove the ${BYOK_PROVIDER_LABELS[provider].name} BYOK key? The pipeline will fall back to the platform default.`)) return
    setPending(provider)
    setFeedback(null)
    const res = await apiFetch(`/v1/admin/byok/${provider}`, { method: 'DELETE' })
    setPending(null)
    if (res.ok) {
      setFeedback({ provider, ok: true, message: 'Key cleared.' })
      load()
    } else {
      setFeedback({ provider, ok: false, message: res.error?.message ?? 'Failed to clear key.' })
    }
  }

  return (
    <Section title="LLM Keys (BYOK)" className="space-y-3">
      <p className="text-2xs text-fg-faint">
        Bring your own Anthropic and OpenAI keys so token usage is billed to your account, not Mushi's.
        Keys are stored in Supabase Vault — only a reference lives in <code className="font-mono">project_settings</code>.
        When unset, the platform default keys are used.
      </p>

      {loading && <Loading text="Loading BYOK status..." />}
      {error && <ErrorAlert message="Failed to load BYOK status." onRetry={load} />}

      {keys?.map((k) => {
        const meta = BYOK_PROVIDER_LABELS[k.provider]
        const fb = feedback?.provider === k.provider ? feedback : null
        return (
          <div key={k.provider} className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-fg-primary">{meta.name}</div>
                <div className="text-2xs text-fg-faint">{meta.help}</div>
              </div>
              <span className={`text-2xs font-mono px-2 py-0.5 rounded-sm ${k.configured ? 'bg-ok/10 text-ok' : 'bg-surface-raised text-fg-muted'}`}>
                {k.configured ? 'BYOK active' : 'platform default'}
              </span>
            </div>
            {k.configured && (
              <div className="text-2xs text-fg-muted">
                Added {k.addedAt ? new Date(k.addedAt).toLocaleString() : 'unknown'}
                {k.lastUsedAt && <> · last used {new Date(k.lastUsedAt).toLocaleString()}</>}
              </div>
            )}
            <Input
              type="password"
              value={drafts[k.provider]}
              onChange={(e) => setDrafts((d) => ({ ...d, [k.provider]: e.target.value }))}
              placeholder={meta.placeholder}
              autoComplete="new-password"
            />
            <div className="flex items-center gap-2">
              <Btn size="sm" onClick={() => save(k.provider)} disabled={pending === k.provider}>
                {pending === k.provider ? 'Saving…' : k.configured ? 'Rotate key' : 'Save key'}
              </Btn>
              {k.configured && (
                <Btn size="sm" variant="ghost" onClick={() => clearKey(k.provider)} disabled={pending === k.provider}>
                  Clear
                </Btn>
              )}
              {fb && (
                <span className={`text-2xs ${fb.ok ? 'text-ok' : 'text-danger'}`}>{fb.message}</span>
              )}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

interface TestProject {
  id: string
  name: string
}

function QuickTestSection() {
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [detail, setDetail] = useState('')
  const [project, setProject] = useState<TestProject | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)

  // The pipeline test runs against the user's first project. We don't render a
  // picker because the test is a smoke check — owners with multiple projects
  // can rerun against a specific one from that project's settings later.
  useEffect(() => {
    apiFetch<{ projects: TestProject[] }>('/v1/admin/projects')
      .then((res) => {
        if (res.ok && res.data) setProject(res.data.projects?.[0] ?? null)
      })
      .finally(() => setProjectLoading(false))
  }, [])

  async function runTest() {
    if (!project) return
    setStatus('running')
    setDetail('')
    // Uses the JWT-authenticated admin endpoint instead of /v1/reports — that
    // one requires X-Mushi-Api-Key, which the admin has no plaintext access to
    // (keys are SHA-256 hashed at rest).
    const res = await apiFetch<{ reportId: string; projectName: string }>(
      `/v1/admin/projects/${project.id}/test-report`,
      { method: 'POST' },
    )
    if (res.ok && res.data) {
      setStatus('pass')
      setDetail(`Report ${res.data.reportId} submitted to ${res.data.projectName}`)
    } else {
      setStatus('fail')
      setDetail(res.error?.message ?? 'Submission failed')
    }
  }

  return (
    <Section title="Pipeline Quick Test">
      <p className="text-2xs text-fg-faint mb-2">
        Submit a test report to verify the ingest pipeline works end-to-end.
        {project && <> Tests the project <span className="font-mono text-fg-secondary">{project.name}</span>.</>}
      </p>
      <div className="flex items-center gap-3">
        <Btn
          size="sm"
          variant={status === 'pass' ? 'ghost' : 'primary'}
          onClick={runTest}
          disabled={status === 'running' || projectLoading || !project}
        >
          {status === 'running' ? 'Sending…' : status === 'pass' ? '✓ Passed' : 'Send test report'}
        </Btn>
        {!projectLoading && !project && (
          <span className="text-2xs text-fg-muted">Create a project first to run this test.</span>
        )}
        {detail && (
          <span className={`text-2xs ${status === 'pass' ? 'text-ok' : 'text-danger'}`}>{detail}</span>
        )}
      </div>
    </Section>
  )
}
