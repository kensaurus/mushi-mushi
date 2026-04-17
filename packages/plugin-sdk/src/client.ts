/**
 * Tiny HTTPS client that plugins use to call back into the Mushi REST API.
 *
 * Plugin authors get a per-plugin scoped API key from the marketplace listing.
 * The key has only the permissions the plugin requested (declared in the
 * plugin's manifest). The client adds canonical headers, optional retries,
 * and structured error parsing.
 */

export interface MushiPluginClientOptions {
  apiKey: string
  projectId: string
  /** Defaults to `https://api.mushimushi.dev`. Override for self-host or staging. */
  baseUrl?: string
  /** Custom fetch (e.g., undici); defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

export interface MushiPluginClient {
  fetchReport(reportId: string): Promise<unknown>
  comment(reportId: string, body: string, opts?: { visibleToReporter?: boolean }): Promise<unknown>
  setStatus(reportId: string, status: string, reason?: string): Promise<unknown>
  raw(method: string, path: string, body?: unknown): Promise<unknown>
}

export function createMushiClient(opts: MushiPluginClientOptions): MushiPluginClient {
  const baseUrl = (opts.baseUrl ?? 'https://api.mushimushi.dev').replace(/\/$/, '')
  const f = opts.fetchImpl ?? fetch

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await f(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': opts.apiKey,
        'X-Mushi-Project': opts.projectId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      // not JSON — return the raw text so the caller can decide
    }
    if (!res.ok) {
      throw new MushiPluginApiError(res.status, parsed)
    }
    return parsed
  }

  return {
    fetchReport: (reportId) => call('GET', `/v1/reports/${encodeURIComponent(reportId)}`),
    comment: (reportId, body, opts2) =>
      call('POST', `/v1/reports/${encodeURIComponent(reportId)}/comments`, {
        body,
        visibleToReporter: opts2?.visibleToReporter ?? false,
      }),
    setStatus: (reportId, status, reason) =>
      call('PATCH', `/v1/reports/${encodeURIComponent(reportId)}`, {
        status,
        ...(reason ? { statusReason: reason } : {}),
      }),
    raw: (method, path, body) => call(method, path, body),
  }
}

export class MushiPluginApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`Mushi API error: ${status}`)
    this.name = 'MushiPluginApiError'
  }
}
