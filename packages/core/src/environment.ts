import type { MushiEnvironment } from './types';

/**
 * Capture a snapshot of the runtime environment. Called once per
 * report submission, so every read here must be:
 *
 *   1. Synchronous (UA-Client Hints `getHighEntropyValues()` is the
 *      sole exception — see `kickOffUserAgentData` below; the result
 *      is memoised and folded back in on the next capture).
 *   2. SSR-safe (every `window`/`document`/`navigator` access must be
 *      gated on `typeof X !== 'undefined'` because the SDK is
 *      imported by Next.js / Remix server bundles).
 *   3. Tolerant of missing APIs (Safari doesn't have `Network
 *      Information`, Firefox doesn't have UA-CH, screen.orientation is
 *      flaky on iOS) — every individual field is optional so a
 *      partially-supported browser still produces a useful payload.
 */
export function captureEnvironment(): MushiEnvironment {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  const doc = typeof document !== 'undefined' ? document : undefined;
  const scr = typeof screen !== 'undefined' ? screen : undefined;

  // Trigger UA-CH high-entropy resolution in the background. The first
  // capture lands without it; the second one (and every subsequent one)
  // gets the cached values folded in. We tolerate the gap because the
  // alternative is making `captureEnvironment` async — and that would
  // ripple into every call site (the offline queue, the diagnostics
  // worker, the proactive trigger pipeline) for a field that's only
  // useful when the browser happens to be Chromium.
  void kickOffUserAgentData(nav);

  const connection = nav && 'connection' in nav ? (nav as NavigatorWithConnection).connection : undefined;

  return {
    userAgent: nav?.userAgent ?? 'unknown',
    platform: nav?.platform ?? 'unknown',
    language: nav?.language ?? 'en',
    viewport: {
      width: win?.innerWidth ?? 0,
      height: win?.innerHeight ?? 0,
    },
    url: win?.location?.href ?? '',
    referrer: doc?.referrer ?? '',
    timestamp: new Date().toISOString(),
    timezone: Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone ?? 'UTC',
    connection: connection
      ? {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
        }
      : undefined,
    deviceMemory: (nav as NavigatorWithDeviceMemory)?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
    route: win?.location?.pathname,
    nearestTestid: findNearestTestidFromActive(doc),

    userAgentData: captureUserAgentData(nav),
    screen: captureScreen(scr, win),
    prefersColorScheme: matchScheme(win),
    prefersReducedMotion: matchMedia(win, '(prefers-reduced-motion: reduce)'),
    prefersReducedData: matchMedia(win, '(prefers-reduced-data: reduce)'),
    prefersContrast: matchContrast(win),
    forcedColors: matchMedia(win, '(forced-colors: active)'),
    online: typeof nav?.onLine === 'boolean' ? nav.onLine : undefined,
    displayMode: matchDisplayMode(win),
    documentTitle: doc?.title?.slice(0, 200),
    buildId: readBuildIdMeta(doc),
    pageLoadTiming: capturePageLoadTiming(win),
  };
}

/**
 * Best-effort `data-testid` resolver for freeform reports — when the user
 * opens the widget without first using the element selector we still want
 * to map the report to an Action. We start from `document.activeElement`
 * (which is the most-recently-focused interactive element on most browsers)
 * and walk up. Falls back to undefined when no testid is in scope.
 *
 * Mirrors the walk in `packages/web/src/capture/element-selector.ts` so
 * both code paths produce the same value for the same DOM state.
 */
function findNearestTestidFromActive(doc?: Document): string | undefined {
  if (!doc) return undefined;
  let cur: Element | null = doc.activeElement ?? null;
  let hops = 0;
  while (cur && hops < 20) {
    const tid = cur.getAttribute?.('data-testid');
    if (tid) return tid;
    cur = cur.parentElement;
    hops++;
  }
  return undefined;
}

// ---- UA-Client Hints (Chromium) ---------------------------------------------

