/**
 * FILE: apps/admin/src/components/settings/FirecrawlPanel.tsx
 * PURPOSE: Settings → Web tools → Firecrawl. Firecrawl reads public web pages
 *          (library docs, your live app) for Research, fix context and the
 *          library modernizer. Three rows: whether a key is set, which
 *          websites may be read, and how many pages one lookup may read.
 *
 *          The key itself is added, tested and removed only in the AI keys
 *          tab: both used to write the same saved-keys pool, so two editors
 *          for one key was a duplicate. This row shows the same status
 *          (keyStatus.ts) and links there.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { Btn, ErrorAlert, ResultChip } from '../ui';
import { BrandIcon } from '../ui/BrandIcon';
import { IconGlobe, IconGauge } from '../icons';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { ConfigHelp } from '../ConfigHelp';
import { SettingsChangeHint } from './SettingsChangeHint';
import { SettingsFormFooter } from './SettingsFormFooter';
import { countChangedFields, valuesEqual } from './settingsDiff';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import { describeByokError } from '../../lib/byokErrors';
import { providerPoolKeys, selectPrimaryProviderKey } from './byokPool';
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
/** Where the Firecrawl key is managed. */
const FIRECRAWL_KEY_HREF = '/settings?tab=byok#key-firecrawl';

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
  const [domainsDraft, setDomainsDraft] = useState<string | null>(null);
  const [pagesDraft, setPagesDraft] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  if (cfg && domainsDraft === null) setDomainsDraft(cfg.allowedDomains.join('\n'));
  if (cfg && pagesDraft === null) setPagesDraft(cfg.maxPagesPerCall);

  const savedDomains = cfg?.allowedDomains.join('\n') ?? '';
  const savedPages = cfg?.maxPagesPerCall ?? 5;
  const domains = domainsDraft ?? savedDomains;
  const pages = pagesDraft ?? savedPages;

  const domainsDirty = !valuesEqual(domains, savedDomains);
  const pagesDirty = !valuesEqual(pages, savedPages);
  const dirty = domainsDirty || pagesDirty;
  const changeCount = countChangedFields([
    { current: domains, saved: savedDomains },
    { current: pages, saved: savedPages },
  ]);

  function reload() {
    reloadConfig();
    pool.reload();
  }

  function resetDraft() {
    setDomainsDraft(savedDomains);
    setPagesDraft(savedPages);
  }

  async function save() {
    setPending(true);
    setFeedback(null);
    const allowedDomains = domains
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await apiFetch('/v1/admin/byok/firecrawl', {
      method: 'PUT',
      body: JSON.stringify({
        allowedDomains,
        maxPagesPerCall: pages,
      }),
    });
    setPending(false);
    if (!res.ok) {
      setFeedback({
        ok: false,
        message: describeByokError(res.error, 'Your changes were not saved. Retry in a moment.').message,
      });
      return;
    }
    setFeedback({ ok: true, message: 'Saved.' });
    reload();
  }

  if (byokLocked) {
    return (
      <SettingsList title="Firecrawl (web pages)">
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
        title="Firecrawl (web pages)"
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
            <Btn size="sm" variant={configured ? 'ghost' : 'primary'} to={FIRECRAWL_KEY_HREF}>
              {configured ? 'Manage key in AI keys' : 'Add key in AI keys'}
            </Btn>
          }
        />

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
          {feedback ? (
            <ResultChip tone={feedback.ok ? 'success' : 'error'}>{feedback.message}</ResultChip>
          ) : null}
        </SettingsRow>
      </SettingsList>

      <SettingsFormFooter
        dirty={dirty}
        saving={pending}
        changeCount={changeCount}
        onSave={() => void save()}
        onDiscard={resetDraft}
        saveLabel="Save changes"
      />
    </>
  );
}
