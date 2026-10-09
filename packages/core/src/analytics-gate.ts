/**
 * FILE: packages/core/src/analytics-gate.ts
 * PURPOSE: The one privacy gate every analytics surface in the browser SDK
 *          passes through: product events (`Mushi.track()`, `identify()`) and
 *          session lifecycle tracking alike.
 *
 * A surface may send only when all of these hold:
 *   - `analytics.enabled` is not false;
 *   - Do Not Track / Global Privacy Control is off, or the host opted out of
 *     honouring it (`respectDoNotTrack: false`);
 *   - the browser is not automation or a crawler (`excludeBots: false` opts
 *     back in, e.g. to exercise analytics from Playwright);
 *   - consent resolves to 'granted'. 'implied' mode grants unless the visitor
 *     stored a denial; 'required' mode waits for `setConsent('granted')`.
 *
 * The first three are fixed for the page, so `analyticsBlockReason()` is read
 * once at tracker init. Consent can change at any time, so trackers resolve it
 * from storage at init (the storage is the source of truth, which keeps the
 * result independent of which tracker starts first) and then follow
 * `onAnalyticsConsentChange()`.
 */

import type { MushiAnalyticsConfig } from './types';

export type AnalyticsConsentState = 'granted' | 'denied' | 'pending';
export type AnalyticsBlockReason = 'disabled' | 'dnt' | 'automation';

type ConsentListener = (state: 'granted' | 'denied') => void;

/**
 * Headless browsers, audit tools and crawlers that execute JavaScript.
 * `\bbot\b` / `bot[/-]` match `Googlebot/2.1`, `AdsBot-Google` and a bare
 * `bot` token without catching device names such as `CUBOT X20`.
 */
const AUTOMATED_UA_RE = /HeadlessChrome|PhantomJS|Lighthouse|\bbot\b|bot[/-]|crawler|spider/i;

/** Consent key, per project. Unchanged from the event tracker so returning visitors keep their choice. */
function consentKey(projectId: string): string {
  return 'mushi_events_consent_' + projectId;
}

const listeners = new Set<ConsentListener>();

/** True when the browser signals Do Not Track or Global Privacy Control. */
export function dntActive(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  if (nav.globalPrivacyControl === true) return true;
  const winDnt = typeof window !== 'undefined' ? (window as Window & { doNotTrack?: string }).doNotTrack : undefined;
  const dnt = nav.doNotTrack ?? nav.msDoNotTrack ?? winDnt;
  return dnt === '1' || dnt === 'yes';
}

/** True for WebDriver-controlled browsers (Playwright, Puppeteer, Selenium) and crawler user agents. */
export function isAutomatedBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver === true) return true;
  return AUTOMATED_UA_RE.test(navigator.userAgent ?? '');
}

/**
 * Why analytics may not run on this page at all, or null when only consent
 * stands between the tracker and the network.
 */
export function analyticsBlockReason(config?: MushiAnalyticsConfig): AnalyticsBlockReason | null {
  if (config?.enabled === false) return 'disabled';
  if (config?.respectDoNotTrack !== false && dntActive()) return 'dnt';
  if (config?.excludeBots !== false && isAutomatedBrowser()) return 'automation';
  return null;
}

function readStoredConsent(projectId: string): 'granted' | 'denied' | null {
  if (!projectId) return null;
  try {
    const v = localStorage.getItem(consentKey(projectId));
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

function writeStoredConsent(projectId: string, state: 'granted' | 'denied'): void {
  if (!projectId) return;
  try {
    localStorage.setItem(consentKey(projectId), state);
  } catch {
    /* storage unavailable */
  }
}

/** Consent for this page: a stored choice wins, otherwise the configured mode decides. */
export function resolveAnalyticsConsent(projectId: string, config?: MushiAnalyticsConfig): AnalyticsConsentState {
  const stored = readStoredConsent(projectId);
  if (config?.consent === 'required') return stored ?? 'pending';
  return stored === 'denied' ? 'denied' : 'granted';
}

/** Persist a consent decision and tell every subscribed tracker. */
export function setAnalyticsConsent(projectId: string, state: 'granted' | 'denied'): void {
  writeStoredConsent(projectId, state);
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch {
      /* one tracker must not stop the others from hearing a denial */
    }
  }
}

/** Follow consent changes. Returns the unsubscribe function. */
export function onAnalyticsConsentChange(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
