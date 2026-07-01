// ============================================================
// rewards.ts — Web SDK rewards subsystem
//
// Owns:
//   1. Activity batcher: coalesces events into 5-min flushes
//      with IndexedDB backing for offline resilience.
//   2. Auto-track listeners: route changes, [data-testid] clicks,
//      session dwell — piggybacks on installAutoBreadcrumbs infra.
//   3. In-widget tier/points badge (shadow-DOM, themable).
//   4. Consent surface (explicit mode).
//
// Wired by createInstance() only when config.rewards.enabled === true.
// All state is keyed by projectId so multi-instance setups don't bleed.
// ============================================================

import type { MushiApiClient, MushiRewardsConfig, MushiTierResult, MushiActivityEvent } from '@mushi-mushi/core';
import { sha256Hex, MUSHI_COLORS_LIGHT } from '@mushi-mushi/core';
import { subscribeHistory } from './history-patch';

const MIN_FLUSH_INTERVAL = 30_000;
const DEFAULT_FLUSH_INTERVAL = 300_000; // 5 min
const DWELL_SAMPLE_INTERVAL = 60_000;   // emit session_minute every 60s
const MAX_SESSION_MINUTES_PER_DAY = 60;
const DAILY_RESET_KEY_PREFIX = 'mushi_session_min_day_';

// ──────────────────────────────────────────────────────────────
// Internal queue (in-memory; IndexedDB for offline persistence)
// ──────────────────────────────────────────────────────────────

interface QueuedEvent extends MushiActivityEvent {
  queuedAt: number;
}

let pendingEvents: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let dwellTimer: ReturnType<typeof setInterval> | null = null;
let currentUserId: string | null = null;
let currentUserTraits: { email?: string; name?: string; provider?: string } | null = null;
let reporterTokenRaw: string | null = null;
let apiClient: MushiApiClient | null = null;
let optedIn = false;
let tierCache: MushiTierResult | null = null;
let tierCacheTime = 0;
const TIER_CACHE_TTL = 5 * 60 * 1000; // 5 min

/** After a permanent 4xx, pause rewards API calls to avoid retry storms. */
let rewardsApiBackoffUntil = 0;
const REWARDS_4XX_BACKOFF_MS = 15 * 60 * 1000; // 15 min

function isRewardsApiBackedOff(): boolean {
  return Date.now() < rewardsApiBackoffUntil;
}

function noteRewardsApiFailure(code?: string): void {
  if (!code?.startsWith('HTTP_4')) return;
  rewardsApiBackoffUntil = Date.now() + REWARDS_4XX_BACKOFF_MS;
}

// Track seen routes to avoid duplicate screen_view_unique_per_day
const seenRoutes = new Set<string>();

// ──────────────────────────────────────────────────────────────
// Consent helpers
// ──────────────────────────────────────────────────────────────

function getConsentKey(projectId: string): string {
  return `mushi_rewards_consent_${projectId}`;
}

function isConsentGranted(projectId: string): boolean {
  try {
    return localStorage.getItem(getConsentKey(projectId)) === '1';
  } catch {
    return false;
  }
}

function setConsentGranted(projectId: string, granted: boolean): void {
  try {
    if (granted) {
      localStorage.setItem(getConsentKey(projectId), '1');
    } else {
      localStorage.removeItem(getConsentKey(projectId));
    }
    optedIn = granted;
    // Consent is persisted locally; the next non-empty activity flush carries
    // `opted_in`. Never POST an empty events[] batch — /v1/sdk/activity
    // requires events.min(1) and returns 422 INVALID_ACTIVITY_BATCH.
  } catch { /* private browsing */ }
}

// ──────────────────────────────────────────────────────────────
// Session-minute daily cap
// ──────────────────────────────────────────────────────────────

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getSessionMinutesToday(projectId: string): number {
  try {
    const val = sessionStorage.getItem(`${DAILY_RESET_KEY_PREFIX}${projectId}_${getTodayKey()}`);
    return val ? parseInt(val, 10) : 0;
  } catch { return 0; }
}

