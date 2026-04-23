/**
 * FILE: apps/admin/src/components/settings/ByokPanel.tsx
 * PURPOSE: Bring-Your-Own-Key management for Anthropic + OpenAI-compatible
 *          providers. Save / rotate / clear / live-test keys, with per-provider
 *          help cards and base-URL presets for OpenAI gateways.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useHotkeys } from '../../lib/useHotkeys'
import { Section, Input, Btn, ErrorAlert, ResultChip, type ResultChipTone } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfirmDialog } from '../ConfirmDialog'

interface ByokKey {
  provider: 'anthropic' | 'openai'
  configured: boolean
  addedAt: string | null
  lastUsedAt: string | null
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null
  testedAt: string | null
  baseUrl: string | null
}

interface TestResult {
  status: NonNullable<ByokKey['testStatus']>
  hint: string
  source: 'byok' | 'env'
  baseUrl: string | null
  httpStatus: number
  latencyMs: number
  detail: string
}

interface TestResultEntry {
  result: TestResult
  /** Captured at the moment the test completed; never recomputed on render
   *  so `<RelativeTime>` reads "X seconds ago", not "just now" forever. */
  testedAt: string
}

interface ByokProviderMeta {
  name: string
  placeholder: string
  help: string
  consoleUrl: string
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

export function ByokPanel() {
  const { data, loading, error, reload } = usePageData<{ keys: ByokKey[] }>('/v1/admin/byok')
  const keys = data?.keys ?? null

  const [pending, setPending] = useState<ByokKey['provider'] | null>(null)
  const [testing, setTesting] = useState<ByokKey['provider'] | null>(null)
  const [drafts, setDrafts] = useState<Record<ByokKey['provider'], string>>({ anthropic: '', openai: '' })
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [feedback, setFeedback] = useState<{ provider: ByokKey['provider']; ok: boolean; message: string } | null>(null)
  // Capture the wall-clock timestamp when the test completes — deriving
  // `testedAt` inside render via `new Date()` would reset the chip's
  // RelativeTime to "just now" on every parent re-render.
  const [testResults, setTestResults] = useState<Partial<Record<ByokKey['provider'], TestResultEntry>>>({})
  // Confirm dialog swaps in for the native `confirm()` the rest of the
  // admin retired. Tracking the target provider here is simpler than a
  // single boolean because the dialog can target either provider and
  // needs to remember which one on confirm.
  const [clearTarget, setClearTarget] = useState<ByokKey['provider'] | null>(null)
  const [clearing, setClearing] = useState(false)
  // Restore focus to the Test button after its click so keyboard users
  // can re-run the probe with Space/Enter without re-tabbing. `Btn`
  // isn't a forwardRef component — we stamp each provider button with a
  // stable `id` and focus through the DOM, which survives even across
  // a remount if Phase 1's SWR hook somehow regresses.
  const testButtonId = (provider: ByokKey['provider']) => `byok-test-${provider}`

  // Hydrate baseUrl from server data once. Avoid clobbering user typing on
  // re-renders by only syncing when the openai key changes.
  const openaiBaseUrl = keys?.find(k => k.provider === 'openai')?.baseUrl ?? null
  const [baseUrlInitialised, setBaseUrlInitialised] = useState(false)
  if (!baseUrlInitialised && openaiBaseUrl != null) {
    setBaseUrlInitialised(true)
    setBaseUrlDraft(openaiBaseUrl)
  }

  async function save(provider: ByokKey['provider']) {
    const key = drafts[provider].trim()
    if (key.length < 8) {
      setFeedback({ provider, ok: false, message: 'Paste the full provider API key.' })
      return
    }
    setPending(provider)
    setFeedback(null)
    const payload: Record<string, string | null> = { key }
    if (provider === 'openai') payload.baseUrl = baseUrlDraft.trim() || null

    const res = await apiFetch<{ provider: ByokKey['provider']; addedAt: string; hint: string }>(
      `/v1/admin/byok/${provider}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    )
    setPending(null)
    if (res.ok && res.data) {
      setDrafts((d) => ({ ...d, [provider]: '' }))
      setFeedback({ provider, ok: true, message: `Saved (${res.data.hint}). Click Test connection to verify.` })
      setTestResults((r) => ({ ...r, [provider]: undefined }))
      reload()
    } else {
      setFeedback({ provider, ok: false, message: res.error?.message ?? 'Failed to save key.' })
    }
  }

  async function confirmClearKey() {
    const provider = clearTarget
    if (!provider) return
    setClearing(true)
    setFeedback(null)
    const res = await apiFetch(`/v1/admin/byok/${provider}`, { method: 'DELETE' })
    setClearing(false)
    setClearTarget(null)
    if (res.ok) {
      setPending(null)
      setFeedback({ provider, ok: true, message: 'Key cleared.' })
      if (provider === 'openai') setBaseUrlDraft('')
      setTestResults((r) => ({ ...r, [provider]: undefined }))
      reload()
    } else {
      setFeedback({ provider, ok: false, message: res.error?.message ?? 'Failed to clear key.' })
    }
  }

  async function testKey(provider: ByokKey['provider']) {
    setTesting(provider)
    // Clear stale "Saved (…)" feedback so the running/result chip is the
    // single visible status for this provider. Without this, after
    // saving then testing, two chips briefly fight over the slot.
    setFeedback(null)
    const res = await apiFetch<TestResult>(`/v1/admin/byok/${provider}/test`, { method: 'POST' })
    setTesting(null)
    if (res.ok && res.data) {
      setTestResults((r) => ({
        ...r,
        [provider]: { result: res.data, testedAt: new Date().toISOString() },
      }))
      reload()
    } else {
      setFeedback({ provider, ok: false, message: res.error?.message ?? 'Test failed.' })
    }
    // Return focus to the Test button so pressing Enter again re-runs
    // without a tab detour. Wrap in requestAnimationFrame because
    // setTesting(null) above doesn't re-enable the button synchronously;
    // `Btn disabled={loading}` only clears on the next render, and a
    // disabled button silently refuses `.focus()`. Belt-and-braces for
    // keyboard flow since Phase 1's SWR upgrade means the button no
    // longer unmounts.
    if (typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        const btn = document.getElementById(testButtonId(provider)) as HTMLButtonElement | null
        btn?.focus()
      })
    }
  }

  // Keyboard shortcut: `t` tests the first configured provider. Matches
  // the command-palette convention ("Press a letter, do the thing on
  // the current page"). Skips when no key is configured — there's
  // nothing to test against. `allowInInputs: false` so the shortcut
  // doesn't hijack the user while they're mid-paste into a key field.
  const firstConfigured = keys?.find((k) => k.configured)?.provider ?? null
  useHotkeys(
    [
      {
        key: 't',
        description: 'Test connection for the first configured provider',
        handler: (e) => {
          if (!firstConfigured || testing) return
          e.preventDefault()
          void testKey(firstConfigured)
        },
      },
    ],
    !loading && !!firstConfigured,
  )

  if (loading) return <PanelSkeleton rows={3} label="Loading BYOK status" inCard={false} />
  if (error) return <ErrorAlert message={`Failed to load BYOK status: ${error}`} onRetry={reload} />

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

      {keys?.map((k) => {
        const meta = BYOK_PROVIDER_LABELS[k.provider]
        const fb = feedback?.provider === k.provider ? feedback : null
        const testEntry = testResults[k.provider]
        const testResult = testEntry?.result
        const testStatus = testResult?.status ?? k.testStatus
        const testedAt = testEntry?.testedAt ?? k.testedAt
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
              <Btn size="sm" onClick={() => save(k.provider)} loading={pending === k.provider}>
                {k.configured ? 'Rotate key' : 'Save key'}
              </Btn>
              {k.configured && (
                <>
                  <Btn
                    id={testButtonId(k.provider)}
                    size="sm"
                    variant="ghost"
                    onClick={() => testKey(k.provider)}
                    loading={testing === k.provider}
                  >
                    Test connection
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setClearTarget(k.provider)}
                    disabled={pending === k.provider}
                  >
                    Clear
                  </Btn>
                </>
              )}
              {(() => {
                if (fb) {
                  return (
                    <ResultChip tone={fb.ok ? 'success' : 'error'}>
                      {fb.message}
                    </ResultChip>
                  )
                }
                if (testing === k.provider) {
                  return <ResultChip tone="running">Testing…</ResultChip>
                }
                if (testResult) {
                  const tone: ResultChipTone =
                    testResult.status === 'ok'
                      ? 'success'
                      : testResult.status === 'error_quota'
                        ? 'info'
                        : 'error'
                  return (
                    <ResultChip tone={tone} at={testedAt}>
                      {testResult.hint || statusMeta?.label || testResult.status}
                    </ResultChip>
                  )
                }
                return null
              })()}
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

      {clearTarget && (
        <ConfirmDialog
          title={`Remove ${BYOK_PROVIDER_LABELS[clearTarget].name} key?`}
          body="The pipeline will fall back to the platform default (if your plan includes one). This cannot be undone — you'll need to paste the key again to restore BYOK."
          confirmLabel="Remove key"
          cancelLabel="Keep key"
          tone="danger"
          loading={clearing}
          onConfirm={() => void confirmClearKey()}
          onCancel={() => {
            if (!clearing) setClearTarget(null)
          }}
        />
      )}
    </Section>
  )
}
