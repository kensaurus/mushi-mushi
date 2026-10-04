/**
 * FILE: apps/admin/src/components/settings/ByokPanel.tsx
 * PURPOSE: Settings → AI keys. One row per provider (logo, what it does,
 *          whether it works, the one thing to do), and under it each saved
 *          key with its own plain-English status and buttons. Several keys
 *          per provider form a pool: when one runs out, the next is tried.
 *
 *          Every status comes from keyStatus.ts, the same rules the page
 *          banner and the tab badge use.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { Input, SecretInput, Btn, ErrorAlert, ResultChip, Tooltip } from '../ui';
import { BrandIcon } from '../ui/BrandIcon';
import { IconPlay, IconTrash } from '../icons';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { ConfirmDialog } from '../ConfirmDialog';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import { LINK_ACCENT } from '../../lib/chipTone';
import { prepareByokSecret } from '../../lib/byokKeyRules';
import { describeByokError } from '../../lib/byokErrors';
import type { PoolKey, PoolTestStatus } from './byokPool';
import { useByokPool } from './ByokPoolContext';
import { usePageData } from '../../lib/usePageData';
import { creditsLine, spendLine, type ByokCreditsResponse } from './byokCredits';
import {
  isLegacyKey,
  keyStatusView,
  providerStatusView,
  type KeyStatusView,
  type LegacyKey,
  type ManagedKey,
} from './keyStatus';
import { RowStatus, SettingsList, SettingsRow } from './SettingsRow';

interface ProviderMeta {
  name: string;
  /** One line: what Mushi uses this provider for. */
  purpose: string;
  placeholder: string;
  consoleUrl: string;
  /** Shown when the provider has no key. */
  emptyDetail: string;
  /** Extra setup steps shown in the add form. */
  guidance?: string;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  anthropic: {
    name: 'Anthropic (Claude)',
    purpose: 'Reads each bug report, writes the diagnosis, and drafts the fix.',
    placeholder: 'sk-ant-api03-…',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    emptyDetail: "Using Mushi's shared key. Add yours to bill your own Anthropic account.",
  },
  openai: {
    name: 'OpenAI',
    purpose: 'Backup when Anthropic is unavailable, search embeddings, and speech-to-text for voice reports.',
    placeholder: 'sk-proj-…',
    consoleUrl: 'https://platform.openai.com/api-keys',
    emptyDetail: "No backup key of your own. Mushi's shared backup is used when the server has one.",
  },
  openrouter: {
    name: 'OpenRouter',
    purpose: 'One key for many models. Used as a backup after your OpenAI keys (not for speech-to-text or fine-tuning).',
    placeholder: 'sk-or-v1-…',
    consoleUrl: 'https://openrouter.ai/settings/keys',
    emptyDetail: 'Optional. Add a key to use OpenRouter as a backup and see its remaining credits here.',
  },
  cursor: {
    name: 'Cursor cloud agent',
    purpose: 'Lets Mushi hand a fix to a Cursor cloud agent, which opens a pull request.',
    placeholder: 'crsr_…',
    consoleUrl: 'https://cursor.com/dashboard/integrations',
    emptyDetail: 'Add a key to send fixes to Cursor.',
  },
  firecrawl: {
    name: 'Firecrawl',
    purpose: 'Reads public web pages, such as library docs, while diagnosing and mapping your app.',
    placeholder: 'fc-…',
    consoleUrl: 'https://www.firecrawl.dev/app/api-keys',
    emptyDetail: "No key of your own. Web tools use Mushi's shared key when the server has one.",
  },
  browserbase: {
    name: 'Browserbase',
    purpose: 'Runs your scheduled browser tests in a cloud browser on your own account.',
    placeholder: 'bb-…',
    consoleUrl: 'https://www.browserbase.com/settings',
    emptyDetail: "No key of your own. Scheduled browser tests use Mushi's shared account when the server has one.",
  },
  supabase: {
    name: 'Supabase (read-only)',
    purpose: "Lets diagnoses read your app's database structure, advisors, functions and logs. Mushi never writes to it.",
    placeholder: 'sbp_…',
    consoleUrl: 'https://supabase.com/dashboard/account/tokens',
    emptyDetail: 'Not linked. Diagnoses work without it, but miss your database.',
    guidance:
      'Create a scoped token: this one project only; Database, Edge Functions, Advisors and Logs set to Read and nothing else; with an expiry date (copy that date into "Expires on" below). Save the project ref under General first, because the token is checked against it.',
  },
};