interface UserAgentDataLow {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
}
interface UserAgentDataHigh extends UserAgentDataLow {
  architecture?: string;
  bitness?: string;
  model?: string;
  platformVersion?: string;
  uaFullVersion?: string;
  fullVersionList?: Array<{ brand: string; version: string }>;
}
interface NavigatorWithUAData extends Navigator {
  userAgentData?: UserAgentDataLow & {
    getHighEntropyValues?: (hints: string[]) => Promise<UserAgentDataHigh>;
  };
}

let cachedHighEntropy: UserAgentDataHigh | null = null;
let highEntropyKickedOff = false;

function kickOffUserAgentData(nav: Navigator | undefined): void {
  if (highEntropyKickedOff) return;
  const ua = (nav as NavigatorWithUAData | undefined)?.userAgentData;
  if (!ua?.getHighEntropyValues) return;
  highEntropyKickedOff = true;
  ua.getHighEntropyValues([
    'architecture',
    'bitness',
    'model',
    'platformVersion',
    'uaFullVersion',
    'fullVersionList',
  ])
    .then((v) => {
      cachedHighEntropy = v;
    })
    .catch(() => {
      // Some browsers reject the promise on cross-origin or insecure contexts;
      // we just carry on without the high-entropy bits.
    });
}

/**
 * Pick the most identifying brand from UA-CH `brands` — Chromium ships
 * with three: a stable real one ("Chromium" / "Google Chrome" / "Brave")
 * plus a placeholder ("Not_A Brand") that exists to test sniffer
 * tolerance. Skip the placeholder. Prefer non-Chromium-shell brands so
 * Brave / Edge / Opera identify as themselves rather than as Chromium.
 */
function pickBrand(
  brands?: Array<{ brand: string; version: string }>,
): { brand: string; version: string } | undefined {
  if (!brands?.length) return undefined;
  const real = brands.filter((b) => !/not.?a.?brand/i.test(b.brand));
  if (real.length === 0) return undefined;
  // Prefer a brand that isn't generic Chromium / Google Chrome — that's
  // the host browser when the user runs a derivative.
  const named = real.find((b) => !/chromium|google chrome/i.test(b.brand));
  return named ?? real[0];
}

function captureUserAgentData(nav: Navigator | undefined): MushiEnvironment['userAgentData'] {
  const low = (nav as NavigatorWithUAData | undefined)?.userAgentData;
  if (!low && !cachedHighEntropy) return undefined;
  const fullList = cachedHighEntropy?.fullVersionList;
  const brand = pickBrand(fullList ?? low?.brands);
  const out: NonNullable<MushiEnvironment['userAgentData']> = {};
  if (brand) {
    out.browser = brand.brand;
    out.browserVersion = brand.version;
  }
  // `platform` (low entropy) is e.g. "macOS", "Windows" — fine for a default.
  if (low?.platform) out.os = low.platform;
  if (cachedHighEntropy?.platformVersion) out.osVersion = cachedHighEntropy.platformVersion;
  if (typeof low?.mobile === 'boolean') out.mobile = low.mobile;
  if (cachedHighEntropy?.model) out.model = cachedHighEntropy.model;
  if (cachedHighEntropy?.architecture) out.architecture = cachedHighEntropy.architecture;
  if (cachedHighEntropy?.bitness) out.bitness = cachedHighEntropy.bitness;
  return Object.keys(out).length === 0 ? undefined : out;
}

// ---- Screen + media queries -------------------------------------------------

function captureScreen(
  scr: Screen | undefined,
  win: Window | undefined,
): MushiEnvironment['screen'] {
  if (!scr && !win) return undefined;
  const out: NonNullable<MushiEnvironment['screen']> = {};
  if (typeof scr?.width === 'number') out.width = scr.width;
  if (typeof scr?.height === 'number') out.height = scr.height;
  if (typeof win?.devicePixelRatio === 'number') out.devicePixelRatio = win.devicePixelRatio;
  if (typeof scr?.colorDepth === 'number') out.colorDepth = scr.colorDepth;
  // `screen.orientation` is intermittently undefined on iOS Safari, so we
  // can't lean on the standard `Screen` type — read it loosely via an
  // index access that tolerates the missing property at runtime.
  const orientationType = (scr as unknown as { orientation?: { type?: string } } | undefined)
    ?.orientation?.type;
  if (orientationType) out.orientation = orientationType;
  return Object.keys(out).length === 0 ? undefined : out;
}

