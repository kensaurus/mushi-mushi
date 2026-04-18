import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Section, Input, SelectField, Btn, Loading, Checkbox, ErrorAlert, Card, Toggle } from '../components/ui'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { isDebugEnabled, setDebugEnabled } from '../lib/debug'
import { RESOLVED_API_URL } from '../lib/env'
import { useToast } from '../lib/toast'

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
  const toast = useToast()
  const [settings, setSettings] = useState<ProjectSettings>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)

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
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    })
    setSaving(false)
    if (res.ok) toast.success('Settings saved')
    else toast.error('Failed to save settings', res.error?.message)
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

      <FirecrawlSection />

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
      </div>

      {/* Connection Health */}
      <Card className="p-4">
        <ConnectionStatus />
      </Card>

      {/* SDK Endpoint Reference */}
      <Section title="SDK Configuration Reference">
        <p className="text-2xs text-fg-muted mb-2">Use these values when configuring the Mushi SDK in your app:</p>
        <div className="space-y-1.5">
          <div>
            <span className="text-xs text-fg-muted font-medium">API Endpoint</span>
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
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null
  testedAt: string | null
  baseUrl: string | null
}

interface ByokProviderMeta {
  name: string
  placeholder: string
  help: string
  /** Where to mint the key. Surfaced as a hint link so users don't have to hunt. */
  consoleUrl: string
  /** Plain-language guide for non-engineers. */
  setupSteps: string[]
}

const BYOK_PROVIDER_LABELS: Record<ByokKey['provider'], ByokProviderMeta> = {
  anthropic: {
    name: 'Anthropic (Claude)',
    placeholder: 'sk-ant-api03-…',
    help: 'Powers Stage-1 fast-filter (Haiku 4.5), Stage-2 classifier (Sonnet 4.6), vision analysis, and the LLM fix agent. Required for the autofix pipeline.',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    setupSteps: [
      'Sign in to console.anthropic.com → Settings → API Keys.',
      'Click Create Key, name it "mushi-mushi", grant write access to Models.',
      'Copy the sk-ant-api03-… string and paste it below. We never see it again — it goes straight into Supabase Vault.',
    ],
  },
  openai: {
    name: 'OpenAI / OpenRouter (compatible)',
    placeholder: 'sk-… or sk-or-v1-… (OpenRouter)',
    help: 'Used as the automatic fallback when Anthropic 5xxs, and as the judge fallback. Set the base URL below to route this same key through OpenRouter, Together, Fireworks, or any other OpenAI-compatible gateway.',
    consoleUrl: 'https://platform.openai.com/api-keys',
    setupSteps: [
      'For OpenAI: platform.openai.com → API keys → Create new secret key. Leave Base URL empty.',
      'For OpenRouter: openrouter.ai/keys → Create Key. Set Base URL to https://openrouter.ai/api/v1 below.',
      'Click Save, then Test connection — we hit /v1/models with a one-off probe to confirm auth and reachability.',
    ],
  },
}

const TEST_STATUS_LABEL: Record<NonNullable<ByokKey['testStatus']>, { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  ok: { label: 'Connection OK', tone: 'ok' },
  error_auth: { label: 'Auth failed', tone: 'danger' },
  error_network: { label: 'Network/endpoint error', tone: 'danger' },
  error_quota: { label: 'Quota / rate limit', tone: 'warn' },
}

interface BaseUrlPreset {
  label: string
  url: string
  note: string
}