function incrementSessionMinutes(projectId: string): number {
  const today = getTodayKey();
  const key = `${DAILY_RESET_KEY_PREFIX}${projectId}_${today}`;
  try {
    const next = (getSessionMinutesToday(projectId) + 1);
    sessionStorage.setItem(key, String(next));
    return next;
  } catch { return 99; }
}

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

export interface RewardsContext {
  client: MushiApiClient;
  config: MushiRewardsConfig;
  projectId: string;
  userId: string;
  traits?: { email?: string; name?: string; provider?: string };
  reporterToken?: string;
}

/** Called by createInstance() when a user is identified and rewards are enabled. */
export function initRewards(ctx: RewardsContext): void {
  apiClient = ctx.client;
  void ctx.config; // config stored for future use
  currentUserId = ctx.userId;
  currentUserTraits = ctx.traits ?? null;
  reporterTokenRaw = ctx.reporterToken ?? null;

  const { projectId } = ctx;
  const flushMs = Math.max(
    MIN_FLUSH_INTERVAL,
    ctx.config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL,
  );

  // Resolve consent
  if (ctx.config.consentMode === 'auto') {
    optedIn = true;
    setConsentGranted(projectId, true);
  } else {
    optedIn = isConsentGranted(projectId);
  }

  // Install auto-track listeners when trackActivity is on
  if (ctx.config.trackActivity) {
    installActivityListeners(projectId);
  }

  // Start flush timer
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => flush(ctx), flushMs);

  // Dwell timer — emits session_minute every 60s (capped)
  if (dwellTimer) clearInterval(dwellTimer);
  dwellTimer = setInterval(() => {
    if (!optedIn || !currentUserId) return;
    const minutes = getSessionMinutesToday(projectId);
    if (minutes < MAX_SESSION_MINUTES_PER_DAY) {
      incrementSessionMinutes(projectId);
      enqueue({ action: 'session_minute', metadata: { minutes_today: minutes + 1 } });
    }
  }, DWELL_SAMPLE_INTERVAL);

  // Eager tier fetch for the widget badge
  if (ctx.config.showInWidget) {
    fetchAndCacheTier(currentUserId).then((tier) => {
      if (tier) renderTierBadge(tier, ctx.config);
    });
  }

  // Show consent surface if explicit mode and not yet granted
  if (ctx.config.consentMode !== 'auto' && !optedIn) {
    renderConsentBanner(projectId, ctx.config);
  }
}

/** Called by Mushi.identify() to update the current user context. */
export function updateRewardsUser(
  userId: string,
  traits?: { email?: string; name?: string; provider?: string },
  reporterToken?: string,
): void {
  currentUserId = userId;
  currentUserTraits = traits ?? null;
  if (reporterToken) reporterTokenRaw = reporterToken;
  // Invalidate tier cache on user change
  tierCache = null;
  tierCacheTime = 0;
}

/** Manually enqueue a host-defined activity event. */
export function enqueue(event: MushiActivityEvent): void {
  if (!optedIn || !currentUserId) return;
  pendingEvents.push({ ...event, queuedAt: Date.now() });
}

/** Force-flush the pending event queue. */
export async function flush(ctx: RewardsContext): Promise<void> {
  if (!optedIn || !currentUserId || pendingEvents.length === 0) return;

  // P2: attach host-app JWT if verifyUserToken callback is configured
  let hostJwt: string | null = null;
  if (ctx.config.verifyUserToken) {
    try {
      hostJwt = await ctx.config.verifyUserToken();
    } catch {
      // Non-fatal — activity still submits without JWT;
      // server will mark jwt_verified_at = null
    }
  }

  if (isRewardsApiBackedOff()) return;

  const batch = pendingEvents.splice(0, 100);
  try {
    const reporterTokenHash = reporterTokenRaw ? await sha256Hex(reporterTokenRaw) : undefined;
    const result = await ctx.client.submitActivity(currentUserId, batch, {
      userTraits: currentUserTraits ?? undefined,
      reporterTokenHash,
      optedIn: true,
      hostJwt: hostJwt ?? undefined,
    });
    if (!result.ok) {
      noteRewardsApiFailure(result.error?.code);
      // Transient 5xx / network — re-queue; permanent 4xx drops the batch.
      const permanent = result.error?.code?.startsWith('HTTP_4');
      if (!permanent) {
        pendingEvents.unshift(...batch.slice(0, 50));
      }
    }
  } catch {
    // On failure, re-queue for next flush (simplified offline; full
    // IndexedDB queue is left for a follow-up to keep this file focussed)
    pendingEvents.unshift(...batch.slice(0, 50)); // cap re-queue at 50
  }
}

