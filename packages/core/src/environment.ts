import type { MushiEnvironment } from './types';

export function captureEnvironment(): MushiEnvironment {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  const doc = typeof document !== 'undefined' ? document : undefined;

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
