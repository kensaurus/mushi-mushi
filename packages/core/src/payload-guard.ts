/**
 * Client-side payload size guards — prevents silent edge-function failures
 * when screenshots or log buffers inflate the report body past gateway limits.
 */

/** Supabase edge functions tolerate ~6 MB; stay under 4 MB for headroom. */
export const MAX_REPORT_PAYLOAD_BYTES = 4 * 1024 * 1024

/** Screenshot data URLs above this are downscaled or dropped before POST. */
export const MAX_SCREENSHOT_DATA_URL_BYTES = 1.5 * 1024 * 1024

export interface PayloadGuardResult {
  ok: boolean
  bytes: number
  maxBytes: number
  reason?: string
  /**
   * True when the payload could not be serialized at all (e.g. a circular
   * reference in `metadata`). This is a distinct failure from "too large" —
   * the caller should surface a `SERIALIZE_FAILED` rather than a misleading
   * "payload too large" message.
   */
  serializeFailed?: boolean
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export function estimateJsonBytes(value: unknown): number {
  const json = safeStringify(value)
  return json === null
    ? Number.MAX_SAFE_INTEGER
    : new TextEncoder().encode(json).length
}

export function checkReportPayloadSize(
  payload: unknown,
  maxBytes = MAX_REPORT_PAYLOAD_BYTES,
): PayloadGuardResult {
  const json = safeStringify(payload)
  if (json === null) {
    return {
      ok: false,
      bytes: 0,
      maxBytes,
      serializeFailed: true,
      reason: 'Report could not be serialized (circular reference in metadata?)',
    }
  }
  const bytes = new TextEncoder().encode(json).length
  if (bytes <= maxBytes) {
    return { ok: true, bytes, maxBytes }
  }
  return {
    ok: false,
    bytes,
    maxBytes,
    reason: `Report payload ${formatBytes(bytes)} exceeds limit ${formatBytes(maxBytes)}`,
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
