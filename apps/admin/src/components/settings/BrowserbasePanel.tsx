/**
 * FILE: apps/admin/src/components/settings/BrowserbasePanel.tsx
 * PURPOSE: Settings → Cloud browser. Browserbase runs scheduled QA story tests
 *          in a cloud Chromium. With your own key the recordings, network
 *          traces and screenshots stay in your Browserbase account; without
 *          one, runs use Mushi's shared account when the server has one.
 *
 *          Status comes from the shared saved-keys list (keyStatus.ts), like
 *          the AI keys tab. Keys go to the pool ('/v1/admin/byok/keys'); a key
 *          saved before pools existed (legacy BYOK) is tested and removed
 *          through the single-key routes.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { Btn, ErrorAlert, ResultChip, SecretInput } from '../ui';
import { BrandIcon } from '../ui/BrandIcon';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { ConfirmDialog } from '../ConfirmDialog';
import { SettingsFormFooter } from './SettingsFormFooter';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import { describeByokError, describeByokTestResult } from '../../lib/byokErrors';
import { providerPoolKeys, selectPrimaryProviderKey, type PoolTestStatus } from './byokPool';
import { useByokPool } from './ByokPoolContext';
import { providerStatusView } from './keyStatus';
import { SettingsList, SettingsRow } from './SettingsRow';

interface BrowserbaseConfig {
  configured: boolean;
  keyHint: string | null;
  addedAt: string | null;
  lastUsedAt: string | null;
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null;
  testedAt: string | null;
  sessionCount: number | null;
}

const NAME = 'Browserbase';

export function BrowserbasePanel() {
  const entitlements = useEntitlements();
  const byokLocked = !entitlements.loading && !entitlements.has('byok');
  const {
    data,
    loading,
    error,
    reload: reloadConfig,
  } = usePageData<BrowserbaseConfig>('/v1/admin/byok/browserbase');
  const pool = useByokPool(!byokLocked);
  const cfg = data ?? null;
  const allKeys = pool.data?.keys ?? [];
  const legacyKeys = pool.data?.legacyKeys ?? [];
  const poolKeys = providerPoolKeys(allKeys, 'browserbase');
  const poolKey = selectPrimaryProviderKey(poolKeys, 'browserbase');
  const legacyKey = legacyKeys.find((k) => k.provider_slug === 'browserbase') ?? null;

  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const keyDirty = keyDraft.trim().length >= 8;

  function resetDraft() {
    setKeyDraft('');
    setFeedback(null);
  }

  function reload() {
    reloadConfig();
    pool.reload();
  }

  async function save() {
    if (!keyDirty) return;
    setPending(true);
    setFeedback(null);
    const res = await apiFetch('/v1/admin/byok/keys', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'browserbase',
        key: keyDraft.trim(),
        label: 'Browserbase settings',
      }),
    });
    setPending(false);
    if (res.ok) {
      const result = res.data as
        | { validation?: { status?: PoolTestStatus; latencyMs?: number; detail?: string } }
        | undefined;
      const view = describeByokTestResult(result?.validation ?? {}, NAME);
      setKeyDraft('');
      setFeedback({
        ok: view.ok,
        message: view.ok
          ? `Saved. ${view.message}`
          : `Saved, but Mushi won't use the key until a test passes. ${view.message}`,
      });
      reload();
    } else {
      setFeedback({
        ok: false,
        message: describeByokError(res.error, 'The key was not saved. Retry in a moment.').message,
      });
    }
  }

  async function confirmClearKey() {
    setPending(true);
    setFeedback(null);
    const res = poolKey
      ? await apiFetch(`/v1/admin/byok/keys/${poolKey.id}`, { method: 'DELETE' })
      : await apiFetch('/v1/admin/byok/browserbase', { method: 'DELETE' });
    setPending(false);
    setConfirmingClear(false);
    if (res.ok) {
      setKeyDraft('');
      setFeedback({
        ok: true,
        message: 'Key removed. Any other working Browserbase key takes over automatically.',
      });
      reload();
    } else {
      setFeedback({
        ok: false,
        message: describeByokError(res.error, 'The key was not removed. Retry in a moment.').message,
      });
    }
  }

  async function testKey() {
    setTesting(true);
    setFeedback(null);
    if (poolKey) {
      const res = await apiFetch<{
        validation: { status: string; latencyMs: number; detail: string };
      }>(`/v1/admin/byok/keys/${poolKey.id}/test`, { method: 'POST' });
      setTesting(false);
      if (res.ok && res.data) {
        setFeedback(describeByokTestResult(res.data.validation, NAME));
        reload();
      } else {
        setFeedback({
          ok: false,
          message: describeByokError(res.error, 'The test did not run. Retry in a moment.').message,
        });
      }
      return;
    }

    const res = await apiFetch<{ status: string; latencyMs: number; detail: string }>(
      '/v1/admin/byok/browserbase/test',
      { method: 'POST' },
    );
    setTesting(false);
    if (res.ok && res.data) {
      setFeedback(describeByokTestResult(res.data, NAME));
      reload();
    } else {
      setFeedback({
        ok: false,
        message: describeByokError(res.error, 'The test did not run. Retry in a moment.').message,
      });
    }
  }

  if (byokLocked) {
    return (
      <SettingsList title="Cloud browser (Browserbase)">
        <div className="py-3">
          <UpgradePrompt flag="byok" currentPlan={entitlements.planName} />
        </div>
      </SettingsList>
    );
  }

  if (entitlements.loading || loading || pool.loading) {
    return <PanelSkeleton rows={2} label="Loading Browserbase status" inCard={false} />;
  }
  if (error || pool.error) {
    return (
      <ErrorAlert
        message={`Couldn't load the Browserbase settings: ${error ?? pool.error}`}
        onRetry={reload}
      />
    );
  }

  const configured = Boolean(poolKey || legacyKey || cfg?.configured);
  const status = providerStatusView('browserbase', allKeys, legacyKeys, {
    providerName: NAME,
    emptyDetail: "No key of your own. Cloud browser tests use Mushi's shared account when the server has one.",
  });
  const keyHint = poolKey?.key_hint ?? legacyKey?.key_hint ?? cfg?.keyHint ?? null;
  const sessions = cfg?.sessionCount ?? 0;

  return (
    <>
      <SettingsList
        title="Cloud browser (Browserbase)"
        description="Optional. Runs your scheduled browser tests in a cloud browser. With your own key, the recordings and screenshots stay in your Browserbase account."
      >
        <SettingsRow
          icon={<BrandIcon brand="browserbase" size={18} decorative />}
          title="Browserbase key"
          purpose={
            keyHint ? (
              <>
                Your key <span className="font-mono">{keyHint}</span>
                {sessions > 0 ? ` has run ${sessions} test session${sessions === 1 ? '' : 's'}.` : '.'}
              </>
            ) : (
              'Use your own Browserbase account for test runs.'
            )
          }
          status={status}
          action={
            configured ? (
              <>
                <Btn size="sm" variant="ghost" onClick={testKey} loading={testing}>
                  Test
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setConfirmingClear(true)} disabled={pending}>
                  Remove
                </Btn>
              </>
            ) : (
              <a
                href="https://www.browserbase.com/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-foreground underline underline-offset-2"
              >
                Get a key ↗
              </a>
            )
          }
        >
          <SecretInput
            label={configured ? 'Replace the key' : 'Paste your Browserbase key'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="bb-…"
          />
          {testing && !feedback ? (
            <ResultChip tone="running">Testing…</ResultChip>
          ) : feedback ? (
            <ResultChip tone={feedback.ok ? 'success' : 'error'}>{feedback.message}</ResultChip>
          ) : null}
        </SettingsRow>
      </SettingsList>

      <SettingsFormFooter
        dirty={keyDirty}
        saving={pending}
        changeCount={keyDirty ? 1 : 0}
        onSave={() => void save()}
        onDiscard={resetDraft}
        saveLabel="Save & validate"
      />

      {confirmingClear && (
        <ConfirmDialog
          title={poolKey ? 'Remove this Browserbase key?' : 'Remove your old Browserbase key?'}
          body={
            poolKey
              ? 'The key is deleted for good. Another working Browserbase key you saved takes over automatically.'
              : 'Browser tests switch to another working Browserbase key, or to the shared account when the server has one.'
          }
          confirmLabel="Remove key"
          cancelLabel="Keep key"
          tone="danger"
          loading={pending}
          onConfirm={() => void confirmClearKey()}
          onCancel={() => {
            if (!pending) setConfirmingClear(false);
          }}
        />
      )}
    </>
  );
}
