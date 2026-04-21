/**
 * FILE: apps/admin/src/components/settings/FirecrawlPanel.tsx
 * PURPOSE: BYOK config for Firecrawl — the optional web-research provider used
 *          by the Research page, fix-augmentation, and the library modernizer.
 *          Manages key, allowed domains, per-call page cap, and live test.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { Section, Input, Btn, ErrorAlert, ResultChip } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'

interface FirecrawlConfig {
  configured: boolean
  addedAt: string | null
  lastUsedAt: string | null
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null
  testedAt: string | null
  allowedDomains: string[]
  maxPagesPerCall: number
}

const TEST_STATUS_LABEL: Record<NonNullable<FirecrawlConfig['testStatus']>, { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  ok: { label: 'Connection OK', tone: 'ok' },
  error_auth: { label: 'Auth failed', tone: 'danger' },
  error_network: { label: 'Network/endpoint error', tone: 'danger' },
  error_quota: { label: 'Quota / rate limit', tone: 'warn' },
}

export function FirecrawlPanel() {
  const { data, loading, error, reload } = usePageData<FirecrawlConfig>('/v1/admin/byok/firecrawl')
  const cfg = data ?? null

  const [pending, setPending] = useState(false)
  const [testing, setTesting] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [domainsDraft, setDomainsDraft] = useState<string | null>(null)
  const [pagesDraft, setPagesDraft] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  // Lazy-init local drafts from server data the first time it loads.
  if (cfg && domainsDraft === null) setDomainsDraft(cfg.allowedDomains.join('\n'))
  if (cfg && pagesDraft === null) setPagesDraft(cfg.maxPagesPerCall)

  const domains = domainsDraft ?? ''
  const pages = pagesDraft ?? 5

  async function save() {
    setPending(true)
    setFeedback(null)
    const allowedDomains = domains.split('\n').map((s) => s.trim()).filter(Boolean)
    const payload: Record<string, unknown> = {
      allowedDomains,
      maxPagesPerCall: pages,
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
      reload()
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
      reload()
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
      reload()
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Test failed.' })
    }
  }

  if (loading) return <PanelSkeleton rows={3} label="Loading Firecrawl status" inCard={false} />
  if (error) return <ErrorAlert message={`Failed to load Firecrawl status: ${error}`} onRetry={reload} />

  const statusMeta = cfg?.testStatus ? TEST_STATUS_LABEL[cfg.testStatus] : null

  return (
    <Section title="Firecrawl (BYOK — Web Research)" className="space-y-3">
      <div className="text-2xs text-fg-muted space-y-1">
        <p>
          <strong className="text-fg-secondary">Optional integration.</strong> Brings <span className="font-mono">firecrawl.dev</span> under your own key for three flows:
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
              value={domains}
              onChange={(e) => setDomainsDraft(e.target.value)}
              placeholder={'github.com\nstackoverflow.com\nreact.dev'}
            />
          </label>

          <label className="block">
            <span className="text-2xs text-fg-muted mb-1 block">
              Max pages per call: <span className="font-mono text-fg-secondary">{pages}</span>
            </span>
            <input
              type="range" min="1" max="20" step="1"
              className="w-full accent-brand"
              value={pages}
              onChange={(e) => setPagesDraft(parseInt(e.target.value, 10))}
            />
          </label>

          <div className="flex items-center gap-2 flex-wrap">
            <Btn size="sm" onClick={save} loading={pending}>
              {cfg.configured ? 'Update' : 'Save'}
            </Btn>
            {cfg.configured && (
              <>
                <Btn size="sm" variant="ghost" onClick={testKey} loading={testing}>
                  Test connection
                </Btn>
                <Btn size="sm" variant="ghost" onClick={clearKey} disabled={pending}>
                  Clear
                </Btn>
              </>
            )}
            {testing && !feedback ? (
              <ResultChip tone="running">Testing…</ResultChip>
            ) : feedback ? (
              <ResultChip tone={feedback.ok ? 'success' : 'error'}>{feedback.message}</ResultChip>
            ) : null}
          </div>
        </div>
      )}
    </Section>
  )
}
