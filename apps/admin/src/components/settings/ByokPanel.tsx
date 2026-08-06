/**
 * FILE: apps/admin/src/components/settings/ByokPanel.tsx
 * PURPOSE: Unified BYOK key pool management for every supported provider.
 *          Shows per-provider key lists, health chips, and a "switch key" banner
 *          when any key hits quota/auth failure.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { Section, Input, Btn, ErrorAlert, ResultChip } from '../ui';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { ConfirmDialog } from '../ConfirmDialog';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import { SettingsPanelLayout } from './SettingsPanelLayout';
import { ContainedBlock } from '../report-detail/ReportSurface';
import { CHIP_TONE, runStatusChipTone } from '../../lib/chipTone';
import { token } from '../../lib/validators';
import type { PoolKey, PoolKeyStatus, PoolTestStatus } from './byokPool';

interface HealthSummary {
  providers: Array<{
    provider: string;
    total: number;
    active: number;
    pending: number;
    exhausted: number;
    failed: number;
  }>;
}

interface LegacyKey {
  id: string;
  provider_slug: string;
  label: string;
  status: PoolKeyStatus;
  test_status: PoolTestStatus | null;
  cooldown_until: null;
  key_hint: string | null;
  base_url: string | null;
  last_tested_at: string | null;
  last_used_at: string | null;
  created_at: string | null;
  legacy: true;
}

type ManagedKey = PoolKey | LegacyKey;

function isLegacyKey(key: ManagedKey): key is LegacyKey {
  return 'legacy' in key && key.legacy;
}

const PROVIDER_META: Record<
  string,
  { name: string; placeholder: string; consoleUrl: string; help: string }
> = {
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
  firecrawl: {
    name: 'Firecrawl',
    placeholder: 'fc-…',
    consoleUrl: 'https://www.firecrawl.dev/app/api-keys',
    help: 'Powers web research, story mapping, fix augmentation, and library modernization.',
  },
  browserbase: {
    name: 'Browserbase',
    placeholder: 'bb-…',
    consoleUrl: 'https://www.browserbase.com/settings',
    help: 'Runs cloud-browser QA stories using your own Browserbase account.',
  },
};

const STATUS_CHIP: Record<PoolKeyStatus, { label: string; className: string }> = {
  pending_validation: { label: 'validation needed', className: CHIP_TONE.warnSubtle },
  active: { label: 'active', className: runStatusChipTone('active') },
  disabled: { label: 'disabled', className: runStatusChipTone('disabled') },
  quota_exhausted: { label: 'quota exhausted', className: CHIP_TONE.warnSubtle },
  auth_failed: { label: 'auth failed', className: CHIP_TONE.dangerSubtle },
};

const DISPLAY_PROVIDERS = ['anthropic', 'openai', 'cursor', 'firecrawl', 'browserbase'] as const;

export function ByokPanel() {
  const entitlements = useEntitlements();
  const byokLocked = !entitlements.loading && !entitlements.has('byok');

  const {
    data: poolData,
    loading: poolLoading,
    error: poolError,
    reload: reloadPool,
  } = usePageData<{ keys: PoolKey[]; legacyKeys?: LegacyKey[] }>(
    byokLocked ? null : '/v1/admin/byok/keys',
  );
  const { data: healthData, reload: reloadHealth } = usePageData<HealthSummary>(
    byokLocked ? null : '/v1/admin/byok/health',
  );

  const [addProvider, setAddProvider] = useState<string | null>(null);
  const [newKeyVal, setNewKeyVal] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<ManagedKey | null>(null);
  const [removing, setRemoving] = useState(false);
  const [togglePending, setTogglePending] = useState<string | null>(null);
  const [testPending, setTestPending] = useState<string | null>(null);

  function reload() {
    reloadPool();
    reloadHealth();
  }

  async function addKey(provider: string) {
    const k = newKeyVal.trim();
    const keyErr = token({ minLength: 8, optional: false })(k);
    if (keyErr) {
      setAddFeedback(keyErr.message);
      return;
    }
    setAdding(true);
    setAddFeedback(null);
    const res = await apiFetch('/v1/admin/byok/keys', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        key: k,
        label: newKeyLabel.trim() || null,
        baseUrl: provider === 'openai' ? newBaseUrl.trim() || undefined : undefined,
      }),
    });
    setAdding(false);
    if (res.ok) {
      const data = res.data as { validation?: { status?: PoolTestStatus } } | undefined;
      const validated = data?.validation?.status === 'ok';
      setActionFeedback({
        ok: validated,
        message: validated
          ? 'Credential validated and activated.'
          : 'Credential saved but quarantined. Fix the provider response, then test it again.',
      });
      setNewKeyVal('');
      setNewKeyLabel('');
      setNewBaseUrl('');
      setAddProvider(null);
      reload();
    } else {
      setAddFeedback(res.error?.message ?? 'Failed to add key.');
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    const res = await apiFetch(
      isLegacyKey(removeTarget)
        ? `/v1/admin/byok/${removeTarget.provider_slug}`
        : `/v1/admin/byok/keys/${removeTarget.id}`,
      { method: 'DELETE' },
    );
    setRemoving(false);
    setRemoveTarget(null);
    if (res.ok) {
      setActionFeedback({
        ok: true,
        message: isLegacyKey(removeTarget)
          ? 'Legacy credential removed from the Vault.'
          : 'Credential removed from the Vault.',
      });
      reload();
    } else {
      setActionFeedback({
        ok: false,
        message: res.error?.message ?? 'Failed to remove the credential.',
      });
    }
  }

  async function toggleKey(key: PoolKey) {
    setTogglePending(key.id);
    const newStatus = key.status === 'active' ? 'disabled' : 'active';
    const res = await apiFetch(`/v1/admin/byok/keys/${key.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    setTogglePending(null);
    if (!res.ok) {
      setActionFeedback({
        ok: false,
        message: res.error?.message ?? 'Failed to update the credential.',
      });
    }
    reload();
  }

  async function testKey(key: ManagedKey) {
    setTestPending(key.id);
    setActionFeedback(null);
    if (isLegacyKey(key)) {
      const res = await apiFetch<{ status: PoolTestStatus; detail: string; latencyMs: number }>(
        `/v1/admin/byok/${key.provider_slug}/test`,
        { method: 'POST' },
      );
      setTestPending(null);
      if (res.ok && res.data) {
        setActionFeedback({
          ok: res.data.status === 'ok',
          message:
            res.data.status === 'ok'
              ? `${PROVIDER_META[key.provider_slug]?.name ?? key.provider_slug} legacy credential validated (${res.data.latencyMs} ms).`
              : `Legacy credential remains quarantined: ${res.data.detail}`,
        });
      } else {
        setActionFeedback({
          ok: false,
          message: res.error?.message ?? 'Legacy credential test failed.',
        });
      }
      reload();
      return;
    }

    const res = await apiFetch(`/v1/admin/byok/keys/${key.id}/test`, { method: 'POST' });
    setTestPending(null);
    if (res.ok) {
      const data = res.data as { validation?: { status?: PoolTestStatus } } | undefined;
      const validated = data?.validation?.status === 'ok';
      setActionFeedback({
        ok: validated,
        message: validated
          ? `${PROVIDER_META[key.provider_slug]?.name ?? key.provider_slug} credential validated and activated.`
          : 'The provider did not validate this credential. It remains quarantined.',
      });
    } else {
      setActionFeedback({ ok: false, message: res.error?.message ?? 'Credential test failed.' });
    }
    reload();
  }

  if (byokLocked) {
    return (
      <SettingsPanelLayout>
        <Section title="API Key Pool (BYOK)" className="lg:col-span-2 space-y-3">
          <UpgradePrompt flag="byok" currentPlan={entitlements.planName} />
        </Section>
      </SettingsPanelLayout>
    );
  }

  if (entitlements.loading || poolLoading)
    return <PanelSkeleton rows={4} label="Loading key pool" inCard={false} />;
  if (poolError)
    return <ErrorAlert message={`Failed to load key pool: ${poolError}`} onRetry={reload} />;

  const allKeys = poolData?.keys ?? [];
  const legacyKeys = poolData?.legacyKeys ?? [];

  // Detect any quota/auth issues for the banner
  const exhaustedProviders = (healthData?.providers ?? []).filter(
    (p) => p.exhausted > 0 || p.failed > 0,
  );
  const hasExhausted = exhaustedProviders.length > 0;

  return (
    <SettingsPanelLayout
      fullWidth={
        <ContainedBlock tone="muted">
          <p className="text-xs leading-relaxed text-fg-muted">
            <strong className="text-fg-secondary">Mushi Mushi is BYOK-first.</strong> You bring the
            keys, you control which models touch your data. Add multiple keys per provider — if one
            hits quota, the next one is tried automatically. Keys live in Supabase Vault.
          </p>
        </ContainedBlock>
      }
    >
      <Section title="API Key Pool (BYOK)" className="lg:col-span-2 space-y-4">
        {actionFeedback && (
          <ResultChip tone={actionFeedback.ok ? 'success' : 'error'}>
            {actionFeedback.message}
          </ResultChip>
        )}

        {/* Quota exhaustion banner */}
        {hasExhausted && (
          <div className={`flex items-start gap-3 rounded-md px-3 py-2.5 ${CHIP_TONE.warnSubtle}`}>
            <span className="mt-0.5" aria-hidden>
              ⚠
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">
                {exhaustedProviders
                  .map((p) => PROVIDER_META[p.provider]?.name ?? p.provider)
                  .join(', ')}{' '}
                {exhaustedProviders.length === 1 ? 'has' : 'have'} exhausted keys.
              </p>
              <p className="text-xs text-fg-muted mt-0.5">
                Add a backup key below — the pipeline will automatically use it instead. No downtime
                needed.
              </p>
            </div>
          </div>
        )}

        {/* Per-provider sections */}
        {DISPLAY_PROVIDERS.map((provider) => {
          const meta = PROVIDER_META[provider];
          if (!meta) return null;
          const providerKeys = allKeys.filter((k) => k.provider_slug === provider);
          const providerLegacyKeys = legacyKeys.filter((k) => k.provider_slug === provider);
          const healthRow = healthData?.providers.find((p) => p.provider === provider);
          const isOpen = addProvider === provider;

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
                          {healthRow.pending > 0 && (
                            <span className="text-warn ml-1">
                              · {healthRow.pending} need validation
                            </span>
                          )}
                          {healthRow.exhausted > 0 && (
                            <span className="text-warn ml-1">
                              · {healthRow.exhausted} exhausted
                            </span>
                          )}
                          {healthRow.failed > 0 && (
                            <span className="text-danger ml-1">
                              · {healthRow.failed} failed auth
                            </span>
                          )}
                        </span>
                      </>
                    )}
                    {providerKeys.length === 0 && providerLegacyKeys.length === 0 && (
                      <span className="text-2xs text-fg-faint italic">
                        no keys — using platform default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-fg-muted mt-0.5">{meta.help}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={meta.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
                  >
                    Get key →
                  </a>
                  <Btn
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setAddProvider(isOpen ? null : provider);
                      setNewKeyVal('');
                      setNewKeyLabel('');
                      setNewBaseUrl('');
                      setAddFeedback(null);
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
                    const chip = STATUS_CHIP[k.status];
                    const isExpired = k.cooldown_until && new Date(k.cooldown_until) > new Date();
                    const canEnable = k.status === 'disabled' && k.test_status === 'ok';
                    return (
                      <div key={k.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-2xs text-fg-secondary">
                              {k.key_hint ?? '…****'}
                            </span>
                            {k.label && (
                              <span className="text-2xs text-fg-muted italic">{k.label}</span>
                            )}
                            <span
                              className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${chip.className}`}
                            >
                              {chip.label}
                            </span>
                            {k.test_status === 'ok' && (
                              <span
                                className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${CHIP_TONE.okSubtle}`}
                              >
                                verified
                              </span>
                            )}
                            {k.test_status === 'error_network' && (
                              <span
                                className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${CHIP_TONE.warnSubtle}`}
                              >
                                provider unreachable
                              </span>
                            )}
                            {isExpired && (
                              <span className="text-2xs text-warn">
                                cooldown until {new Date(k.cooldown_until!).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                          <p className="text-2xs text-fg-faint mt-0.5">
                            priority {k.priority} · added{' '}
                            {new Date(k.created_at).toLocaleDateString()}
                            {k.last_tested_at && (
                              <> · tested {new Date(k.last_tested_at).toLocaleString()}</>
                            )}
                            {k.last_used_at && (
                              <> · last used {new Date(k.last_used_at).toLocaleString()}</>
                            )}
                          </p>
                          {k.base_url && (
                            <p
                              className="text-2xs text-fg-faint mt-0.5 truncate"
                              title={k.base_url}
                            >
                              endpoint {k.base_url}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Btn
                            size="sm"
                            variant="ghost"
                            type="button"
                            loading={testPending === k.id}
                            onClick={() => void testKey(k)}
                          >
                            Test
                          </Btn>
                          <Btn
                            size="sm"
                            variant="ghost"
                            type="button"
                            loading={togglePending === k.id}
                            disabled={k.status !== 'active' && !canEnable}
                            onClick={() => void toggleKey(k)}
                          >
                            {k.status === 'active'
                              ? 'Disable'
                              : canEnable
                                ? 'Enable'
                                : 'Test first'}
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
                    );
                  })}
                </div>
              )}

              {providerLegacyKeys.length > 0 && (
                <div className="divide-y divide-edge/50 border-t border-edge/50">
                  {providerLegacyKeys.map((k) => {
                    const chip = STATUS_CHIP[k.status];
                    return (
                      <div key={k.id} className="flex items-center gap-3 px-3 py-2 bg-warn/5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-2xs text-fg-secondary">
                              {k.key_hint ?? '…****'}
                            </span>
                            <span className="text-2xs text-fg-muted italic">legacy credential</span>
                            <span
                              className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${chip.className}`}
                            >
                              {chip.label}
                            </span>
                            {k.test_status === 'ok' && (
                              <span
                                className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${CHIP_TONE.okSubtle}`}
                              >
                                verified
                              </span>
                            )}
                          </div>
                          <p className="text-2xs text-fg-faint mt-0.5">
                            legacy storage
                            {k.created_at && (
                              <> · added {new Date(k.created_at).toLocaleDateString()}</>
                            )}
                            {k.last_tested_at && (
                              <> · tested {new Date(k.last_tested_at).toLocaleString()}</>
                            )}
                            {k.last_used_at && (
                              <> · last used {new Date(k.last_used_at).toLocaleString()}</>
                            )}
                            {providerKeys.length > 0 && ' · pooled keys take precedence'}
                          </p>
                          {k.base_url && (
                            <p
                              className="text-2xs text-fg-faint mt-0.5 truncate"
                              title={k.base_url}
                            >
                              endpoint {k.base_url}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Btn
                            size="sm"
                            variant="ghost"
                            type="button"
                            loading={testPending === k.id}
                            onClick={() => void testKey(k)}
                          >
                            Test
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
                    );
                  })}
                </div>
              )}

              {/* Add key inline form */}
              {isOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addKey(provider);
                  }}
                  className="px-3 py-3 border-t border-edge/50 space-y-2 bg-surface-overlay/30"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-fg-muted">API key *</label>
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
                      <label className="text-xs text-fg-muted">Label (optional)</label>
                      <Input
                        type="text"
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        placeholder="e.g. personal, team, backup"
                      />
                    </div>
                  </div>
                  {provider === 'openai' && (
                    <div className="space-y-1">
                      <label className="text-xs text-fg-muted">
                        OpenAI-compatible base URL (optional)
                      </label>
                      <Input
                        type="url"
                        value={newBaseUrl}
                        onChange={(e) => setNewBaseUrl(e.target.value)}
                        placeholder="https://openrouter.ai/api/v1"
                        autoComplete="url"
                      />
                      <p className="text-2xs text-fg-faint">
                        HTTPS only. Known hosted providers are allowed; self-hosted operators can
                        extend the server allowlist.
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Btn type="submit" size="sm" loading={adding}>
                      Save &amp; validate
                    </Btn>
                    {addFeedback && <ResultChip tone="error">{addFeedback}</ResultChip>}
                  </div>
                  <p className="text-2xs text-fg-faint">
                    Keys are stored in Supabase Vault. Lower priority = tried first (default 100).
                    {providerKeys.length > 0 &&
                      ' New key will be tried when existing keys are exhausted.'}
                  </p>
                </form>
              )}
            </div>
          );
        })}

        {/* Remove confirmation */}
        {removeTarget && (
          <ConfirmDialog
            title={`Remove ${PROVIDER_META[removeTarget.provider_slug]?.name ?? removeTarget.provider_slug} key?`}
            body={`${isLegacyKey(removeTarget) ? 'Legacy key' : 'Key'} ending in ${removeTarget.key_hint ?? '****'} will be permanently deleted from the Vault. The pipeline will fall back to remaining keys or the platform default.`}
            confirmLabel="Remove key"
            cancelLabel="Keep key"
            tone="danger"
            loading={removing}
            onConfirm={() => void confirmRemove()}
            onCancel={() => {
              if (!removing) setRemoveTarget(null);
            }}
          />
        )}
      </Section>
    </SettingsPanelLayout>
  );
}
