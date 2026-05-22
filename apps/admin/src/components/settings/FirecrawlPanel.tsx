/**
 * FILE: apps/admin/src/components/settings/FirecrawlPanel.tsx
 * PURPOSE: BYOK config for Firecrawl — the optional web-research provider used
 *          by the Research page, fix-augmentation, and the library modernizer.
 *          Manages key, allowed domains, per-call page cap, and live test.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { Section, Btn, ErrorAlert, ResultChip } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfigHelp } from '../ConfigHelp'
import { ConfirmDialog } from '../ConfirmDialog'
import { SettingsChangeHint } from './SettingsChangeHint'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsCard, SettingsPanelLayout } from './SettingsPanelLayout'
import { countChangedFields, valuesEqual } from './settingsDiff'
import { ConfiguredSecretField } from './ConfiguredSecretField'
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface'

interface FirecrawlConfig {
  configured: boolean
  keyHint: string | null
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
  const [confirmingClear, setConfirmingClear] = useState(false)

  if (cfg && domainsDraft === null) setDomainsDraft(cfg.allowedDomains.join('\n'))
  if (cfg && pagesDraft === null) setPagesDraft(cfg.maxPagesPerCall)

  const savedDomains = cfg?.allowedDomains.join('\n') ?? ''
  const savedPages = cfg?.maxPagesPerCall ?? 5
  const domains = domainsDraft ?? savedDomains
  const pages = pagesDraft ?? savedPages

  const domainsDirty = !valuesEqual(domains, savedDomains)
  const pagesDirty = !valuesEqual(pages, savedPages)
  const keyDirty = keyDraft.trim().length >= 8
  const dirty = domainsDirty || pagesDirty || keyDirty
  const changeCount = countChangedFields([
    { current: domains, saved: savedDomains },
    { current: pages, saved: savedPages },
    ...(keyDirty ? [{ current: keyDraft, saved: '' }] : []),
  ])

  function resetDraft() {
    setDomainsDraft(savedDomains)
    setPagesDraft(savedPages)
    setKeyDraft('')
  }

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

  async function confirmClearKey() {
    setPending(true)
    setFeedback(null)
    const res = await apiFetch('/v1/admin/byok/firecrawl', { method: 'DELETE' })
    setPending(false)
    setConfirmingClear(false)
    if (res.ok) {
      setKeyDraft('')
      setDomainsDraft(null)
      setPagesDraft(null)
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
    <SettingsPanelLayout
      fullWidth={
        <ContainedBlock tone="muted">
          <p className="text-2xs leading-relaxed text-fg-muted">
            <strong className="text-fg-secondary">Optional integration.</strong> Brings{' '}
            <span className="font-mono">firecrawl.dev</span> under your own key for Research search,
            fix-worker web augmentation, and the library modernizer cron. Keys live in Supabase Vault;
            calls are cached 24h and bounded by the per-call page cap.
          </p>
        </ContainedBlock>
      }
      footer={
        <SettingsFormFooter
          dirty={dirty}
          saving={pending}
          changeCount={changeCount}
          onSave={() => void save()}
          onDiscard={resetDraft}
          saveLabel="Save changes"
        />
      }
    >
      <Section title="Firecrawl (BYOK — Web Research)" className="lg:col-span-2 space-y-3">

        {cfg && (
          <SettingsCard>
            <div className="flex items-center gap-2 flex-wrap">
              <SignalChip tone="brand">Firecrawl</SignalChip>
              <SignalChip tone={cfg.configured ? 'ok' : 'neutral'}>
                {cfg.configured ? 'BYOK' : 'not configured'}
              </SignalChip>
              {statusMeta && (
                <SignalChip
                  tone={
                    statusMeta.tone === 'ok' ? 'ok' :
                    statusMeta.tone === 'warn' ? 'warn' :
                    'danger'
                  }
                >
                  {statusMeta.label}
                </SignalChip>
              )}
            </div>

            {cfg.configured && (
              <InlineProof>
                Added {cfg.addedAt ? new Date(cfg.addedAt).toLocaleString() : 'unknown'}
                {cfg.lastUsedAt && <> · last used {new Date(cfg.lastUsedAt).toLocaleString()}</>}
                {cfg.testedAt && <> · tested {new Date(cfg.testedAt).toLocaleString()}</>}
              </InlineProof>
            )}

            <ConfiguredSecretField
              label="Firecrawl API key"
              helpId="settings.firecrawl.api_key"
              configured={cfg.configured}
              keyHint={cfg.keyHint}
              fallbackPrefix="fc-"
              value={keyDraft}
              onChange={setKeyDraft}
              placeholder="fc-…"
            />
            {keyDirty && cfg.configured && (
              <SettingsChangeHint
                current={keyDraft}
                saved={cfg.keyHint ?? '(configured)'}
                kind="text"
                prefix="Replacing"
              />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <label className="block">
                <ContainedBlock tone="muted" className="mb-1">
                  <span className="text-2xs text-fg-muted flex items-center gap-1">
                    <span>Allowed domains <span className="text-fg-faint">(one per line — empty = unrestricted)</span></span>
                    <ConfigHelp helpId="settings.firecrawl.allowed_domains" />
                  </span>
                </ContainedBlock>
                <textarea
                  className="w-full text-2xs font-mono px-2 py-1.5 rounded-sm bg-surface-raised border border-edge focus:border-accent outline-none min-h-[64px]"
                  value={domains}
                  onChange={(e) => setDomainsDraft(e.target.value)}
                  placeholder={'github.com\nstackoverflow.com\nreact.dev'}
                />
                <SettingsChangeHint current={domains} saved={savedDomains} />
              </label>

              <label className="block">
                <ContainedBlock tone="muted" className="mb-1">
                  <span className="text-2xs text-fg-muted flex items-center gap-1">
                    <span>Max pages per call: <span className="font-mono text-fg-secondary">{pages}</span></span>
                    <ConfigHelp helpId="settings.firecrawl.max_pages_per_call" />
                  </span>
                </ContainedBlock>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  className="w-full accent-brand"
                  value={pages}
                  onChange={(e) => setPagesDraft(parseInt(e.target.value, 10))}
                />
                <SettingsChangeHint current={pages} saved={savedPages} kind="number" />
              </label>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {cfg.configured && (
                <>
                  <Btn size="sm" variant="ghost" onClick={testKey} loading={testing}>
                    Test connection
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmingClear(true)} disabled={pending}>
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
          </SettingsCard>
        )}

        {confirmingClear && (
          <ConfirmDialog
            title="Clear the Firecrawl API key?"
            body="Research, fix-augmentation, and the library modernizer will all stop functioning until a new key is added. Existing cached results stay; pending crawls will fail."
            confirmLabel="Clear key"
            cancelLabel="Keep key"
            tone="danger"
            loading={pending}
            onConfirm={() => void confirmClearKey()}
            onCancel={() => {
              if (!pending) setConfirmingClear(false)
            }}
          />
        )}
      </Section>
    </SettingsPanelLayout>
  )
}
