/**
 * FILE: packages/cli/src/cli-shared.ts
 * PURPOSE: Shared HTTP client + terminal helpers for @mushi-mushi/cli command modules
 *          (apiCall, die, requireConfig, fmtDate/pad).
 */

import { loadConfig } from './config.js'
import type { CliConfig } from './config.js'
import { MUSHI_CLI_VERSION } from './version.js'
import { getAbortSignal } from './signals.js'
import { CLOUD_API_ENDPOINT } from './endpoint.js'
import { resolveConsoleUrlSync, consoleUrl } from './console-url.js'
import { MushiCliError, printAndExit } from './errors.js'

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Reject malformed IDs before destructive API calls. */
export function requireUuid(value: string, label = 'id'): string {
  if (UUID_RX.test(value)) return value
  throw new MushiCliError(
    'E_INVALID_INPUT',
    `${label} must be a valid UUID`,
    'copy the full id from `mushi reports list` or the console URL',
  )
}

// ─── API client ─────────────────────────────────────────────────────────────

export const API_TIMEOUT_MS = 15_000

export interface EndpointHealthProbe {
  ok: boolean
  status: number
  latencyMs: number
  body: Record<string, unknown>
}

/** Canonical GET /health probe — shared by `mushi ping` and `mushi deploy check`. */
export async function probeEndpointHealth(endpoint: string): Promise<EndpointHealthProbe> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${endpoint}/health`, { signal: controller.signal })
    clearTimeout(timer)
    const body: Record<string, unknown> = res.headers.get('content-type')?.includes('json')
      ? await res.json().catch(() => ({}))
      : {}
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - t0, body }
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/**
 * Typed API response envelope. Every Mushi sync endpoint returns
 * `{ ok: true, data: T }` or `{ ok: false, error: { code, message } }`.
 */
export interface ApiOk<T> { ok: true; data: T; meta?: Record<string, unknown> }
export interface ApiError { ok: false; error: { code: string; message: string }; httpStatus?: number }
export type ApiResult<T> = ApiOk<T> | ApiError

/**
 * Make an authenticated request to a Mushi sync endpoint.
 *
 * - Always resolves (never throws on HTTP errors) — callers inspect `result.ok`.
 * - Handles non-JSON responses gracefully (router 404s, Supabase gateway errors).
 * - Enforces a 15 s timeout so CI pipelines don't hang forever.
 * - Sends `X-Mushi-Api-Key` header; sync endpoints use `apiKeyAuth` which
 *   reads that header and resolves the project from the API key's DB row.
 */
export async function apiCall<T = unknown>(
  path: string,
  config: CliConfig,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const endpoint = config.endpoint
  if (!endpoint) {
    return {
      ok: false,
      error: {
        code: 'NO_ENDPOINT',
        message:
          'No API endpoint configured.\n' +
          '  Run: mushi login --api-key <key> --endpoint <url> --project-id <id>\n' +
          '  Or:  export MUSHI_API_ENDPOINT=https://<project-ref>.supabase.co/functions/v1/api',
      },
    }
  }

  // Per-request timeout AND process-wide SIGINT/SIGTERM abort: combine
  // the two signals so whichever fires first wins. AbortSignal.any was
  // standardised in Node 20 — matches the CLI's `engines.node: ">=20"`.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  const signals = [controller.signal, getAbortSignal()]
  const compositeSignal = AbortSignal.any
    ? AbortSignal.any(signals)
    : controller.signal

  try {
    const res = await fetch(`${endpoint}${path}`, {
      ...options,
      signal: compositeSignal,
      headers: {
        'Content-Type': 'application/json',
        // `apiKeyAuth` reads X-Mushi-Api-Key; the Authorization header is a
        // fallback accepted by some older middleware. Both are sent.
        'Authorization': `Bearer ${config.apiKey ?? ''}`,
        'X-Mushi-Api-Key': config.apiKey ?? '',
        'X-Mushi-Project': config.projectId ?? '',
        'X-Mushi-Cli-Version': MUSHI_CLI_VERSION,
        ...options.headers,
      },
    })

    clearTimeout(timer)

    // Safe JSON parse — gateway 404s and Deno edge runtime cold-start errors
    // return plain text. Wrapping protects callers from an unhandled exception.
    let body: unknown
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try { body = await res.json() } catch { body = null }
    } else {
      const text = await res.text()
      try { body = JSON.parse(text) } catch {
        // Non-JSON body — surface as a structured error.
        body = {
          ok: false,
          error: {
            code: `HTTP_${res.status}`,
            message: text.trim().slice(0, 300) || `HTTP ${res.status}`,
          },
        }
      }
    }

    // Normalise: if the server returned a bare error object without `ok: false`
    if (
      !res.ok &&
      typeof body === 'object' &&
      body !== null &&
      !('ok' in body)
    ) {
      const b = body as Record<string, unknown>
      // Backend may nest error under { error: { code, message } } — unwrap it
      // so die() can see INSUFFICIENT_SCOPE and emit targeted hints.
      const nested = b['error'] as Record<string, unknown> | undefined
      const errCode = (nested?.['code'] as string) ?? (b['code'] as string) ?? `HTTP_${res.status}`
      const errMsg  = (nested?.['message'] as string) ?? (b['message'] as string) ?? `Request failed (${res.status})`
      return {
        ok: false,
        httpStatus: res.status,
        error: { code: errCode, message: errMsg },
      }
    }

    return body as ApiResult<T>
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `Request timed out after ${API_TIMEOUT_MS / 1000}s. Check your network or endpoint.`,
        },
      }
    }
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

// ─── Output format ───────────────────────────────────────────────────────────

export type OutputFormat = 'text' | 'json'

// Process-wide output format, set once by the global `-o/--output` option in
// index.ts (via a Commander preAction hook, before any command action runs).
// Individual commands still accept their historical `--json` flag; both funnel
// through `outputIsJson()` so either mechanism works.
let globalOutputFormat: OutputFormat = 'text'

/** Set the global output format. Called once from the CLI bootstrap. */
export function setGlobalOutputFormat(fmt: string | undefined): void {
  globalOutputFormat = fmt === 'json' ? 'json' : 'text'
}

/** The global output format (default 'text'). */
export function getGlobalOutputFormat(): OutputFormat {
  return globalOutputFormat
}

/**
 * Resolve whether to emit JSON: true when the global `-o json` OR a command's
 * local `--json` flag is set. Commands pass their own flag so a per-command
 * `--json` keeps working and a global `-o json` covers commands uniformly.
 */
export function outputIsJson(localJsonFlag?: boolean): boolean {
  return globalOutputFormat === 'json' || localJsonFlag === true
}

/**
 * Print a result in the resolved format. In JSON mode prints
 * `JSON.stringify(data)`; otherwise invokes `render(data)` for human output.
 */
export function printResult<T>(
  data: T,
  opts: { json?: boolean; render: (data: T) => void },
): void {
  if (outputIsJson(opts.json)) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  opts.render(data)
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Print an API error and exit with the appropriate code.
 * Recognises INSUFFICIENT_SCOPE and prints a targeted fix hint so users are
 * never left with a bare 403 and no guidance.
 */
export function die(result: ApiError, exitCode = 1): never {
  const { code, message } = result.error
  const status = result.httpStatus ? ` [${result.httpStatus}]` : ''
  process.stderr.write(`error${status}: ${code} — ${message}\n`)
  if (code === 'INSUFFICIENT_SCOPE') {
    process.stderr.write(
      '\n  Your current API key does not have the required scope for this command.\n' +
      '  New keys minted by the wizard already include both scopes. Existing keys\n' +
      '  can be upgraded with:\n\n' +
      '    mushi login --upgrade-scope\n\n' +
      '  Or visit your console → Projects → API Keys to mint a new key.\n',
    )
  }
  process.exit(exitCode)
}

/**
 * Load config and assert that api key + endpoint are present.
 * Exits with code 2 (config error) if either is missing.
 * Falls back to the Mushi Cloud endpoint when no endpoint is configured.
 */
export function requireConfig(opts: { needsProject?: boolean } = {}): Required<Pick<CliConfig, 'apiKey' | 'endpoint'>> & CliConfig {
  const config = loadConfig()
  if (!config.apiKey) {
    printAndExit(new MushiCliError(
      'E_AUTH_MISSING',
      'API key not configured.',
      'Run: mushi login --api-key <key>  Or: export MUSHI_API_KEY=<key>',
    ))
  }
  if (!config.endpoint) {
    config.endpoint = process.env.MUSHI_API_ENDPOINT?.trim() || CLOUD_API_ENDPOINT
  }
  if (opts.needsProject && !config.projectId) {
    printAndExit(new MushiCliError(
      'E_PROJECT_MISSING',
      'Project ID not configured.',
      `Run: mushi login --project-id <uuid>  Or find your project ID at ${consoleUrl(resolveConsoleUrlSync(), '/projects')}`,
    ))
  }
  return config as Required<Pick<CliConfig, 'apiKey' | 'endpoint'>> & CliConfig
}

/** Format a UTC date string to a compact local date+time string. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

/** Right-pad a string to a fixed width (for aligned table output). */
export function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}
