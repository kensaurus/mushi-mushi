import type { MushiNetworkEntry, MushiUrlMatcher } from '@mushi-mushi/core';
import { getInternalRequestKind, getRequestUrl, shouldIgnoreMushiUrl } from '../internal-requests';

const MAX_ENTRIES = 30;

export interface NetworkCapture {
  getEntries(): MushiNetworkEntry[];
  clear(): void;
  updateOptions(options: NetworkCaptureOptions): void;
  destroy(): void;
}

export interface NetworkCaptureOptions {
  apiEndpoint?: string;
  ignoreUrls?: MushiUrlMatcher[];
}

export function createNetworkCapture(options: NetworkCaptureOptions = {}): NetworkCapture {
  const entries: MushiNetworkEntry[] = [];
  const originalFetch = globalThis.fetch;
  let activeOptions = options;

  globalThis.fetch = async function mushiFetchInterceptor(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = Date.now();
    const method = init?.method?.toUpperCase() ?? 'GET';
    const url = getRequestUrl(input);
    const internalKind = getInternalRequestKind(input, init);
    const shouldRecord = !internalKind && !shouldIgnoreMushiUrl(url, activeOptions);

    try {
      const response = await originalFetch.call(globalThis, input, init);

      if (shouldRecord) {
        addEntry({
          method,
          url: truncateUrl(url),
          status: response.status,
          duration: Date.now() - startTime,
          timestamp: startTime,
        });
      }

      return response;
    } catch (error) {
      if (shouldRecord) {
        addEntry({
          method,
          url: truncateUrl(url),
          status: 0,
          duration: Date.now() - startTime,
          timestamp: startTime,
          error: error instanceof Error ? error.message : 'Network error',
        });
      }
      throw error;
    }
  };

  function addEntry(entry: MushiNetworkEntry): void {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.shift();
    }
  }

  return {
    getEntries() {
      return [...entries];
    },
    clear() {
      entries.length = 0;
    },
    updateOptions(nextOptions) {
      activeOptions = nextOptions;
    },
    destroy() {
      globalThis.fetch = originalFetch;
    },
  };
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.length > 200) {
      return parsed.origin + path.slice(0, 200) + '...';
    }
    return parsed.origin + path;
  } catch {
    return url.slice(0, 200);
  }
}
