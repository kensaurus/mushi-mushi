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
  };
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
