/**
 * FILE: apps/admin/src/components/settings/BrowserbasePanel.tsx
 * PURPOSE: Settings → Web tools → Browserbase. Browserbase runs scheduled QA
 *          story tests in a cloud Chromium. With your own key the
 *          recordings, network traces and screenshots stay in your
 *          Browserbase account; without one, runs use Mushi's shared account
 *          when the server has one.
 *
 *          The key is added, tested and removed only in the AI keys tab (both
 *          tabs used to write the same saved-keys pool). This row shows the
 *          same status (keyStatus.ts), the session count, and links there.
 */

import { usePageData } from '../../lib/usePageData';
import { Btn, ErrorAlert } from '../ui';
import { BrandIcon } from '../ui/BrandIcon';
import { PanelSkeleton } from '../skeletons/PanelSkeleton';
import { useEntitlements } from '../../lib/useEntitlements';
import { UpgradePrompt } from '../billing/UpgradePrompt';
import { providerPoolKeys, selectPrimaryProviderKey } from './byokPool';
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
/** Where the Browserbase key is managed. */
const BROWSERBASE_KEY_HREF = '/settings?tab=byok#key-browserbase';

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
  const poolKey = selectPrimaryProviderKey(providerPoolKeys(allKeys, 'browserbase'), 'browserbase');
  const legacyKey = legacyKeys.find((k) => k.provider_slug === 'browserbase') ?? null;

  function reload() {
    reloadConfig();
    pool.reload();
  }

  if (byokLocked) {
    return (
      <SettingsList title="Browserbase (cloud browser)">
        <div className="py-3">
          <UpgradePrompt flag="byok" currentPlan={entitlements.planName} />
        </div>
      </SettingsList>
    );
  }

  if (entitlements.loading || loading || pool.loading) {
    return <PanelSkeleton rows={1} label="Loading Browserbase status" inCard={false} />;
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
    <SettingsList
      title="Browserbase (cloud browser)"
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
          <Btn size="sm" variant={configured ? 'ghost' : 'primary'} to={BROWSERBASE_KEY_HREF}>
            {configured ? 'Manage key in AI keys' : 'Add key in AI keys'}
          </Btn>
        }
      />
    </SettingsList>
  );
}