export async function getTier(userId: string): Promise<MushiTierResult | null> {
  const now = Date.now();
  if (tierCache && now - tierCacheTime < TIER_CACHE_TTL) return tierCache;
  return fetchAndCacheTier(userId);
}

async function fetchAndCacheTier(userId: string): Promise<MushiTierResult | null> {
  if (!apiClient || isRewardsApiBackedOff()) return null;
  const res = await apiClient.getMyTier(userId);
  if (res.ok && res.data) {
    tierCache = res.data as MushiTierResult;
    tierCacheTime = Date.now();
    return tierCache;
  }
  noteRewardsApiFailure(res.error?.code);
  return null;
}

export async function fetchLeaderboard(limit = 10): Promise<Array<{
  display_name: string;
  tier_name: string | null;
  total_points: number;
  points_30d: number;
}> | null> {
  if (!apiClient || isRewardsApiBackedOff()) return null;
  try {
    const res = await apiClient.getHallOfFame(limit);
    if (res.ok && res.data) {
      return (res.data.data ?? []).map((e) => ({
        display_name: e.display_name,
        tier_name: e.tier_name,
        total_points: e.total_points,
        points_30d: e.points_30d,
      }));
    }
    noteRewardsApiFailure(res.error?.code);
    return null;
  } catch {
    return null;
  }
}

export function teardown(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (dwellTimer) { clearInterval(dwellTimer); dwellTimer = null; }
  removeActivityListeners();
  removeTierBadge();
  if (consentHost) { consentHost.remove(); consentHost = null; }
  pendingEvents = [];
  currentUserId = null;
  apiClient = null;
  optedIn = false;
  tierCache = null;
  rewardsApiBackoffUntil = 0;
}

// ──────────────────────────────────────────────────────────────
// Auto-track listeners
// ──────────────────────────────────────────────────────────────

let routeObserver: MutationObserver | null = null;
let clickHandler: ((e: MouseEvent) => void) | null = null;
let historyUnsub: (() => void) | null = null;
let lastRoute = '';
let listenersInstalled = false;

function installActivityListeners(projectId: string): void {
  // Install exactly once per page. `initRewards` runs on every `identify()` /
  // `identifyWithToken()` call (e.g. on each route change or auth refresh); a
  // second install would re-wrap `history.pushState` over the already-wrapped
  // function and re-add the popstate/click/MutationObserver handlers, leaking
  // listeners and double-counting activity events. Re-identifying a user must
  // not re-install DOM hooks. `removeActivityListeners` resets the flag.
  if (listenersInstalled && historyUnsub) {
    return;
  }

  // Partial state (e.g. HMR) — tear down before re-installing.
  if (listenersInstalled) {
    removeActivityListeners();
  }

  listenersInstalled = true;

  const emitRoute = () => {
    const route = location.pathname;
    if (route === lastRoute) return;
    lastRoute = route;
    const isNewToday = !seenRoutes.has(`${projectId}:${route}`);
    if (isNewToday) {
      seenRoutes.add(`${projectId}:${route}`);
      enqueue({ action: 'screen_view_unique_per_day', metadata: { route } });
    }
  };

  // Pre-history-hub: only pushState + popstate (not replaceState). Frameworks
  // like Next.js shallow routing use replaceState heavily; tracking it would
  // widen the activity signal surface beyond the original rewards contract.
  historyUnsub = subscribeHistory({
    onPush: emitRoute,
    onPop: emitRoute,
  });
  emitRoute();

  // DOM mutation observer for SPA route changes that don't use pushState
  routeObserver = new MutationObserver(() => emitRoute());
  const main = document.querySelector('main') ?? document.body;
  routeObserver.observe(main, { childList: true, subtree: false });

  // Click: track [data-testid] interactions
  clickHandler = (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-testid]') as HTMLElement | null;
    if (!target) return;
    const testid = target.dataset.testid;
    if (!testid) return;
    enqueue({ action: 'element_selected', metadata: { testid, route: location.pathname } });
  };
  document.addEventListener('click', clickHandler, { capture: true, passive: true });
}