function matchMedia(win: Window | undefined, query: string): boolean | undefined {
  if (!win?.matchMedia) return undefined;
  try {
    return win.matchMedia(query).matches;
  } catch {
    return undefined;
  }
}

function matchScheme(win: Window | undefined): MushiEnvironment['prefersColorScheme'] {
  if (!win?.matchMedia) return undefined;
  if (matchMedia(win, '(prefers-color-scheme: dark)')) return 'dark';
  if (matchMedia(win, '(prefers-color-scheme: light)')) return 'light';
  return 'no-preference';
}

function matchContrast(win: Window | undefined): MushiEnvironment['prefersContrast'] {
  if (!win?.matchMedia) return undefined;
  if (matchMedia(win, '(prefers-contrast: more)')) return 'more';
  if (matchMedia(win, '(prefers-contrast: less)')) return 'less';
  if (matchMedia(win, '(prefers-contrast: custom)')) return 'custom';
  return 'no-preference';
}

function matchDisplayMode(win: Window | undefined): MushiEnvironment['displayMode'] {
  if (!win?.matchMedia) return undefined;
  // Order matters: standalone implies !browser, fullscreen implies !standalone.
  // Walk most-specific-first.
  if (matchMedia(win, '(display-mode: fullscreen)')) return 'fullscreen';
  if (matchMedia(win, '(display-mode: standalone)')) return 'standalone';
  if (matchMedia(win, '(display-mode: minimal-ui)')) return 'minimal-ui';
  if (matchMedia(win, '(display-mode: browser)')) return 'browser';
  return undefined;
}

// ---- Build id from <meta name="mushi:build"> --------------------------------

function readBuildIdMeta(doc: Document | undefined): string | undefined {
  if (!doc) return undefined;
  const el = doc.querySelector?.('meta[name="mushi:build"]') as HTMLMetaElement | null;
  const v = el?.content?.trim();
  if (!v) return undefined;
  // Cap at 64 chars — git SHAs are 40, semver+meta is well under that.
  // We don't want users accidentally shoving a manifest into a meta tag.
  return v.slice(0, 64);
}

// ---- Navigation timing ------------------------------------------------------

function capturePageLoadTiming(win: Window | undefined): MushiEnvironment['pageLoadTiming'] {
  const perf = win?.performance;
  if (!perf?.getEntriesByType) return undefined;
  let entry: PerformanceNavigationTiming | undefined;
  try {
    const entries = perf.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    entry = entries[0];
  } catch {
    return undefined;
  }
  if (!entry) return undefined;
  // `startTime` is in PerformanceEntry but TS sometimes types it as
  // `number` and sometimes the test mock omits it; treat as 0 when missing.
  const start = (entry as PerformanceNavigationTiming & { startTime?: number }).startTime ?? 0;
  const out: NonNullable<MushiEnvironment['pageLoadTiming']> = {};
  // `loadEventEnd === 0` while the page is still loading — only report
  // it once it's actually fired so a fresh capture during page load
  // doesn't claim "load completed in 0ms".
  if (entry.domContentLoadedEventEnd > 0)
    out.domContentLoadedMs = Math.round(entry.domContentLoadedEventEnd - start);
  if (entry.loadEventEnd > 0) out.loadCompleteMs = Math.round(entry.loadEventEnd - start);
  if (entry.responseStart > 0) out.timeToFirstByteMs = Math.round(entry.responseStart - start);
  if (typeof entry.type === 'string') out.navigationType = entry.type;
  return Object.keys(out).length === 0 ? undefined : out;
}

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformation;
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}