const OPENAI_BASE_URL_PRESETS: BaseUrlPreset[] = [
  { label: 'OpenAI (default)', url: '', note: 'Leave empty for api.openai.com' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', note: '300+ models via one key' },
  { label: 'Together', url: 'https://api.together.xyz/v1', note: 'Open-weights models' },
  { label: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1', note: 'Fast Llama / Mixtral' },
]

interface TestResult {
  status: NonNullable<ByokKey['testStatus']>
  hint: string
  source: 'byok' | 'env'
  baseUrl: string | null
  httpStatus: number
  latencyMs: number
  detail: string
}

function ByokSection() {
  const [keys, setKeys] = useState<ByokKey[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<ByokKey['provider'] | null>(null)
  const [testing, setTesting] = useState<ByokKey['provider'] | null>(null)
  const [drafts, setDrafts] = useState<Record<ByokKey['provider'], string>>({ anthropic: '', openai: '' })
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [feedback, setFeedback] = useState<{ provider: ByokKey['provider']; ok: boolean; message: string } | null>(null)
  const [testResults, setTestResults] = useState<Partial<Record<ByokKey['provider'], TestResult>>>({})

  function load() {
    setLoading(true)
    setError(false)
    apiFetch<{ keys: ByokKey[] }>('/v1/admin/byok')
      .then((res) => {
        if (res.ok && res.data) {
          setKeys(res.data.keys)
          // Sync the base-URL draft once on load so users see what's persisted.
          const openai = res.data.keys.find(k => k.provider === 'openai')
          if (openai?.baseUrl != null) setBaseUrlDraft(openai.baseUrl)
        } else setError(true)
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
    const payload: Record<string, string | null> = { key }
    if (provider === 'openai') {
      payload.baseUrl = baseUrlDraft.trim() || null
    }
    const res = await apiFetch<{ provider: ByokKey['provider']; addedAt: string; hint: string }>(
      `/v1/admin/byok/${provider}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    )
    setPending(null)
    if (res.ok && res.data) {
      setDrafts((d) => ({ ...d, [provider]: '' }))
      setFeedback({ provider, ok: true, message: `Saved (${res.data.hint}). Click Test connection to verify.` })
      // Wipe stale local test result so the user runs a fresh probe.
      setTestResults((r) => ({ ...r, [provider]: undefined }))
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
      if (provider === 'openai') setBaseUrlDraft('')
      setTestResults((r) => ({ ...r, [provider]: undefined }))
      load()
    } else {
      setFeedback({ provider, ok: false, message: res.error?.message ?? 'Failed to clear key.' })
    }
  }

  async function testKey(provider: ByokKey['provider']) {
    setTesting(provider)
    setFeedback(null)
    const res = await apiFetch<TestResult>(
      `/v1/admin/byok/${provider}/test`,
      { method: 'POST' },
    )
    setTesting(null)
    if (res.ok && res.data) {
      setTestResults((r) => ({ ...r, [provider]: res.data }))
      load()
    } else {
      setFeedback({ provider, ok: false, message: res.error?.message ?? 'Test failed.' })
    }
  }

  return (
    <Section title="LLM Keys (BYOK)" className="space-y-3">
      <div className="text-2xs text-fg-muted space-y-1">
        <p>
          <strong className="text-fg-secondary">Mushi Mushi is BYOK-first.</strong> You bring the LLM keys, you pay your own provider, you keep full control over which models touch your bug data. Mushi never proxies, caches, or fine-tunes on your traffic.
        </p>
        <p>
          Keys are stored in <span className="font-mono">Supabase Vault</span> — only a <span className="font-mono">vault://&lt;id&gt;</span> reference lives in <span className="font-mono">project_settings</span>. When a key is unset, the pipeline transparently falls back to the platform default (if your plan includes one).
        </p>
      </div>

      {loading && <Loading text="Loading BYOK status..." />}
      {error && <ErrorAlert message="Failed to load BYOK status." onRetry={load} />}

      {keys?.map((k) => {
        const meta = BYOK_PROVIDER_LABELS[k.provider]
        const fb = feedback?.provider === k.provider ? feedback : null
        const testResult = testResults[k.provider]
        const testStatus = testResult?.status ?? k.testStatus
        const testedAt = testResult ? new Date().toISOString() : k.testedAt
        const statusMeta = testStatus ? TEST_STATUS_LABEL[testStatus] : null

        return (
          <div key={k.provider} className="border border-edge rounded-md p-3 space-y-2.5 bg-surface-raised/40">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-fg-primary">{meta.name}</span>
                  <span className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${k.configured ? 'bg-ok/10 text-ok' : 'bg-surface-raised text-fg-muted'}`}>
                    {k.configured ? 'BYOK' : 'platform default'}
                  </span>
                  {statusMeta && (
                    <span
                      className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${
                        statusMeta.tone === 'ok' ? 'bg-ok/10 text-ok' :
                        statusMeta.tone === 'warn' ? 'bg-warn/10 text-warn' :
                        'bg-danger/10 text-danger'
                      }`}
                    >
                      {statusMeta.label}
                    </span>
                  )}
                </div>
                <p className="text-2xs text-fg-muted mt-0.5">{meta.help}</p>
              </div>
              <a
                href={meta.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-2xs text-accent hover:text-accent-hover underline-offset-2 hover:underline whitespace-nowrap shrink-0"
              >
                Get key →
              </a>
            </div>

            <details className="text-2xs">
              <summary className="text-fg-muted cursor-pointer hover:text-fg-secondary">Step-by-step setup</summary>
              <ol className="mt-1.5 ml-4 list-decimal space-y-0.5 text-fg-muted">
                {meta.setupSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </details>

            {k.configured && (
              <div className="text-2xs text-fg-muted">
                Added {k.addedAt ? new Date(k.addedAt).toLocaleString() : 'unknown'}
                {k.lastUsedAt && <> · last used {new Date(k.lastUsedAt).toLocaleString()}</>}
                {testedAt && <> · tested {new Date(testedAt).toLocaleString()}</>}
                {testResult?.latencyMs != null && <> ({testResult.latencyMs} ms)</>}
              </div>
            )}

            {k.provider === 'openai' && (
              <div className="space-y-1.5">
                <label className="text-2xs text-fg-muted block">
                  Base URL <span className="text-fg-faint">(optional — leave empty for OpenAI)</span>
                </label>
                <Input
                  type="url"
                  value={baseUrlDraft}
                  onChange={(e) => setBaseUrlDraft(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                />
                <div className="flex flex-wrap gap-1.5">
                  {OPENAI_BASE_URL_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setBaseUrlDraft(p.url)}
                      className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm border ${
                        baseUrlDraft === p.url
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-edge bg-surface-raised text-fg-muted hover:text-fg-secondary'
                      }`}
                      title={p.note}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Input
              type="password"
              value={drafts[k.provider]}
              onChange={(e) => setDrafts((d) => ({ ...d, [k.provider]: e.target.value }))}
              placeholder={meta.placeholder}
              autoComplete="new-password"
            />

            <div className="flex items-center gap-2 flex-wrap">
              <Btn size="sm" onClick={() => save(k.provider)} disabled={pending === k.provider}>
                {pending === k.provider ? 'Saving…' : k.configured ? 'Rotate key' : 'Save key'}
              </Btn>
              {k.configured && (
                <>
                  <Btn size="sm" variant="ghost" onClick={() => testKey(k.provider)} disabled={testing === k.provider}>
                    {testing === k.provider ? 'Testing…' : 'Test connection'}
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => clearKey(k.provider)} disabled={pending === k.provider}>
                    Clear
                  </Btn>
                </>
              )}
              {fb && (
                <span className={`text-2xs ${fb.ok ? 'text-ok' : 'text-danger'}`}>{fb.message}</span>
              )}
            </div>

            {testResult && testResult.status !== 'ok' && (
              <div className="text-2xs text-danger bg-danger/5 border border-danger/20 rounded-sm px-2 py-1.5">
                <strong>Why this failed:</strong>{' '}
                {testResult.status === 'error_auth' && 'The provider rejected the key (HTTP 401/403). Double-check you copied the full key including the prefix.'}
                {testResult.status === 'error_network' && `Couldn't reach the endpoint. ${testResult.detail || 'Check the base URL and your network.'}`}
                {testResult.status === 'error_quota' && 'Your account hit a rate limit (HTTP 429). The key works — you just need to top up or wait.'}
              </div>
            )}
          </div>
        )
      })}
    </Section>
  )
}

interface FirecrawlConfig {
  configured: boolean
  addedAt: string | null
  lastUsedAt: string | null
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null
  testedAt: string | null
  allowedDomains: string[]
  maxPagesPerCall: number
}

function FirecrawlSection() {
  const [cfg, setCfg] = useState<FirecrawlConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const [testing, setTesting] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [domainsDraft, setDomainsDraft] = useState('')
  const [pagesDraft, setPagesDraft] = useState(5)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  function load() {
    setLoading(true)
    setError(false)
    apiFetch<FirecrawlConfig>('/v1/admin/byok/firecrawl')
      .then((res) => {
        if (res.ok && res.data) {
          setCfg(res.data)
          setDomainsDraft(res.data.allowedDomains.join('\n'))
          setPagesDraft(res.data.maxPagesPerCall)
        } else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function save() {
    setPending(true)
    setFeedback(null)
    const allowedDomains = domainsDraft.split('\n').map((s) => s.trim()).filter(Boolean)
    const payload: Record<string, unknown> = {
      allowedDomains,
      maxPagesPerCall: pagesDraft,
    }
    if (keyDraft.trim().length >= 8) payload.key = keyDraft.trim()
    const res = await apiFetch('/v1/admin/byok/firecrawl', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    setPending(false)
    if (res.ok) {
      setKeyDraft('')
      setFeedback({ ok: true, message: 'Saved. Click Test connection to verify.' })
      load()
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Failed to save.' })
    }
  }

  async function clearKey() {
    if (!confirm('Remove the Firecrawl API key? Research, fix-augmentation, and library-modernizer will be disabled until a new key is added.')) return
    setPending(true)
    setFeedback(null)
    const res = await apiFetch('/v1/admin/byok/firecrawl', { method: 'DELETE' })
    setPending(false)
    if (res.ok) {
      setKeyDraft('')
      setFeedback({ ok: true, message: 'Key cleared.' })
      load()
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Failed to clear key.' })
    }
  }

  async function testKey() {
    setTesting(true)
    setFeedback(null)
    const res = await apiFetch<{ status: string; latencyMs: number; detail: string }>(
      '/v1/admin/byok/firecrawl/test',
      { method: 'POST' },
    )
    setTesting(false)
    if (res.ok && res.data) {
      const okMsg = res.data.status === 'ok'
        ? `Connection OK (${res.data.latencyMs} ms)`
        : `Test failed: ${res.data.status} — ${res.data.detail}`
      setFeedback({ ok: res.data.status === 'ok', message: okMsg })
      load()
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Test failed.' })
    }
  }

  const statusMeta = cfg?.testStatus ? TEST_STATUS_LABEL[cfg.testStatus] : null

  return (
    <Section title="Firecrawl (BYOK — Web Research)" className="space-y-3">
      <div className="text-2xs text-fg-muted space-y-1">
        <p>
          <strong className="text-fg-secondary">Wave E: optional.</strong> Brings <span className="font-mono">firecrawl.dev</span> under your own key for three flows:
        </p>
        <ul className="ml-4 list-disc space-y-0.5">
          <li><strong>Research page</strong> — manually search the web from the admin during triage.</li>
          <li><strong>Auto-augment fix-worker</strong> — when local RAG is sparse or the judge flags a "stubborn" report, the fix agent pulls top-3 web snippets into the Sonnet prompt.</li>
          <li><strong>Library modernizer</strong> — weekly cron scrapes release-notes for outdated dependencies and files them as enhancement reports.</li>
        </ul>
        <p className="text-fg-faint">
          Get a key at <a href="https://www.firecrawl.dev/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">firecrawl.dev</a>. Stored in Supabase Vault. Calls are cached 24h, audit-logged, and bounded by the per-call page cap below.
        </p>
      </div>

      {loading && <Loading text="Loading Firecrawl status..." />}
      {error && <ErrorAlert message="Failed to load Firecrawl status." onRetry={load} />}

      {cfg && (
        <div className="border border-edge rounded-md p-3 space-y-2.5 bg-surface-raised/40">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-fg-primary">Firecrawl</span>
            <span className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${cfg.configured ? 'bg-ok/10 text-ok' : 'bg-surface-raised text-fg-muted'}`}>
              {cfg.configured ? 'BYOK' : 'not configured'}
            </span>
            {statusMeta && (
              <span
                className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${
                  statusMeta.tone === 'ok' ? 'bg-ok/10 text-ok' :
                  statusMeta.tone === 'warn' ? 'bg-warn/10 text-warn' :
                  'bg-danger/10 text-danger'
                }`}
              >
                {statusMeta.label}
              </span>
            )}
          </div>

          {cfg.configured && (
            <div className="text-2xs text-fg-muted">
              Added {cfg.addedAt ? new Date(cfg.addedAt).toLocaleString() : 'unknown'}
              {cfg.lastUsedAt && <> · last used {new Date(cfg.lastUsedAt).toLocaleString()}</>}
              {cfg.testedAt && <> · tested {new Date(cfg.testedAt).toLocaleString()}</>}
            </div>
          )}

          <Input
            label="Firecrawl API key"
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="fc-…"
            autoComplete="new-password"
          />

          <label className="block">
            <span className="text-2xs text-fg-muted mb-1 block">
              Allowed domains <span className="text-fg-faint">(one per line — empty = unrestricted)</span>
            </span>
            <textarea
              className="w-full text-2xs font-mono px-2 py-1.5 rounded-sm bg-surface-raised border border-edge focus:border-accent outline-none min-h-[64px]"
              value={domainsDraft}
              onChange={(e) => setDomainsDraft(e.target.value)}
              placeholder={'github.com\nstackoverflow.com\nreact.dev'}
            />
          </label>

          <label className="block">
            <span className="text-2xs text-fg-muted mb-1 block">
              Max pages per call: <span className="font-mono text-fg-secondary">{pagesDraft}</span>
            </span>
            <input
              type="range" min="1" max="20" step="1"
              className="w-full accent-brand"
              value={pagesDraft}
              onChange={(e) => setPagesDraft(parseInt(e.target.value, 10))}
            />
          </label>

          <div className="flex items-center gap-2 flex-wrap">
            <Btn size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : cfg.configured ? 'Update' : 'Save'}
            </Btn>
            {cfg.configured && (
              <>
                <Btn size="sm" variant="ghost" onClick={testKey} disabled={testing}>
                  {testing ? 'Testing…' : 'Test connection'}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={clearKey} disabled={pending}>
                  Clear
                </Btn>
              </>
            )}
            {feedback && (
              <span className={`text-2xs ${feedback.ok ? 'text-ok' : 'text-danger'}`}>{feedback.message}</span>
            )}
          </div>
        </div>
      )}
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
      <p className="text-2xs text-fg-muted mb-2">
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
