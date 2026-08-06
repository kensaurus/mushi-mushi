/**
 * FILE: apps/admin/src/components/settings/BrowserbasePanel.tsx
 * PURPOSE: BYOK config for Browserbase — the cloud browser provider used by
 *          the QA Coverage story runner when provider = 'browserbase'. Without
 *          a project-scoped key the runner falls back to the platform global
 *          key (mushi_runtime_config), which means your QA traffic runs through
 *          Mushi's Browserbase account. Configure BYOK here to keep all
 *          browser session data in your own account.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { Section, Btn, ErrorAlert, ResultChip } from '../ui';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { ConfirmDialog } from '../ConfirmDialog';
import { SettingsFormFooter } from './SettingsFormFooter';
import { SettingsCard, SettingsPanelLayout } from './SettingsPanelLayout';
import { ConfiguredSecretField } from './ConfiguredSecretField';
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import {
  providerPoolKeys,
  selectPrimaryProviderKey,
  type PoolKey,
  type PoolTestStatus,
} from './byokPool';

interface BrowserbaseConfig {
  configured: boolean;
  keyHint: string | null;
  addedAt: string | null;
  lastUsedAt: string | null;
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null;
  testedAt: string | null;
  sessionCount: number | null;
}

const TEST_STATUS_LABEL: Record<
  NonNullable<BrowserbaseConfig['testStatus']>,
  { label: string; tone: 'ok' | 'warn' | 'danger' }
> = {
  ok: { label: 'Connection OK', tone: 'ok' },
  error_auth: { label: 'Auth failed — check your key', tone: 'danger' },
  error_network: { label: 'Network/endpoint error', tone: 'danger' },
  error_quota: { label: 'Quota / rate limit', tone: 'warn' },
};

export function BrowserbasePanel() {
  const entitlements = useEntitlements();
  const byokLocked = !entitlements.loading && !entitlements.has('byok');
  const {
    data,
    loading,
    error,
    reload: reloadConfig,
  } = usePageData<BrowserbaseConfig>('/v1/admin/byok/browserbase');
  const {
    data: poolData,
    loading: poolLoading,
    error: poolError,
    reload: reloadPool,
  } = usePageData<{ keys: PoolKey[] }>(byokLocked ? null : '/v1/admin/byok/keys');
  const cfg = data ?? null;
  const poolKeys = providerPoolKeys(poolData?.keys ?? [], 'browserbase');
  const poolKey = selectPrimaryProviderKey(poolKeys, 'browserbase');

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
    reloadPool();
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
        | { validation?: { status?: PoolTestStatus; latencyMs?: number } }
        | undefined;
      const status = result?.validation?.status;
      setKeyDraft('');
      setFeedback({
        ok: status === 'ok',
        message:
          status === 'ok'
            ? `Saved and validated${result?.validation?.latencyMs != null ? ` (${result.validation.latencyMs} ms)` : ''}.`
            : 'Saved but the provider did not validate this key. It will not be used until a test passes.',
      });
      reload();
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Failed to save.' });
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
        message: poolKey
          ? 'Selected pooled key removed. Any remaining validated key will take over automatically.'
          : 'Legacy key cleared. QA stories will fall back to the platform key.',
      });
      reload();
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Failed to clear key.' });
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
        const validation = res.data.validation;
        setFeedback({
          ok: validation.status === 'ok',
          message:
            validation.status === 'ok'
              ? `Connection OK (${validation.latencyMs} ms)`
              : `Test failed: ${validation.status} — ${validation.detail}`,
        });
        reload();
      } else {
        setFeedback({ ok: false, message: res.error?.message ?? 'Test failed.' });
      }
      return;
    }

    const res = await apiFetch<{ status: string; latencyMs: number; detail: string }>(
      '/v1/admin/byok/browserbase/test',
      { method: 'POST' },
    );
    setTesting(false);
    if (res.ok && res.data) {
      const okMsg =
        res.data.status === 'ok'
          ? `Connection OK (${res.data.latencyMs} ms)`
          : `Test failed: ${res.data.status} — ${res.data.detail}`;
      setFeedback({ ok: res.data.status === 'ok', message: okMsg });
      reload();
    } else {
      setFeedback({ ok: false, message: res.error?.message ?? 'Test failed.' });
    }
  }

  if (byokLocked) {
    return (
      <SettingsPanelLayout>
        <Section
          title="Browserbase (BYOK — Cloud Browser Sessions)"
          className="lg:col-span-2 space-y-3"
        >
          <UpgradePrompt flag="byok" currentPlan={entitlements.planName} />
        </Section>
      </SettingsPanelLayout>
    );
  }

  if (entitlements.loading || loading || poolLoading) {
    return <PanelSkeleton rows={2} label="Loading Browserbase status" inCard={false} />;
  }
  if (error || poolError) {
    return (
      <ErrorAlert
        message={`Failed to load Browserbase status: ${error ?? poolError}`}
        onRetry={reload}
      />
    );
  }

  const configured = Boolean(poolKey || cfg?.configured);
  const effectiveTestStatus = poolKey?.test_status ?? cfg?.testStatus ?? null;
  const keyHint = poolKey?.key_hint ?? cfg?.keyHint ?? null;
  const addedAt = poolKey?.created_at ?? cfg?.addedAt ?? null;
  const lastUsedAt = poolKey?.last_used_at ?? cfg?.lastUsedAt ?? null;
  const testedAt = poolKey?.last_tested_at ?? cfg?.testedAt ?? null;
  const statusMeta = effectiveTestStatus ? TEST_STATUS_LABEL[effectiveTestStatus] : null;

  return (
    <SettingsPanelLayout
      fullWidth={
        <ContainedBlock tone="muted">
          <p className="text-2xs leading-relaxed text-fg-muted">
            <strong className="text-fg-secondary">Optional integration.</strong> Bring your own{' '}
            <a
              href="https://www.browserbase.com"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Browserbase
            </a>{' '}
            key so QA Coverage story runs (provider: <span className="font-mono">browserbase</span>)
            use your account's sessions — keeping all browser recordings, HAR traces, and
            screenshots in your own Browserbase project. Without BYOK, runs share the platform pool
            key and session data transits Mushi's Browserbase account.
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
          saveLabel="Save & validate"
        />
      }
    >
      <Section
        title="Browserbase (BYOK — Cloud Browser Sessions)"
        className="lg:col-span-2 space-y-3"
      >
        {cfg && (
          <SettingsCard>
            <div className="flex items-center gap-2 flex-wrap">
              <SignalChip tone="brand">Browserbase</SignalChip>
              <SignalChip tone={configured ? 'ok' : 'neutral'}>
                {configured ? (poolKey ? 'pooled BYOK' : 'legacy BYOK') : 'platform key in use'}
              </SignalChip>
              {poolKeys.length > 1 && (
                <SignalChip tone="neutral">{poolKeys.length} pooled keys</SignalChip>
              )}
              {statusMeta && (
                <SignalChip
                  tone={
                    statusMeta.tone === 'ok' ? 'ok' : statusMeta.tone === 'warn' ? 'warn' : 'danger'
                  }
                >
                  {statusMeta.label}
                </SignalChip>
              )}
              {cfg.sessionCount != null && cfg.sessionCount > 0 && (
                <SignalChip tone="neutral">{cfg.sessionCount} sessions run</SignalChip>
              )}
            </div>

            {configured && (
              <InlineProof>
                Added {addedAt ? new Date(addedAt).toLocaleString() : 'unknown'}
                {lastUsedAt && <> · last used {new Date(lastUsedAt).toLocaleString()}</>}
                {testedAt && <> · tested {new Date(testedAt).toLocaleString()}</>}
              </InlineProof>
            )}

            <ConfiguredSecretField
              label="Browserbase API key"
              helpId="settings.browserbase.api_key"
              configured={configured}
              keyHint={keyHint}
              fallbackPrefix="bb-"
              value={keyDraft}
              onChange={setKeyDraft}
              placeholder="bb-…"
            />

            <div className="flex items-center gap-2 flex-wrap">
              {configured && (
                <>
                  <Btn size="sm" variant="ghost" onClick={testKey} loading={testing}>
                    Test connection
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingClear(true)}
                    disabled={pending}
                  >
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
            title={
              poolKey
                ? 'Remove the selected Browserbase pool key?'
                : 'Clear the legacy Browserbase API key?'
            }
            body={
              poolKey
                ? 'This removes the selected key and its Vault secret. Another validated pooled or legacy key can take over automatically.'
                : 'QA Coverage stories will fall back to the platform key until a validated pooled or legacy key is added.'
            }
            confirmLabel={poolKey ? 'Remove key' : 'Clear key'}
            cancelLabel="Keep key"
            tone="danger"
            loading={pending}
            onConfirm={() => void confirmClearKey()}
            onCancel={() => {
              if (!pending) setConfirmingClear(false);
            }}
          />
        )}
      </Section>
    </SettingsPanelLayout>
  );
}
