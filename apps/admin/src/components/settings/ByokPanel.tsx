/**
 * FILE: apps/admin/src/components/settings/ByokPanel.tsx
 * PURPOSE: Unified BYOK key pool management for every supported provider.
 *          Shows per-provider key lists, health chips, and a "switch key" banner
 *          when any key hits quota/auth failure.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { Section, Input, SecretInput, Btn, ErrorAlert, ResultChip, Tooltip } from '../ui';
import { IconPlay, IconTrash } from '../icons';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { ConfirmDialog } from '../ConfirmDialog';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import { SettingsPanelLayout } from './SettingsPanelLayout';
import { ContainedBlock } from '../report-detail/ReportSurface';
import { CHIP_TONE, runStatusChipTone } from '../../lib/chipTone';
import { prepareByokSecret } from '../../lib/byokKeyRules';
import { describeByokError } from '../../lib/byokErrors';
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
  {
    name: string;
    placeholder: string;
    consoleUrl: string;
    help: string;
    /** Shown when the provider has no key. Defaults to the platform-key note. */
    emptyNote?: string;
    /** Extra setup guidance under the help line. */
    guidance?: string;
  }
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
  supabase: {
    name: 'Supabase (read-only)',
    placeholder: 'sbp_…',
    consoleUrl: 'https://supabase.com/dashboard/account/tokens',
    help: "Reads your linked Supabase project's schema, advisors, edge functions and logs for diagnoses. Read-only: Mushi never writes to it.",
    emptyNote: 'no token — Supabase not linked',
    guidance:
      'Use a scoped token: this one project only; Database, Edge Functions, Advisors and Logs set to Read and nothing else; with an expiry. Set the project ref in Settings → General first, because the token is checked against it.',
  },
};

const STATUS_CHIP: Record<PoolKeyStatus, { label: string; className: string }> = {
  pending_validation: { label: 'validation needed', className: CHIP_TONE.warnSubtle },
  active: { label: 'active', className: runStatusChipTone('active') },
  disabled: { label: 'disabled', className: runStatusChipTone('disabled') },
  quota_exhausted: { label: 'quota exhausted', className: CHIP_TONE.warnSubtle },
  auth_failed: { label: 'auth failed', className: CHIP_TONE.dangerSubtle },
};

// Kept on one line: byok-lifecycle-contract.test.ts asserts the provider order.
// prettier-ignore
const DISPLAY_PROVIDERS = ['anthropic', 'openai', 'cursor', 'firecrawl', 'browserbase', 'supabase'] as const;

type ValidationReply =
  | {
      validation?: { status?: PoolTestStatus; detail?: string };
      /** The pooled copy of the legacy key validated, so the legacy slot was cleared. */
      legacyRetired?: boolean;
      /** A working pooled key now shadows a different legacy key. */
      legacySuperseded?: boolean;
    }
  | undefined;

/**
 * Feedback shown beside what caused it: a key row (`scope` = key id) or a
 * provider block (`scope` = `provider:<slug>`), never a chip at the top.
 */
interface Notice {
  scope: string;
  provider: string;
  ok: boolean;
  message: string;
  /** Offer to remove the provider's legacy key (a pooled key replaced it). */
  offerLegacyRemoval?: boolean;
}