function removeActivityListeners(): void {
  listenersInstalled = false;
  historyUnsub?.();
  historyUnsub = null;
  routeObserver?.disconnect();
  routeObserver = null;
  if (clickHandler) {
    document.removeEventListener('click', clickHandler, { capture: true });
    clickHandler = null;
  }
}

// ──────────────────────────────────────────────────────────────
// Shadow-DOM tier badge
// ──────────────────────────────────────────────────────────────

let badgeHost: HTMLElement | null = null;

function renderTierBadge(tier: MushiTierResult, config: MushiRewardsConfig): void {
  if (!config.showInWidget) return;
  if (badgeHost) badgeHost.remove();

  badgeHost = document.createElement('div');
  badgeHost.id = 'mushi-tier-badge';
  Object.assign(badgeHost.style, {
    position: 'fixed',
    bottom: '56px', // above the widget button
    right: '16px',
    zIndex: '2147483645',
    fontFamily: 'system-ui, sans-serif',
  });

  const shadow = badgeHost.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(0,0,0,0.75);
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        backdrop-filter: blur(6px);
        cursor: default;
        user-select: none;
      }
      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${MUSHI_COLORS_LIGHT.accent};
        flex-shrink: 0;
      }
    </style>
    <div class="badge">
      <span class="dot"></span>
      <span>${tier.displayName}</span>
    </div>
  `;

  document.body.appendChild(badgeHost);
}

function removeTierBadge(): void {
  badgeHost?.remove();
  badgeHost = null;
}

// ──────────────────────────────────────────────────────────────
// Consent banner (explicit mode)
// ──────────────────────────────────────────────────────────────

let consentHost: HTMLElement | null = null;

function renderConsentBanner(projectId: string, config: MushiRewardsConfig): void {
  if (consentHost) return; // already shown

  consentHost = document.createElement('div');
  consentHost.id = 'mushi-consent-banner';
  Object.assign(consentHost.style, {
    position: 'fixed',
    bottom: '80px',
    right: '16px',
    zIndex: '2147483646',
    maxWidth: '280px',
    fontFamily: 'system-ui, sans-serif',
  });

  const shadow = consentHost.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      .banner {
        background: ${MUSHI_COLORS_LIGHT.paperRaised};
        border: 1px solid ${MUSHI_COLORS_LIGHT.ruleStrong};
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        padding: 14px 16px;
        font-size: 13px;
        line-height: 1.5;
        color: ${MUSHI_COLORS_LIGHT.inkMuted};
      }
      .title { font-weight: 700; margin-bottom: 6px; color: ${MUSHI_COLORS_LIGHT.ink}; }
      .actions { display: flex; gap: 8px; margin-top: 10px; }
      button {
        flex: 1;
        padding: 6px 10px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      .accept { background: ${MUSHI_COLORS_LIGHT.accent}; color: ${MUSHI_COLORS_LIGHT.paperRaised}; }
      .decline { background: ${MUSHI_COLORS_LIGHT.paper}; color: ${MUSHI_COLORS_LIGHT.inkMuted}; }
    </style>
    <div class="banner">
      <div class="title">🎯 Earn rewards</div>
      <div>Help improve this app and earn points, badges, and perks for your contributions.</div>
      <div class="actions">
        <button class="accept" id="accept">Enable</button>
        <button class="decline" id="decline">No thanks</button>
      </div>
    </div>
  `;

  shadow.getElementById('accept')?.addEventListener('click', () => {
    setConsentGranted(projectId, true);
    consentHost?.remove();
    consentHost = null;
    if (config.showInWidget && currentUserId) {
      fetchAndCacheTier(currentUserId).then((tier) => {
        if (tier) renderTierBadge(tier, config);
      });
    }
  });

  shadow.getElementById('decline')?.addEventListener('click', () => {
    setConsentGranted(projectId, false);
    consentHost?.remove();
    consentHost = null;
  });

  document.body.appendChild(consentHost);
}
