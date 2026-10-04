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
  error?: {
    code: string
    message: string
    requestId?: string
    /** Validator detail (e.g. inventory YAML `{ path, message }[]`) when the route sends it. */
    issues?: unknown[]
  }
  /** Correlation id from the X-Request-Id response header when present. */
  requestId?: string
  /**
   * Top-level `meta` from a success envelope. Some routes return one-time
   * values here (e.g. a freshly minted reward-webhook signing secret), so it
   * must survive coercion. Additive: `data` is shaped exactly as before.
   */
  meta?: Record<string, unknown>
}

/** Turns `snake_case` / `camelCase` field paths into "Snake case" words. */
function fieldLabel(path: string): string {
  const words = path
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Request'
}

/**
 * Readable text for an error `message` that is not a string. Routes that
 * return zod's `error.flatten()` (`{ formErrors, fieldErrors }`) or an issue
 * list used to reach the user as "[object Object]". Returns null when the
 * value carries nothing a person can read.
 */
export function describeErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail.trim() || null
  if (!detail || typeof detail !== 'object') return null
  const parts: string[] = []
  if (Array.isArray(detail)) {
    for (const item of detail) {
      if (!item || typeof item !== 'object') continue
      const issue = item as { path?: unknown; message?: unknown }
      if (typeof issue.message !== 'string') continue
      const path = Array.isArray(issue.path) ? issue.path.join('.') : typeof issue.path === 'string' ? issue.path : ''
      parts.push(path ? `${fieldLabel(path)}: ${issue.message}` : issue.message)
    }
  } else {
    const obj = detail as { formErrors?: unknown; fieldErrors?: unknown; message?: unknown }
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim()
    if (Array.isArray(obj.formErrors)) {
      for (const m of obj.formErrors) if (typeof m === 'string' && m) parts.push(m)
    }
    if (obj.fieldErrors && typeof obj.fieldErrors === 'object') {
      for (const [field, messages] of Object.entries(obj.fieldErrors as Record<string, unknown>)) {
        const first = Array.isArray(messages) ? messages.find((m) => typeof m === 'string') : null
        if (first) parts.push(`${fieldLabel(field)}: ${first}`)
      }
    }
  }
  return parts.length > 0 ? parts.join('. ') : null
}

/**
 * The error carried by a non-2xx body that has no `ok` field, such as
 * `{ error: { formErrors, fieldErrors } }`. Null when the body has no error.
 */
export function errorFromBody(raw: unknown): { code: string; message: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const err = (raw as { error?: unknown }).error
  if (err == null) return null
  if (typeof err === 'string') return { code: 'ERROR', message: err }
  if (typeof err !== 'object') return null
  const e = err as { code?: unknown }
  const message = describeErrorDetail(err)
  if (!message) return null
  return { code: typeof e.code === 'string' ? e.code : 'VALIDATION_ERROR', message }
}

function metaOf(obj: Record<string, unknown>): { meta?: Record<string, unknown> } {
  const meta = obj.meta
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? { meta: meta as Record<string, unknown> }
    : {}
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
          message: describeErrorDetail(e.message) ?? String(e.code ?? 'Request failed'),
          ...(requestId ? { requestId } : {}),
          ...(Array.isArray(e.issues) ? { issues: e.issues as unknown[] } : {}),
        },
      }
    }
    if (typeof err === 'string') {
      return { ok: false, ...dataField, error: { code: 'ERROR', message: err } }
    }
    return { ok: false, ...dataField, error: { code: 'ERROR', message: 'Request failed' } }
  }

  if (obj.ok === true) {
    const metaField = metaOf(obj)
    if (obj.data !== undefined) {
      // Paginated list routes sometimes flatten `{ data: T[], total, page, limit }`
      // at the top level instead of nesting under `data: { data, total }`.
      if (Array.isArray(obj.data)) {
        const { ok: _ok, error: _err, data, ...rest } = obj
        if (Object.keys(rest).length > 0) {
          return { ok: true, data: { data, ...rest } as T, ...metaField }
        }
      }
      return { ok: true, data: obj.data as T, ...metaField }
    }

    const { ok: _ok, error: _err, ...payload } = obj
    if (Object.keys(payload).length > 0) {
      return { ok: true, data: payload as T, ...metaField }
    }
    return { ok: true, data: undefined as T, ...metaField }
  }

  if (typeof obj.error === 'string') {
    return { ok: false, error: { code: 'ERROR', message: obj.error } }
  }

  return { ok: true, data: raw as T }
}
