/**
 * FILE: apps/admin/src/components/settings/BrowserbasePanel.tsx
 * PURPOSE: BYOK config for Browserbase — the cloud browser provider used by
 *          the QA Coverage story runner when provider = 'browserbase'. Without
 *          a project-scoped key the runner falls back to the platform global
 *          key (mushi_runtime_config), which means your QA traffic runs through
 *          Mushi's Browserbase account. Configure BYOK here to keep all
 *          browser session data in your own account.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { Section, Btn, ErrorAlert, ResultChip } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfirmDialog } from '../ConfirmDialog'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsCard, SettingsPanelLayout } from './SettingsPanelLayout'
import { ConfiguredSecretField } from './ConfiguredSecretField'
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface'

interface BrowserbaseConfig {
  configured: boolean
  keyHint: string | null
  addedAt: string | null
  lastUsedAt: string | null
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null
  testedAt: string | null
  sessionCount: number | null
}

const TEST_STATUS_LABEL: Record<NonNullable<BrowserbaseConfig['testStatus']>, { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  ok: { label: 'Connection OK', tone: 'ok' },
  error_auth: { label: 'Auth failed — check your key', tone: 'danger' },
  error_network: { label: 'Network/endpoint error', tone: 'danger' },
  error_quota: { label: 'Quota / rate limit', tone: 'warn' },
}

export function BrowserbasePanel() {
  const { data, loading, error, reload } = usePageData<BrowserbaseConfig>('/v1/admin/byok/browserbase')
  const cfg = data ?? null

  const [pending, setPending] = useState(false)
  const [testing, setTesting] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const keyDirty = keyDraft.trim().length >= 8

  function resetDraft() {
    setKeyDraft('')
    setFeedback(null)
  }

  async function save() {
    if (!keyDirty) return
    setPending(true)
    setFeedback(null)
    const res = await apiFetch('/v1/admin/byok/browserbase', {
      method: 'PUT',
      body: JSON.stringify({ key: keyDraft.trim() }),
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
    const res = await apiFetch('/v1/admin/byok/browserbase', { method: 'DELETE' })
    setPending(false)
    setConfirmingClear(false)
    if (res.ok) {
      setKeyDraft('')
      setFeedback({ ok: true, message: 'Key cleared. QA stories will fall back to the platform key.' })
      reload()
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Failed to clear key.' })
    }
  }

  async function testKey() {
    setTesting(true)
    setFeedback(null)
    const res = await apiFetch<{ status: string; latencyMs: number; detail: string }>(
      '/v1/admin/byok/browserbase/test',
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

  if (loading) return <PanelSkeleton rows={2} label="Loading Browserbase status" inCard={false} />
  if (error) return <ErrorAlert message={`Failed to load Browserbase status: ${error}`} onRetry={reload} />

  const statusMeta = cfg?.testStatus ? TEST_STATUS_LABEL[cfg.testStatus] : null

  return (
    <SettingsPanelLayout
      fullWidth={
        <ContainedBlock tone="muted">
          <p className="text-2xs leading-relaxed text-fg-muted">
            <strong className="text-fg-secondary">Optional integration.</strong>{' '}
            Bring your own{' '}
            <a href="https://www.browserbase.com" target="_blank" rel="noreferrer" className="underline">Browserbase</a>{' '}
            key so QA Coverage story runs (provider: <span className="font-mono">browserbase</span>) use your
            account's sessions — keeping all browser recordings, HAR traces, and screenshots in your own Browserbase project.
            Without BYOK, runs share the platform pool key and session data transits Mushi's Browserbase account.
          </p>
        </ContainedBlock>
      }
      footer={
        <SettingsFormFooter
          dirty={keyDirty}
          saving={pending}
          changeCount={keyDirty ? 1 : 0}
          onSave={() => void save()}
          onDiscard={resetDraft}
          saveLabel="Save key"
        />
      }
    >
      <Section title="Browserbase (BYOK — Cloud Browser Sessions)" className="lg:col-span-2 space-y-3">

        {cfg && (
          <SettingsCard>
            <div className="flex items-center gap-2 flex-wrap">
              <SignalChip tone="brand">Browserbase</SignalChip>
              <SignalChip tone={cfg.configured ? 'ok' : 'neutral'}>
                {cfg.configured ? 'BYOK' : 'platform key in use'}
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
              {cfg.sessionCount != null && cfg.sessionCount > 0 && (
                <SignalChip tone="neutral">{cfg.sessionCount} sessions run</SignalChip>
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
              label="Browserbase API key"
              helpId="settings.browserbase.api_key"
              configured={cfg.configured}
              keyHint={cfg.keyHint}
              fallbackPrefix="bb-"
              value={keyDraft}
              onChange={setKeyDraft}
              placeholder="bb-…"
            />

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
            title="Clear the Browserbase API key?"
            body="QA Coverage story runs with provider 'browserbase' will fall back to the platform pool key, and session data will transit Mushi's Browserbase account until a new key is added."
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
