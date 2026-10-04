/**
 * FILE: apps/admin/src/components/settings/FirecrawlPanel.tsx
 * PURPOSE: Settings → Web crawl. Firecrawl reads public web pages (library
 *          docs, your live app) for Research, fix context and the library
 *          modernizer. Three rows: the key, which websites may be read, and
 *          how many pages one lookup may read.
 *
 *          The key's status comes from the same saved-keys list and rules as
 *          the AI keys tab (keyStatus.ts), so the two tabs always agree.
 *          Keys are added to the pool ('/v1/admin/byok/keys'); a key saved
 *          before pools existed (legacy BYOK) is tested and removed through
 *          the single-key routes.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { Btn, ErrorAlert, ResultChip, SecretInput } from '../ui';
import { BrandIcon } from '../ui/BrandIcon';
import { IconGlobe, IconGauge } from '../icons';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { ConfigHelp } from '../ConfigHelp';
import { ConfirmDialog } from '../ConfirmDialog';
import { SettingsChangeHint } from './SettingsChangeHint';
import { SettingsFormFooter } from './SettingsFormFooter';
import { countChangedFields, valuesEqual } from './settingsDiff';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import { describeByokError, describeByokTestResult } from '../../lib/byokErrors';
import { providerPoolKeys, selectPrimaryProviderKey, type PoolTestStatus } from './byokPool';
import { useByokPool } from './ByokPoolContext';
import { providerStatusView } from './keyStatus';
import { SettingsList, SettingsRow } from './SettingsRow';

interface FirecrawlConfig {
  configured: boolean;
  keyHint: string | null;
  addedAt: string | null;
  lastUsedAt: string | null;
  testStatus: 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null;
  testedAt: string | null;
  allowedDomains: string[];
  maxPagesPerCall: number;
}

const NAME = 'Firecrawl';

export function FirecrawlPanel() {
  const entitlements = useEntitlements();
  const byokLocked = !entitlements.loading && !entitlements.has('byok');
  const {
    data,
    loading,
    error,
    reload: reloadConfig,
  } = usePageData<FirecrawlConfig>('/v1/admin/byok/firecrawl');
  const pool = useByokPool(!byokLocked);
  const cfg = data ?? null;
  const allKeys = pool.data?.keys ?? [];
  const legacyKeys = pool.data?.legacyKeys ?? [];
  const poolKeys = providerPoolKeys(allKeys, 'firecrawl');
  const poolKey = selectPrimaryProviderKey(poolKeys, 'firecrawl');
  const legacyKey = legacyKeys.find((k) => k.provider_slug === 'firecrawl') ?? null;

  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [domainsDraft, setDomainsDraft] = useState<string | null>(null);
  const [pagesDraft, setPagesDraft] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (cfg && domainsDraft === null) setDomainsDraft(cfg.allowedDomains.join('\n'));
  if (cfg && pagesDraft === null) setPagesDraft(cfg.maxPagesPerCall);

  const savedDomains = cfg?.allowedDomains.join('\n') ?? '';
  const savedPages = cfg?.maxPagesPerCall ?? 5;
  const domains = domainsDraft ?? savedDomains;
  const pages = pagesDraft ?? savedPages;

  const domainsDirty = !valuesEqual(domains, savedDomains);
  const pagesDirty = !valuesEqual(pages, savedPages);
  const keyDirty = keyDraft.trim().length >= 8;
  const dirty = domainsDirty || pagesDirty || keyDirty;
  const changeCount = countChangedFields([
    { current: domains, saved: savedDomains },
    { current: pages, saved: savedPages },
    ...(keyDirty ? [{ current: keyDraft, saved: '' }] : []),
  ]);

  function reload() {
    reloadConfig();
    pool.reload();
  }

  function resetDraft() {
    setDomainsDraft(savedDomains);
    setPagesDraft(savedPages);
    setKeyDraft('');
  }

  async function save() {
    setPending(true);
    setFeedback(null);
    const allowedDomains = domains
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const configRes = await apiFetch('/v1/admin/byok/firecrawl', {
      method: 'PUT',
      body: JSON.stringify({
        allowedDomains,
        maxPagesPerCall: pages,
      }),
    });
    if (!configRes.ok) {
      setPending(false);
      setFeedback({
        ok: false,
        message: describeByokError(configRes.error, 'Your changes were not saved. Retry in a moment.').message,
      });
      return;
    }

    let validation: { status?: PoolTestStatus; latencyMs?: number; detail?: string } | undefined;
    if (keyDirty) {
      const keyRes = await apiFetch('/v1/admin/byok/keys', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'firecrawl',
          key: keyDraft.trim(),
          label: 'Firecrawl settings',
        }),
      });
      if (!keyRes.ok) {
        setPending(false);
        setFeedback({
          ok: false,
          message: `Websites and page limit saved, but the key was not added. ${
            describeByokError(keyRes.error, 'Retry in a moment.').message
          }`,
        });
        reload();
        return;
      }
      validation = (keyRes.data as { validation?: typeof validation } | undefined)?.validation;
    }

    setPending(false);
    setKeyDraft('');
    if (!keyDirty) {
      setFeedback({ ok: true, message: 'Saved.' });
    } else {
      const result = describeByokTestResult(validation ?? {}, NAME);
      setFeedback({
        ok: result.ok,
        message: result.ok
          ? `Saved. ${result.message}`
          : `Saved, but Mushi won't use the key until a test passes. ${result.message}`,
      });
    }
    reload();
  }

  async function confirmClearKey() {
    setPending(true);
    setFeedback(null);
    const res = poolKey
      ? await apiFetch(`/v1/admin/byok/keys/${poolKey.id}`, { method: 'DELETE' })
      : await apiFetch('/v1/admin/byok/firecrawl', { method: 'DELETE' });
    setPending(false);
    setConfirmingClear(false);
    if (res.ok) {
      setKeyDraft('');
      setFeedback({
        ok: true,
        message: 'Key removed. Any other working Firecrawl key takes over automatically.',
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
      '/v1/admin/byok/firecrawl/test',
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
      <SettingsList title="Web research (Firecrawl)">
        <div className="py-3">
          <UpgradePrompt flag="byok" currentPlan={entitlements.planName} />
        </div>
      </SettingsList>
    );
  }

  if (entitlements.loading || loading || pool.loading) {
    return <PanelSkeleton rows={3} label="Loading Firecrawl status" inCard={false} />;
  }
  if (error || pool.error) {
    return (
      <ErrorAlert
        message={`Couldn't load the Firecrawl settings: ${error ?? pool.error}`}
        onRetry={reload}
      />
    );
  }

  const configured = Boolean(poolKey || legacyKey || cfg?.configured);
  const status = providerStatusView('firecrawl', allKeys, legacyKeys, {
    providerName: NAME,
    emptyDetail: "No key of your own. Web research uses Mushi's shared key when the server has one.",
  });
  const keyHint = poolKey?.key_hint ?? legacyKey?.key_hint ?? cfg?.keyHint ?? null;

  return (
    <>
      <SettingsList
        title="Web research (Firecrawl)"
        description="Optional. Lets Mushi read public web pages, such as library docs, when it researches a bug or suggests a library update. Results are cached for a day."
      >
        <SettingsRow
          icon={<BrandIcon brand="firecrawl" size={18} decorative />}
          title="Firecrawl key"
          purpose={
            keyHint
              ? <>Your key <span className="font-mono">{keyHint}</span>{poolKeys.length > 1 ? `, plus ${poolKeys.length - 1} backup${poolKeys.length > 2 ? 's' : ''}` : ''}.</>
              : 'Use your own Firecrawl account instead of the shared one.'
          }
          status={status}
          action={
            configured ? (
              <>
                <Btn size="sm" variant="ghost" onClick={testKey} loading={testing}>
                  Test
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingClear(true)}
                  disabled={pending}
                >
                  Remove
                </Btn>
              </>
            ) : (
              <a
                href="https://www.firecrawl.dev/app/api-keys"
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
            label={configured ? 'Replace the key' : 'Paste your Firecrawl key'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="fc-…"
          />
          {testing && !feedback ? (
            <ResultChip tone="running">Testing…</ResultChip>
          ) : feedback ? (
            <ResultChip tone={feedback.ok ? 'success' : 'error'}>{feedback.message}</ResultChip>
          ) : null}
        </SettingsRow>

        <SettingsRow
          icon={<IconGlobe size={16} />}
          title="Allowed websites"
          purpose="Only these websites are read, one per line. Leave empty to allow any public website."
        >
          <label className="block">
            <span className="sr-only">Allowed websites, one per line</span>
            <textarea
              // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
              className="w-full min-h-[88px] rounded-sm border border-edge bg-surface-raised px-2 py-1.5 font-mono text-sm outline-none focus:border-accent"
              value={domains}
              onChange={(e) => setDomainsDraft(e.target.value)}
              placeholder={'github.com\nstackoverflow.com\nreact.dev'}
            />
          </label>
          <SettingsChangeHint current={domains} saved={savedDomains} />
        </SettingsRow>

        <SettingsRow
          icon={<IconGauge size={16} />}
          title="Pages per lookup"
          purpose="The most pages one lookup may read. Lower keeps costs down; higher finds more."
          status={
            <span className="flex items-center gap-1 text-sm text-fg-secondary">
              <span className="font-mono">{pages}</span> {pages === 1 ? 'page' : 'pages'}
              <ConfigHelp helpId="settings.firecrawl.max_pages_per_call" />
            </span>
          }
        >
          <input
            type="range"
            min="1"
            max="50"
            step="1"
            aria-label="Pages per lookup"
            className="w-full accent-brand"
            value={pages}
            onChange={(e) => setPagesDraft(parseInt(e.target.value, 10))}
          />
          <SettingsChangeHint current={pages} saved={savedPages} kind="number" />
        </SettingsRow>
      </SettingsList>

      <SettingsFormFooter
        dirty={dirty}
        saving={pending}
        changeCount={changeCount}
        onSave={() => void save()}
        onDiscard={resetDraft}
        saveLabel={keyDirty ? 'Save & validate' : 'Save changes'}
      />

      {confirmingClear && (
        <ConfirmDialog
          title={poolKey ? 'Remove this Firecrawl key?' : 'Remove your old Firecrawl key?'}
          body={
            poolKey
              ? 'The key is deleted for good. Another working Firecrawl key you saved takes over automatically.'
              : 'Research, fix context and library updates switch to another working Firecrawl key. With none, they stop until you add one.'
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