// Kept on one line: byok-lifecycle-contract.test.ts asserts the provider order.
// prettier-ignore
const DISPLAY_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'cursor', 'firecrawl', 'browserbase', 'supabase'] as const;

type ValidationReply =
  | {
      validation?: { status?: PoolTestStatus; detail?: string };
      /** The pooled copy of the legacy key validated, so the legacy slot was cleared. */
      legacyRetired?: boolean;
      /** A working pooled key now shadows a different legacy key. */
      legacySuperseded?: boolean;
      /** The key saved but its expiry date did not. */
      expiryWarning?: string;
    }
  | undefined;

/**
 * Feedback shown beside what caused it: a key row (`scope` = key id) or a
 * provider row (`scope` = `provider:<slug>`), never a chip at the top.
 */
interface Notice {
  scope: string;
  ok: boolean;
  message: string;
}

/** What normalization stripped, e.g. "We removed OPENAI_API_KEY= from what you pasted." */
function RemovedHint({ removed }: { removed: string[] }) {
  return (
    <p className="text-xs text-fg-muted">
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

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The provider row's main button, from what its status asks for. */
function providerActionLabel(view: KeyStatusView, keyCount: number): string {
  if (keyCount === 0) return 'Add key';
  if (view.action === 'replace') return 'Replace key';
  if (view.action === 'add_backup') return 'Add backup key';
  return 'Add another key';
}

export function ByokPanel() {
  const entitlements = useEntitlements();
  const byokLocked = !entitlements.loading && !entitlements.has('byok');
  const pool = useByokPool(!byokLocked);
  // Free reads: the provider's own balance where it publishes one, and what
  // Mushi recorded spending through each provider in the last 30 days.
  const credits = usePageData<ByokCreditsResponse>(byokLocked ? null : '/v1/admin/byok/credits');

  const [addProvider, setAddProvider] = useState<string | null>(null);
  const [newKeyVal, setNewKeyVal] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [adding, setAdding] = useState(false);
  // Add-form errors, each shown where it belongs: under the key field, under
  // the base URL field, or beside the Save button.
  const [keyTouched, setKeyTouched] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ManagedKey | null>(null);
  const [disableTarget, setDisableTarget] = useState<PoolKey | null>(null);
  const [removing, setRemoving] = useState(false);
  const [togglePending, setTogglePending] = useState<string | null>(null);
  const [testPending, setTestPending] = useState<string | null>(null);
  const [expiryEdit, setExpiryEdit] = useState<{ id: string; value: string } | null>(null);
  const [expirySaving, setExpirySaving] = useState(false);

  const reload = pool.reload;

  function resetAddForm() {
    setNewKeyVal('');
    setNewKeyLabel('');
    setNewBaseUrl('');
    setNewExpiry('');
    setKeyTouched(false);
    setKeyError(null);
    setBaseUrlError(null);
    setFormError(null);
  }

  function openAddForm(provider: string) {
    resetAddForm();
    setAddProvider(addProvider === provider ? null : provider);
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
        expiresAt: newExpiry || undefined,
      }),
    });
    setAdding(false);
    if (res.ok) {
      const data = res.data as ValidationReply;
      const validated = data?.validation?.status === 'ok';
      const base = validated
        ? data?.legacyRetired
          ? 'Key checked and in use. It was the same as your old key, so the old copy was removed.'
          : data?.legacySuperseded
            ? 'Key checked and in use. Your old key is no longer needed; remove it below.'
            : 'Key checked and in use.'
        : quarantinedMessage(data, "Key saved, but the provider didn't accept it, so Mushi won't use it yet.");
      setNotice({
        scope: `provider:${provider}`,
        ok: validated && !data?.expiryWarning,
        message: data?.expiryWarning ? `${base} ${data.expiryWarning}` : base,
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
        ok: true,
        message: isLegacyKey(removeTarget) ? 'Old key removed.' : 'Key removed.',
      });
      reload();
    } else {
      setNotice({
        scope: removeTarget.id,
        ok: false,
        message: describeByokError(res.error, 'The key was not removed. Retry in a moment.').message,
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
        ok: false,
        message: describeByokError(res.error, 'The key was not updated. Retry in a moment.').message,
      });
    }
    reload();
  }

  async function saveExpiry(key: PoolKey, value: string) {
    setExpirySaving(true);
    const res = await apiFetch(`/v1/admin/byok/keys/${key.id}/expiry`, {
      method: 'PUT',
      body: JSON.stringify({ expiresAt: value || null }),
    });
    setExpirySaving(false);
    if (res.ok) {
      setExpiryEdit(null);
      setNotice({
        scope: key.id,
        ok: true,
        message: value ? 'Expiry date saved. Mushi will warn you a week before.' : 'Expiry date removed.',
      });
      reload();
    } else {
      setNotice({
        scope: key.id,
        ok: false,
        message: describeByokError(res.error, 'The expiry date was not saved. Retry in a moment.').message,
      });
    }
  }

  async function testKey(key: ManagedKey) {
    setTestPending(key.id);
    setNotice(null);
    const name = PROVIDER_META[key.provider_slug]?.name ?? key.provider_slug;
    if (isLegacyKey(key)) {
      const res = await apiFetch<{ status: PoolTestStatus; detail: string; latencyMs: number }>(
        `/v1/admin/byok/${key.provider_slug}/test`,
        { method: 'POST' },
      );
      setTestPending(null);
      if (res.ok && res.data) {
        setNotice({
          scope: key.id,
          ok: res.data.status === 'ok',
          message:
            res.data.status === 'ok'
              ? `${name} accepted this key (${res.data.latencyMs} ms).`
              : `${name} didn't accept this key. ${res.data.detail}`,
        });
      } else {
        setNotice({
          scope: key.id,
          ok: false,
          message: describeByokError(res.error, 'The test did not run. Retry in a moment.').message,
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
        ok: validated,
        message: validated
          ? data?.legacySuperseded
            ? `${name} accepted this key. Your old key is no longer needed; remove it below.`
            : `${name} accepted this key.`
          : quarantinedMessage(data, `${name} didn't accept this key, so Mushi won't use it.`),
      });
    } else {
      setNotice({
        scope: key.id,
        ok: false,
        message: describeByokError(res.error, 'The test did not run. Retry in a moment.').message,
      });
    }
    reload();
  }

  if (byokLocked) {
    return (
      <SettingsList title="AI keys">
        <div className="py-3">
          <UpgradePrompt flag="byok" currentPlan={entitlements.planName} />
        </div>
      </SettingsList>
    );
  }

  if (entitlements.loading || pool.loading)
    return <PanelSkeleton rows={4} label="Loading your keys" inCard={false} />;
  if (pool.error)
    return <ErrorAlert message={`Couldn't load your keys: ${pool.error}`} onRetry={reload} />;

  const allKeys = pool.data?.keys ?? [];
  const legacyKeys = pool.data?.legacyKeys ?? [];

  const noticeHere = (scope: string) =>
    notice?.scope === scope ? (
      <ResultChip tone={notice.ok ? 'success' : 'error'}>{notice.message}</ResultChip>
    ) : null;

  // A plain function, not a component: a component defined in render would
  // remount on every keystroke and drop focus from the expiry field.
  function keyLine(k: ManagedKey) {
    const meta = PROVIDER_META[k.provider_slug];
    const view = keyStatusView(k, { pool: allKeys, providerName: meta?.name });
    const legacy = isLegacyKey(k);
    const poolKey = legacy ? null : (k as PoolKey);
    const canEnable = poolKey?.status === 'disabled' && k.test_status === 'ok';
    const editingExpiry = poolKey && expiryEdit?.id === poolKey.id;
    const expires = poolKey ? formatDay(poolKey.expires_at) : null;
    const hint = k.key_hint ?? '…****';
    const name = `${legacy ? 'old ' : ''}key ${hint}`;
    return (
      <li
        key={k.id}
        className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-mono text-fg-secondary">{hint}</span>
            {legacy ? (
              <span className="text-fg-muted">legacy credential (saved before key pools)</span>
            ) : k.label ? (
              <span className="text-fg-muted">{k.label}</span>
            ) : null}
          </p>
          <RowStatus status={view} />
          {(() => {
            const kc = !legacy ? credits.data?.keys?.find((c) => c.id === k.id) : undefined;
            if (!kc) return null;
            const line = creditsLine(kc.credits);
            const toneClass =
              line.tone === 'low' ? 'text-warn' : line.tone === 'error' ? 'text-danger' : line.tone === 'ok' ? 'text-fg-secondary' : 'text-fg-muted';
            return <p className={`text-xs ${toneClass}`}>{line.text}</p>;
          })()}
          <p className="text-xs text-fg-muted">
            {k.created_at ? `Added ${formatDay(k.created_at)}` : 'Added before key history'}
            {expires ? ` · expires ${expires}` : ''}
            {k.base_url ? ` · endpoint ${k.base_url}` : ''}
          </p>
          {editingExpiry && poolKey && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveExpiry(poolKey, expiryEdit.value);
              }}
            >
              <Input
                label="Expires on"
                type="date"
                value={expiryEdit.value}
                onChange={(e) => setExpiryEdit({ id: poolKey.id, value: e.target.value })}
              />
              <Btn type="submit" size="sm" loading={expirySaving}>
                Save date
              </Btn>
              <Btn type="button" size="sm" variant="ghost" onClick={() => setExpiryEdit(null)}>
                Cancel
              </Btn>
            </form>
          )}
          {noticeHere(k.id)}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {view.action === 'remove' ? (
            <Btn size="sm" variant="primary" type="button" onClick={() => setRemoveTarget(k)}>
              {legacy ? 'Remove old key' : 'Remove key'}
            </Btn>
          ) : view.action === 'replace' ? (
            <Btn size="sm" variant="primary" type="button" onClick={() => openAddForm(k.provider_slug)}>
              Replace key
            </Btn>
          ) : null}
          <Tooltip content="Check this key with the provider now">
            <Btn
              size="sm"
              variant="ghost"
              type="button"
              aria-label={`Test ${name}`}
              loading={testPending === k.id}
              onClick={() => void testKey(k)}
            >
              {testPending === k.id ? null : <IconPlay />}
              Test
            </Btn>
          </Tooltip>
          {poolKey && (
            <Btn
              size="sm"
              variant="ghost"
              type="button"
              loading={togglePending === poolKey.id}
              disabled={poolKey.status !== 'active' && !canEnable}
              title={
                poolKey.status !== 'active' && !canEnable
                  ? 'Test the key first; only a key the provider accepts can be turned on.'
                  : undefined
              }
              onClick={() =>
                // Turning a working key off changes which key the pipeline
                // uses, so it is confirmed; turning one on is not.
                poolKey.status === 'active' ? setDisableTarget(poolKey) : void toggleKey(poolKey)
              }
            >
              {poolKey.status === 'active' ? 'Turn off' : canEnable ? 'Turn on' : 'Test first'}
            </Btn>
          )}
          {poolKey && !editingExpiry && (
            <Btn
              size="sm"
              variant="ghost"
              type="button"
              onClick={() =>
                setExpiryEdit({ id: poolKey.id, value: poolKey.expires_at?.slice(0, 10) ?? '' })
              }
            >
              {expires ? 'Change expiry' : 'Add expiry date'}
            </Btn>
          )}
          {view.action !== 'remove' && (
            <Tooltip content="Remove this key">
              <Btn
                size="sm"
                variant="ghost"
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => setRemoveTarget(k)}
              >
                <IconTrash />
              </Btn>
            </Tooltip>
          )}
        </div>
      </li>
    );
  }

  return (
    <>
      <SettingsList
        title="AI keys"
        description="Keys for the AI and web services Mushi uses for this project. They are stored encrypted and billed to your own accounts. Add more than one key for a service and Mushi switches to the next when one runs out."
      >
        {DISPLAY_PROVIDERS.map((provider) => {
          const meta = PROVIDER_META[provider];
          if (!meta) return null;
          const providerKeys = allKeys
            .filter((k) => k.provider_slug === provider)
            .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
          const providerLegacyKeys = legacyKeys.filter((k: LegacyKey) => k.provider_slug === provider);
          const keyCount = providerKeys.length + providerLegacyKeys.length;
          const view = providerStatusView(provider, allKeys, legacyKeys, {
            providerName: meta.name,
            emptyDetail: meta.emptyDetail,
          });
          const isOpen = addProvider === provider;
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
            <SettingsRow
              key={provider}
              id={`key-${provider}`}
              icon={<BrandIcon brand={provider} size={18} decorative />}
              title={meta.name}
              purpose={meta.purpose}
              status={view}
              action={
                <>
                  <a
                    href={meta.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-sm ${LINK_ACCENT}`}
                  >
                    Get a key ↗
                  </a>
                  <Btn
                    size="sm"
                    variant={keyCount === 0 || view.state === 'attention' ? 'primary' : 'ghost'}
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => openAddForm(provider)}
                  >
                    {isOpen ? 'Cancel' : providerActionLabel(view, keyCount)}
                  </Btn>
                </>
              }
            >
              {noticeHere(`provider:${provider}`)}
              {Array.isArray(credits.data?.spend30d) && (provider === 'anthropic' || provider === 'openai' || provider === 'openrouter') && (
                <p className="text-xs text-fg-muted">
                  {spendLine(credits.data?.spend30d?.find((s) => s.provider === provider))}
                </p>
              )}
              {keyCount > 0 && (
                <ul className="divide-y divide-edge-subtle border-t border-edge-subtle">
                  {providerKeys.map(keyLine)}
                  {providerLegacyKeys.map(keyLine)}
                </ul>
              )}
              {isOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addKey(provider);
                  }}
                  className="space-y-3 border-t border-edge-subtle pt-3"
                >
                  {meta.guidance && <p className="text-sm text-fg-muted">{meta.guidance}</p>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <SecretInput
                        label="Key"
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
                    <Input
                      label="Name (optional)"
                      type="text"
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      placeholder="e.g. personal, team, backup"
                    />
                    <Input
                      label="Expires on (optional)"
                      type="date"
                      value={newExpiry}
                      onChange={(e) => setNewExpiry(e.target.value)}
                      tooltip="If the provider gave the key an expiry date, enter it and Mushi warns you a week before."
                    />
                    {provider === 'openai' && (
                      <div className="space-y-1">
                        <Input
                          label="Base URL (optional, for other OpenAI-compatible services such as Azure or Together)"
                          type="url"
                          value={newBaseUrl}
                          onChange={(e) => {
                            setNewBaseUrl(e.target.value);
                            setBaseUrlError(null);
                          }}
                          placeholder="https://your-host.example.com/v1"
                          autoComplete="url"
                          error={baseUrlError ?? undefined}
                        />
                        <p className="text-xs text-fg-muted">
                          https only. Known hosted providers are allowed.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Btn type="submit" size="sm" loading={adding}>
                      Save &amp; validate
                    </Btn>
                    {formError && <ResultChip tone="error">{formError}</ResultChip>}
                  </div>
                  <p className="text-xs text-fg-muted">
                    Mushi checks the key with {meta.name} before using it.
                    {keyCount > 0 && ' A new key is tried after your existing ones.'}
                  </p>
                </form>
              )}
            </SettingsRow>
          );
        })}
      </SettingsList>

      {disableTarget && (
        <ConfirmDialog
          title={`Turn off this ${PROVIDER_META[disableTarget.provider_slug]?.name ?? disableTarget.provider_slug} key?`}
          body={`Mushi stops using the key ending in ${disableTarget.key_hint ?? '****'} and switches to your next key for this service, or its shared key where there is one. To turn it back on later, press Test and then Turn on.`}
          confirmLabel="Turn off key"
          cancelLabel="Keep it on"
          tone="danger"
          loading={togglePending === disableTarget.id}
          onConfirm={async () => {
            await toggleKey(disableTarget)
            setDisableTarget(null)
          }}
          onCancel={() => {
            if (togglePending !== disableTarget.id) setDisableTarget(null)
          }}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          title={`Remove this ${PROVIDER_META[removeTarget.provider_slug]?.name ?? removeTarget.provider_slug} key?`}
          body={`The ${isLegacyKey(removeTarget) ? 'old key' : 'key'} ending in ${removeTarget.key_hint ?? '****'} is deleted for good. Mushi then uses your other keys for this service, or its shared key where there is one.`}
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
    </>
  );
}
