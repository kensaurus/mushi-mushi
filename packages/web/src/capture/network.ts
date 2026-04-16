import type { MushiNetworkEntry } from '@mushi-mushi/core';

const MAX_ENTRIES = 30;

export interface NetworkCapture {
  getEntries(): MushiNetworkEntry[];
  clear(): void;
  destroy(): void;
}

export function createNetworkCapture(): NetworkCapture {
  const entries: MushiNetworkEntry[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function mushiFetchInterceptor(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = Date.now();
    const method = init?.method?.toUpperCase() ?? 'GET';
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    try {
      const response = await originalFetch.call(globalThis, input, init);

      addEntry({
        method,
        url: truncateUrl(url),
        status: response.status,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });

      return response;
    } catch (error) {
      addEntry({
        method,
        url: truncateUrl(url),
        status: 0,
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: error instanceof Error ? error.message : 'Network error',
      });
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
