/**
 * Pure helpers for scripts/verify-hosted-mcp.mjs (unit-tested).
 */

/** Null sink path for curl -o (Windows cmd.exe vs POSIX shells). */
export function getCurlNullSink(platform = process.platform) {
  return platform === 'win32' ? 'NUL' : '/dev/null'
}

/**
 * Parse a client_credentials token response.
 * Returns a structured result so callers can fail with a clear root cause
 * instead of silently falling through to initialize without a bearer.
 */
export function parseClientCredentialsMint({ status, bodyText }) {
  if (!status || status < 200 || status >= 300) {
    return {
      ok: false,
      error: `HTTP ${status ?? 'unknown'}`,
      bodyPreview: trimBodyPreview(bodyText),
    }
  }

  let parsed
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return {
      ok: false,
      error: 'response is not valid JSON',
      bodyPreview: trimBodyPreview(bodyText),
    }
  }

  const token = parsed?.access_token
  if (typeof token !== 'string' || token.length === 0) {
    return {
      ok: false,
      error: 'JSON body missing non-empty access_token',
      bodyPreview: trimBodyPreview(bodyText),
    }
  }

  return { ok: true, token }
}

/** Build curl HEAD probe with platform-correct output sink. */
export function buildCurlHeadStatusCommand(url, platform = process.platform) {
  const nullSink = getCurlNullSink(platform)
  return `curl -sS -o ${nullSink} -w "%{http_code}" --max-time 10 -I "${url}"`
}

function trimBodyPreview(bodyText, max = 200) {
  if (typeof bodyText !== 'string' || bodyText.length === 0) return '(empty body)'
  return bodyText.slice(0, max)
}
