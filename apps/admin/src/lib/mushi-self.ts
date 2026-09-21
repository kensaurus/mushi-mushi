/**
 * FILE: apps/admin/src/lib/mushi-self.ts
 * PURPOSE: Initialize the Mushi web SDK inside the Mushi admin console so
 *          the admin itself can report bugs through the same pipeline it
 *          provides to customer apps. "Eating our own dog food" — every
 *          issue submitted from the admin goes to the mushi-self project
 *          where the team can triage it.
 *
 * ENV VARS (add to apps/admin/.env):
 *   VITE_MUSHI_SELF_PROJECT_ID   - The "mushi-self" project's project id
 *   VITE_MUSHI_SELF_API_KEY      - A per-project ingest API key
 *   VITE_MUSHI_SELF_API_ENDPOINT - (optional) override the cloud endpoint
 *
 * The SDK is initialised lazily (dynamic import) so the admin's initial
 * bundle stays lean. If the env vars are absent it's a no-op.
 *
 * The dynamic import MUST stay a plain `import('@mushi-mushi/web')` with no
 * `@vite-ignore`: that comment makes Rollup leave the bare specifier in the
 * production chunk, the browser rejects it (there is no importmap), and the
 * catch below turns the failure into a console warning — the deployed
 * console then dogfoods nothing while `vite dev` (which does resolve bare
 * names) looks fine. `mushi-self.test.ts` pins this.
 *
 * Launcher policy: the lime BetaBanner is the sole visible entry point.
 * The SDK widget uses `trigger: 'hidden'` + `runtimeConfig: false` so a
 * remote dashboard default cannot resurrect the FAB or a second banner.
 */

import type { MushiConfig, MushiSDKInstance } from '@mushi-mushi/core'
import { RESOLVED_API_URL } from './env'
import { Sentry } from './sentry'

let _sdk: MushiSDKInstance | null = null;
let _initPromise: Promise<MushiSDKInstance | null> | null = null;
const INIT_KEY = '__mushi_admin_self_init__';

function isEnabled(): boolean {
  return Boolean(
    import.meta.env.VITE_MUSHI_SELF_PROJECT_ID &&
    import.meta.env.VITE_MUSHI_SELF_API_KEY,
  );
}

/** True when the admin console dogfoods the Mushi web SDK (capture only; no FAB). */
export function isMushiSelfEnabled(): boolean {
  return isEnabled();
}

export async function initMushiSelf(options?: {
  userId?: string;
  activeProjectId?: string;
}): Promise<MushiSDKInstance | null> {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as Record<string, unknown>;
  // Init now runs pre-login; a later call with the freshly logged-in user
  // must still attribute the session even though the SDK already exists.
  // Always await `_initPromise` when it exists: `win[INIT_KEY]` flips to
  // `true` synchronously before the async init resolves and assigns `_sdk`,
  // so trusting the flag races — the pre-login call sets it, then the
  // logged-in re-render reads `_sdk` while it's still null and silently
  // skips `identify()`. The promise is the only reliable handle on the SDK.
  if (win[INIT_KEY] || _initPromise) {
    const sdk = _initPromise ? await _initPromise : _sdk;
    if (sdk && options?.userId) sdk.identify(options.userId, {});
    if (sdk && options?.activeProjectId) sdk.setMetadata('active_project_id', options.activeProjectId);
    return sdk;
  }
  if (!isEnabled()) return null;

  win[INIT_KEY] = true;

  _initPromise = (async () => {
    try {
      // Plain dynamic import on purpose — Vite code-splits it into a relative
      // chunk. See the header for why `@vite-ignore` must never come back.
      const { Mushi } = await import('@mushi-mushi/web');

      const endpoint =
        import.meta.env.VITE_MUSHI_SELF_API_ENDPOINT ||
        RESOLVED_API_URL;

      const config: MushiConfig = {
        projectId: import.meta.env.VITE_MUSHI_SELF_PROJECT_ID!,
        apiKey: import.meta.env.VITE_MUSHI_SELF_API_KEY!,
        apiEndpoint: endpoint,
        // Pin launcher locally — remote runtime config can overwrite trigger to
        // `auto` and resurrect the FAB (glot.it hit this in Capacitor WebView).
        runtimeConfig: false,

        // Console events carry `$surface: 'console'` (the SDK default is
        // 'web'), matching the surface packages/core/src/analytics-taxonomy.ts
        // declares for every console-owned event, so a per-surface split never
        // files console usage under the customer-widget 'web' surface.
        analytics: { surface: 'console' },

        widget: {
          position: 'bottom-right',
          theme: 'auto',
          mode: 'simple',
          locale: 'auto',
          trigger: 'hidden',
          smartHide: false,
          zIndex: 99999,
          betaMode: {
            enabled: true,
            appName: 'Mushi Admin',
            message: 'This is the Mushi admin console. Found a bug? Report it here and it goes straight to the team.',
            contactEmail: 'kensaurus@gmail.com',
          },
          minDescriptionLength: 12,
        },

        proactive: {
          rageClick: false,
          errorBoundary: false,
          longTask: false,
          apiCascade: false,
          pageDwell: false,
          firstSession: false,
        },

        capture: {
          console: true,
          network: true,
          performance: true,
          screenshot: 'on-report',
          elementSelector: true,
        },

        privacy: {
          maskSelectors: ['input[type="password"]', 'input[type="email"]', '[data-mushi-mask]'],
          blockSelectors: ['[data-payment]', '[data-auth-token]'],
          allowUserRemoveScreenshot: true,
        },

        debug: import.meta.env.DEV,
        enabled: true,
      };
      _sdk = Mushi.init(config);

      _sdk.setTrigger('hidden');
      _sdk.hide();

      // Attach the logged-in user so reports are attributable.
      if (options?.userId) {
        _sdk.identify(options.userId, {});
      }
      if (options?.activeProjectId) {
        _sdk.setMetadata('active_project_id', options.activeProjectId);
      }

      if (import.meta.env.DEV) {
        (win as Record<string, unknown>).__mushi_admin__ = _sdk;
      }

      return _sdk;
    } catch (err) {
      win[INIT_KEY] = false;
      _initPromise = null;
      console.warn('[mushi-self] init failed', err);
      Sentry.captureMessage('[mushi-self] init failed', {
        level: 'warning',
        extra: { err: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }
  })();

  return _initPromise;
}

export function getMushiSelf(): MushiSDKInstance | null {
  return _sdk;
}

/** Open the Mushi bug-report widget. Falls back to a no-op when disabled. */
export function reportMushiBug(opts?: { category?: 'bug' | 'slow' | 'visual' | 'confusing' | 'other' }): void {
  if (!_sdk) {
    void initMushiSelf()
      .then((sdk) => {
        if (sdk) sdk.report(opts);
      })
      .catch((err) => {
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
    return;
  }
  _sdk.report(opts);
}
