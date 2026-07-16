/**
 * Normalizes admin API JSON envelopes into the `{ ok, data?, error? }` shape
 * that `apiFetch` / `usePageData` expect.
 *
 * Handles legacy routes that returned `{ ok: true, tickets: [] }` as well as
 * paginated flat shapes like `{ ok: true, data: T[], total, page, limit }`.
 */
export type ApiResult<T> = {
  ok: boolean
  data?: T
  error?: { code: string; message: string; requestId?: string }
  /** Correlation id from the X-Request-Id response header when present. */
  requestId?: string
}

export function coerceApiResult<T>(raw: unknown): ApiResult<T> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: { code: 'INVALID_RESPONSE', message: 'Invalid API response' } }
  }

  const obj = raw as Record<string, unknown>

  if (obj.ok === false) {
    const err = obj.error
    // Some routes intentionally return `{ ok: false, error, data }` at HTTP 200
    // (e.g. sync-ci-secrets' soft "forbidden"/"no-repo" that still carries a
    // freshly-minted key + guided fallback). The ApiResult contract already
    // declares `data` as optional alongside `ok`, and every consumer gates on
    // `ok` before reading `data`, so carrying it through is additive and lets
    // those callers recover the payload instead of silently dropping it.
    const dataField = obj.data !== undefined ? { data: obj.data as T } : {}
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      const requestId =
        typeof e.requestId === 'string'
          ? e.requestId
          : typeof e.request_id === 'string'
            ? e.request_id
            : undefined
      return {
        ok: false,
        ...dataField,
        ...(requestId ? { requestId } : {}),
        error: {
          code: String(e.code ?? 'ERROR'),
          message: String(e.message ?? e.code ?? 'Request failed'),
          ...(requestId ? { requestId } : {}),
        },
      }
    }
    if (typeof err === 'string') {
      return { ok: false, ...dataField, error: { code: 'ERROR', message: err } }
    }
    return { ok: false, ...dataField, error: { code: 'ERROR', message: 'Request failed' } }
  }

  if (obj.ok === true) {
    if (obj.data !== undefined) {
      // Paginated list routes sometimes flatten `{ data: T[], total, page, limit }`
      // at the top level instead of nesting under `data: { data, total }`.
      if (Array.isArray(obj.data)) {
        const { ok: _ok, error: _err, data, ...rest } = obj
        if (Object.keys(rest).length > 0) {
          return { ok: true, data: { data, ...rest } as T }
        }
      }
      return { ok: true, data: obj.data as T }
    }

    const { ok: _ok, error: _err, ...payload } = obj
    if (Object.keys(payload).length > 0) {
      return { ok: true, data: payload as T }
    }
    return { ok: true, data: undefined as T }
  }

  if (typeof obj.error === 'string') {
    return { ok: false, error: { code: 'ERROR', message: obj.error } }
  }

  return { ok: true, data: raw as T }
}
