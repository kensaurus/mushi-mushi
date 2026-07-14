/**
 * FILE: apps/admin/src/components/settings/ByokPanel.tsx
 * PURPOSE: BYOK key pool — multi-key management for Anthropic, OpenAI, and Cursor.
 *          Shows per-provider key lists, health chips, and a "switch key" banner
 *          when any key hits quota/auth failure.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { Section, Input, Btn, ErrorAlert, ResultChip } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfirmDialog } from '../ConfirmDialog'
import { useEntitlements } from '../../lib/useEntitlements'
import { UpgradePrompt } from '../billing/UpgradePrompt'
import { SettingsPanelLayout } from './SettingsPanelLayout'
import { ContainedBlock } from '../report-detail/ReportSurface'
import { CHIP_TONE, runStatusChipTone } from '../../lib/chipTone'

type PoolKeyStatus = 'active' | 'disabled' | 'quota_exhausted' | 'auth_failed'

interface PoolKey {
  id: string
  provider_slug: 'anthropic' | 'openai' | 'cursor' | 'firecrawl' | 'browserbase'
  label: string | null
  priority: number
  status: PoolKeyStatus
  key_hint: string | null
  test_status: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null
  cooldown_until: string | null
  created_at: string
}

interface HealthSummary {
  providers: Array<{ provider: string; total: number; active: number; exhausted: number; failed: number }>
}

const PROVIDER_META: Record<string, { name: string; placeholder: string; consoleUrl: string; help: string }> = {
  anthropic: {
    name: 'Anthropic (Claude)',
    placeholder: 'sk-ant-api03-…',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    help: 'Powers Stage-1 fast-filter (Haiku), Stage-2 classifier (Sonnet), fix agent, test gen, and story mapping.',
  },
  openai: {
    name: 'OpenAI / OpenRouter',
    placeholder: 'sk-… or sk-or-v1-…',
    consoleUrl: 'https://platform.openai.com/api-keys',
    help: 'Fallback for any Anthropic operation. Set OpenRouter as base URL to access 300+ models.',
  },
  cursor: {
    name: 'Cursor Cloud Agent',
    placeholder: 'crsr_…',
    consoleUrl: 'https://cursor.com/dashboard/integrations',
    help: 'Used for dispatching Cursor Cloud Agents to generate Playwright tests and fix PRs.',
  },
}

const STATUS_CHIP: Record<PoolKeyStatus, { label: string; className: string }> = {
  active: { label: 'active', className: runStatusChipTone('active') },
  disabled: { label: 'disabled', className: runStatusChipTone('disabled') },
  quota_exhausted: { label: 'quota exhausted', className: CHIP_TONE.warnSubtle },
  auth_failed: { label: 'auth failed', className: CHIP_TONE.dangerSubtle },
}

const DISPLAY_PROVIDERS = ['anthropic', 'openai', 'cursor'] as const

export function ByokPanel() {
  const entitlements = useEntitlements()
  const byokLocked = !entitlements.loading && !entitlements.has('byok')

  const { data: poolData, loading: poolLoading, error: poolError, reload: reloadPool } = usePageData<{ keys: PoolKey[] }>(
    byokLocked ? null : '/v1/admin/byok/keys',
  )
  const { data: healthData, reload: reloadHealth } = usePageData<HealthSummary>(
    byokLocked ? null : '/v1/admin/byok/health',
  )

  const [addProvider, setAddProvider] = useState<string | null>(null)
  const [newKeyVal, setNewKeyVal] = useState('')
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [addFeedback, setAddFeedback] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PoolKey | null>(null)
  const [removing, setRemoving] = useState(false)
  const [togglePending, setTogglePending] = useState<string | null>(null)

  function reload() {
    reloadPool()
    reloadHealth()
  }

  async function addKey(provider: string) {
    const k = newKeyVal.trim()
    if (k.length < 8) {
      setAddFeedback('Paste the full provider API key.')
      return
    }
    setAdding(true)
    setAddFeedback(null)
    const res = await apiFetch('/v1/admin/byok/keys', {
      method: 'POST',
      body: JSON.stringify({ provider, key: k, label: newKeyLabel.trim() || null }),
    })
    setAdding(false)
    if (res.ok) {
      setNewKeyVal('')
      setNewKeyLabel('')
      setAddProvider(null)
      reload()
    } else {
      setAddFeedback(res.error?.message ?? 'Failed to add key.')
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    const res = await apiFetch(`/v1/admin/byok/keys/${removeTarget.id}`, { method: 'DELETE' })
    setRemoving(false)
    setRemoveTarget(null)
    if (res.ok) reload()
  }

  async function toggleKey(key: PoolKey) {
    setTogglePending(key.id)
    const newStatus = key.status === 'active' ? 'disabled' : 'active'
    await apiFetch(`/v1/admin/byok/keys/${key.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    })
    setTogglePending(null)
    reload()
  }

  if (byokLocked) {
    return (
      <SettingsPanelLayout>
        <Section title="API Key Pool (BYOK)" className="lg:col-span-2 space-y-3">
          <UpgradePrompt flag="byok" currentPlan={entitlements.planName} />
        </Section>
      </SettingsPanelLayout>
    )
  }

  if (entitlements.loading || poolLoading) return <PanelSkeleton rows={4} label="Loading key pool" inCard={false} />
  if (poolError) return <ErrorAlert message={`Failed to load key pool: ${poolError}`} onRetry={reload} />

  const allKeys = poolData?.keys ?? []

  // Detect any quota/auth issues for the banner
  const exhaustedProviders = (healthData?.providers ?? []).filter(p => p.exhausted > 0 || p.failed > 0)
  const hasExhausted = exhaustedProviders.length > 0

  return (
    <SettingsPanelLayout
      fullWidth={
        <ContainedBlock tone="muted">
          <p className="text-2xs leading-relaxed text-fg-muted">
            <strong className="text-fg-secondary">Mushi Mushi is BYOK-first.</strong> You bring the keys, you control which models touch your data. Add multiple keys per provider — if one hits quota, the next one is tried automatically. Keys live in Supabase Vault.
          </p>
        </ContainedBlock>
      }
    >
      <Section title="API Key Pool (BYOK)" className="lg:col-span-2 space-y-4">

        {/* Quota exhaustion banner */}
        {hasExhausted && (
          <div className={`flex items-start gap-3 rounded-md px-3 py-2.5 ${CHIP_TONE.warnSubtle}`}>
            <span className="mt-0.5" aria-hidden>⚠</span>
            <div className="flex-1 min-w-0">
              <p className="text-2xs font-medium">
                {exhaustedProviders.map(p => PROVIDER_META[p.provider]?.name ?? p.provider).join(', ')} {exhaustedProviders.length === 1 ? 'has' : 'have'} exhausted keys.
              </p>
              <p className="text-2xs text-fg-muted mt-0.5">
                Add a backup key below — the pipeline will automatically use it instead. No downtime needed.
              </p>
            </div>
          </div>
        )}

        {/* Per-provider sections */}
        {DISPLAY_PROVIDERS.map((provider) => {
          const meta = PROVIDER_META[provider]
          if (!meta) return null
          const providerKeys = allKeys.filter(k => k.provider_slug === provider)
          const healthRow = healthData?.providers.find(p => p.provider === provider)
          const isOpen = addProvider === provider

          return (
            <div key={provider} className="border border-edge rounded-md overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-surface-raised/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-fg-primary">{meta.name}</span>
                    {healthRow && (
                      <>
                        <span className="text-2xs text-fg-muted">
                          {healthRow.active} active
                          {healthRow.exhausted > 0 && <span className="text-warn ml-1">· {healthRow.exhausted} exhausted</span>}
                          {healthRow.failed > 0 && <span className="text-danger ml-1">· {healthRow.failed} failed auth</span>}
                        </span>
                      </>
                    )}
                    {providerKeys.length === 0 && (
                      <span className="text-2xs text-fg-faint italic">no keys — using platform default</span>
                    )}
                  </div>
                  <p className="text-2xs text-fg-muted mt-0.5">{meta.help}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={meta.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-2xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
                  >
                    Get key →
                  </a>
                  <Btn
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setAddProvider(isOpen ? null : provider)
                      setNewKeyVal('')
                      setNewKeyLabel('')
                      setAddFeedback(null)
                    }}
                  >
                    {isOpen ? 'Cancel' : '+ Add key'}
                  </Btn>
                </div>
              </div>

              {/* Key list */}
              {providerKeys.length > 0 && (
                <div className="divide-y divide-edge/50">
                  {providerKeys.map((k) => {
                    const chip = STATUS_CHIP[k.status]
                    const isExpired = k.cooldown_until && new Date(k.cooldown_until) > new Date()
                    return (
                      <div key={k.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-2xs text-fg-secondary">{k.key_hint ?? '…****'}</span>
                            {k.label && <span className="text-2xs text-fg-muted italic">{k.label}</span>}
                            <span className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${chip.className}`}>
                              {chip.label}
                            </span>
                            {isExpired && (
                              <span className="text-2xs text-warn">
                                cooldown until {new Date(k.cooldown_until!).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                          <p className="text-2xs text-fg-faint mt-0.5">
                            priority {k.priority} · added {new Date(k.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Btn
                            size="sm"
                            variant="ghost"
                            type="button"
                            loading={togglePending === k.id}
                            onClick={() => void toggleKey(k)}
                          >
                            {k.status === 'active' ? 'Disable' : 'Enable'}
                          </Btn>
                          <Btn
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => setRemoveTarget(k)}
                          >
                            Remove
                          </Btn>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add key inline form */}
              {isOpen && (
                <form
                  onSubmit={(e) => { e.preventDefault(); void addKey(provider) }}
                  className="px-3 py-3 border-t border-edge/50 space-y-2 bg-surface-overlay/30"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-2xs text-fg-muted">API key *</label>
                      <Input
                        type="password"
                        value={newKeyVal}
                        onChange={(e) => setNewKeyVal(e.target.value)}
                        placeholder={meta.placeholder}
                        autoFocus
                        autoComplete="new-password"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-2xs text-fg-muted">Label (optional)</label>
                      <Input
                        type="text"
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        placeholder="e.g. personal, team, backup"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Btn type="submit" size="sm" loading={adding}>
                      Save key
                    </Btn>
                    {addFeedback && (
                      <ResultChip tone="error">{addFeedback}</ResultChip>
                    )}
                  </div>
                  <p className="text-2xs text-fg-faint">
                    Keys are stored in Supabase Vault. Lower priority = tried first (default 100).
                    {providerKeys.length > 0 && ' New key will be tried when existing keys are exhausted.'}
                  </p>
                </form>
              )}
            </div>
          )
        })}

        {/* Remove confirmation */}
        {removeTarget && (
          <ConfirmDialog
            title={`Remove ${PROVIDER_META[removeTarget.provider_slug]?.name ?? removeTarget.provider_slug} key?`}
            body={`Key ending in ${removeTarget.key_hint ?? '****'} will be permanently deleted from the Vault. The pipeline will fall back to remaining keys or the platform default.`}
            confirmLabel="Remove key"
            cancelLabel="Keep key"
            tone="danger"
            loading={removing}
            onConfirm={() => void confirmRemove()}
            onCancel={() => { if (!removing) setRemoveTarget(null) }}
          />
        )}
      </Section>
    </SettingsPanelLayout>
  )
}