function NoticeLine({
  notice,
  legacyKey,
  onRemoveLegacy,
}: {
  notice: Notice;
  legacyKey: LegacyKey | undefined;
  onRemoveLegacy: (key: LegacyKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <ResultChip tone={notice.ok ? 'success' : 'error'}>{notice.message}</ResultChip>
      {notice.offerLegacyRemoval && legacyKey && (
        <>
          <span className="text-2xs text-fg-muted">
            The old legacy key ({legacyKey.key_hint ?? '…****'}) is no longer used.
          </span>
          <Btn size="sm" variant="ghost" type="button" onClick={() => onRemoveLegacy(legacyKey)}>
            Remove old key
          </Btn>
        </>
      )}
    </div>
  );
}

/** What normalization stripped, e.g. "We removed OPENAI_API_KEY= from what you pasted." */
function RemovedHint({ removed }: { removed: string[] }) {
  return (
    <p className="text-2xs text-fg-muted">
      We removed{' '}
      {removed.map((part, i) => (
        <span key={part}>
          {i > 0 && ' and '}
          {part.endsWith('=') ? <code className="font-mono text-fg-secondary">{part}</code> : part}
        </span>
      ))}{' '}
      from what you pasted.
    </p>
  );
}

/** The probe's own reason, so "set the project ref first" reaches the owner. */
function quarantinedMessage(data: ValidationReply, fallback: string): string {
  const detail = data?.validation?.detail?.trim();
  return detail ? `${fallback} ${detail}` : fallback;
}

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
  // Add-form errors, each shown where it belongs: under the key field, under
  // the base URL field, or beside the Save button.
  const [keyTouched, setKeyTouched] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ManagedKey | null>(null);
  const [removing, setRemoving] = useState(false);
  const [togglePending, setTogglePending] = useState<string | null>(null);
  const [testPending, setTestPending] = useState<string | null>(null);

  function reload() {
    reloadPool();
    reloadHealth();
  }

  function resetAddForm() {
    setNewKeyVal('');
    setNewKeyLabel('');
    setNewBaseUrl('');
    setKeyTouched(false);
    setKeyError(null);
    setBaseUrlError(null);
    setFormError(null);
  }

  async function addKey(provider: string) {
    // Same normalization and format rules the server applies, so a wrong
    // or malformed paste is caught here with the same wording, before any
    // request is sent.
    const prepared = prepareByokSecret(provider, newKeyVal, {
      baseUrl: provider === 'openai' ? newBaseUrl : null,
    });
    setKeyTouched(true);
    setFormError(null);
    setBaseUrlError(null);
    if (!prepared.ok) {
      setKeyError(prepared.message);
      return;
    }
    setKeyError(null);
    setAdding(true);
    const res = await apiFetch('/v1/admin/byok/keys', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        key: prepared.value,
        label: newKeyLabel.trim() || null,
        baseUrl: provider === 'openai' ? newBaseUrl.trim() || undefined : undefined,
      }),
    });
    setAdding(false);
    if (res.ok) {
      const data = res.data as ValidationReply;
      const validated = data?.validation?.status === 'ok';
      setNotice({
        scope: `provider:${provider}`,
        provider,
        ok: validated,
        message: validated
          ? data?.legacyRetired
            ? 'Credential validated and activated. It was the same as the legacy key, so the legacy copy was removed.'
            : 'Credential validated and activated.'
          : quarantinedMessage(data, 'Credential saved but quarantined.'),
        offerLegacyRemoval: Boolean(data?.legacySuperseded),
      });
      resetAddForm();
      setAddProvider(null);
      reload();
    } else {
      const view = describeByokError(res.error, 'The key was not added. Retry in a moment.');
      if (view.where === 'key') setKeyError(view.message);
      else if (view.where === 'baseUrl') setBaseUrlError(view.message);
      else setFormError(view.message);
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
      setNotice({
        scope: `provider:${removeTarget.provider_slug}`,
        provider: removeTarget.provider_slug,
        ok: true,
        message: isLegacyKey(removeTarget)
          ? 'Legacy credential removed from the Vault.'
          : 'Credential removed from the Vault.',
      });
      reload();
    } else {
      setNotice({
        scope: removeTarget.id,
        provider: removeTarget.provider_slug,
        ok: false,
        message: describeByokError(res.error, 'The credential was not removed. Retry in a moment.')
          .message,
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
      setNotice({
        scope: key.id,
        provider: key.provider_slug,
        ok: false,
        message: describeByokError(res.error, 'The credential was not updated. Retry in a moment.')
          .message,
      });
    }
    reload();
  }

  async function testKey(key: ManagedKey) {
    setTestPending(key.id);
    setNotice(null);
    if (isLegacyKey(key)) {
      const res = await apiFetch<{ status: PoolTestStatus; detail: string; latencyMs: number }>(
        `/v1/admin/byok/${key.provider_slug}/test`,
        { method: 'POST' },
      );
      setTestPending(null);
      if (res.ok && res.data) {
        setNotice({
          scope: key.id,
          provider: key.provider_slug,
          ok: res.data.status === 'ok',
          message:
            res.data.status === 'ok'
              ? `${PROVIDER_META[key.provider_slug]?.name ?? key.provider_slug} legacy credential validated (${res.data.latencyMs} ms).`
              : `Legacy credential remains quarantined: ${res.data.detail}`,
        });
      } else {
        setNotice({
          scope: key.id,
          provider: key.provider_slug,
          ok: false,
          message: describeByokError(
            res.error,
            'The legacy credential test did not run. Retry in a moment.',
          ).message,
        });
      }
      reload();
      return;
    }

    const res = await apiFetch(`/v1/admin/byok/keys/${key.id}/test`, { method: 'POST' });
    setTestPending(null);
    if (res.ok) {
      const data = res.data as ValidationReply;
      const validated = data?.validation?.status === 'ok';
      setNotice({
        scope: key.id,
        provider: key.provider_slug,
        ok: validated,
        message: validated
          ? `${PROVIDER_META[key.provider_slug]?.name ?? key.provider_slug} credential validated and activated.`
          : quarantinedMessage(data, 'The credential remains quarantined.'),
        offerLegacyRemoval: Boolean(data?.legacySuperseded),
      });
    } else {
      setNotice({
        scope: key.id,
        provider: key.provider_slug,
        ok: false,
        message: describeByokError(res.error, 'The credential test did not run. Retry in a moment.')
          .message,
      });
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
          const noticeHere = (scope: string) =>
            notice?.scope === scope ? (
              <NoticeLine
                notice={notice}
                legacyKey={legacyKeys.find((k) => k.provider_slug === notice.provider)}
                onRemoveLegacy={setRemoveTarget}
              />
            ) : null;
          // Live check of the draft key, with the server's own wording.
          const draft = isOpen
            ? prepareByokSecret(provider, newKeyVal, {
                baseUrl: provider === 'openai' ? newBaseUrl : null,
              })
            : null;
          const liveKeyError =
            keyTouched && newKeyVal.trim() && draft && !draft.ok ? draft.message : null;
          const visibleKeyError = keyError ?? liveKeyError ?? undefined;
          const removedParts = draft?.ok ? draft.removed : [];

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
                        {meta.emptyNote ?? 'no keys — using platform default'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-fg-muted mt-0.5">{meta.help}</p>
                  {meta.guidance && (
                    <p className="text-2xs text-fg-faint mt-0.5">{meta.guidance}</p>
                  )}
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
                      resetAddForm();
                    }}
                  >
                    {isOpen ? 'Cancel' : '+ Add key'}
                  </Btn>
                </div>
              </div>

              {noticeHere(`provider:${provider}`)}

              {/* Key list */}
              {providerKeys.length > 0 && (
                <div className="divide-y divide-edge/50">
                  {providerKeys.map((k) => {
                    const chip = STATUS_CHIP[k.status];
                    const isExpired = k.cooldown_until && new Date(k.cooldown_until) > new Date();
                    const canEnable = k.status === 'disabled' && k.test_status === 'ok';
                    return (
                      <div key={k.id}>
                        <div className="flex items-center gap-3 px-3 py-2">
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
                            {/* Icon suppressed while loading — Btn puts its
                              spinner in the leading slot, so passing both
                              would render spinner *and* glyph. */}
                            <Tooltip content="Test key">
                              <Btn
                                size="sm"
                                variant="ghost"
                                type="button"
                                className="px-2"
                                aria-label={`Test key ${k.key_hint ?? k.label ?? ''}`.trim()}
                                loading={testPending === k.id}
                                onClick={() => void testKey(k)}
                              >
                                {testPending === k.id ? null : <IconPlay />}
                              </Btn>
                            </Tooltip>
                            {/* Left as text: the label is dynamic across three
                              states (Disable / Enable / Test first) and no
                              single glyph carries that. */}
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
                            <Tooltip content="Remove key">
                              <Btn
                                size="sm"
                                variant="ghost"
                                type="button"
                                className="px-2"
                                aria-label={`Remove key ${k.key_hint ?? k.label ?? ''}`.trim()}
                                onClick={() => setRemoveTarget(k)}
                              >
                                <IconTrash />
                              </Btn>
                            </Tooltip>
                          </div>
                        </div>
                        {noticeHere(k.id)}
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
                      <div key={k.id}>
                        <div className="flex items-center gap-3 px-3 py-2 bg-warn/5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-2xs text-fg-secondary">
                                {k.key_hint ?? '…****'}
                              </span>
                              <span className="text-2xs text-fg-muted italic">
                                legacy credential
                              </span>
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
                            <Tooltip content="Test key">
                              <Btn
                                size="sm"
                                variant="ghost"
                                type="button"
                                className="px-2"
                                aria-label={`Test legacy key ${k.key_hint ?? k.label ?? ''}`.trim()}
                                loading={testPending === k.id}
                                onClick={() => void testKey(k)}
                              >
                                {testPending === k.id ? null : <IconPlay />}
                              </Btn>
                            </Tooltip>
                            <Tooltip content="Remove key">
                              <Btn
                                size="sm"
                                variant="ghost"
                                type="button"
                                className="px-2"
                                aria-label={`Remove legacy key ${k.key_hint ?? k.label ?? ''}`.trim()}
                                onClick={() => setRemoveTarget(k)}
                              >
                                <IconTrash />
                              </Btn>
                            </Tooltip>
                          </div>
                        </div>
                        {noticeHere(k.id)}
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
                      <SecretInput
                        value={newKeyVal}
                        onChange={(e) => {
                          setNewKeyVal(e.target.value);
                          setKeyError(null);
                        }}
                        onPaste={() => setKeyTouched(true)}
                        onBlur={() => {
                          if (newKeyVal.trim()) setKeyTouched(true);
                        }}
                        placeholder={meta.placeholder}
                        error={visibleKeyError}
                        autoFocus
                      />
                      {!visibleKeyError && removedParts.length > 0 && (
                        <RemovedHint removed={removedParts} />
                      )}
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
                        onChange={(e) => {
                          setNewBaseUrl(e.target.value);
                          setBaseUrlError(null);
                        }}
                        placeholder="https://openrouter.ai/api/v1"
                        autoComplete="url"
                        error={baseUrlError ?? undefined}
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
                    {formError && <ResultChip tone="error">{formError}</ResultChip>}
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
