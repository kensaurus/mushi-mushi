export interface NetworkEntry {
  method: string
  url: string
  status: number | null
  duration: number
  error?: string
  timestamp: number
}

export function setupNetworkCapture(maxEntries = 50, apiEndpoint?: string) {
  const entries: NetworkEntry[] = []
  const origFetch = globalThis.fetch

  globalThis.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? 'GET'

    if (apiEndpoint && url.includes(apiEndpoint)) {
      return origFetch.apply(this, [input, init] as Parameters<typeof fetch>)
    }

    const start = Date.now()
    try {
      const res = await origFetch.apply(this, [input, init] as Parameters<typeof fetch>)
      entries.push({
        method,
        url: stripQueryParams(url),
        status: res.status,
        duration: Date.now() - start,
        timestamp: start,
      })
      if (entries.length > maxEntries) entries.shift()
      return res
    } catch (err) {
      entries.push({
        method,
        url: stripQueryParams(url),
        status: null,
        duration: Date.now() - start,
        error: String(err),
        timestamp: start,
      })
      if (entries.length > maxEntries) entries.shift()
      throw err
    }
  } as typeof fetch

  return {
    getEntries: () => [...entries],
    clear: () => { entries.length = 0 },
    restore: () => { globalThis.fetch = origFetch },
  }
}

function stripQueryParams(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url.split('?')[0]
  }
}
