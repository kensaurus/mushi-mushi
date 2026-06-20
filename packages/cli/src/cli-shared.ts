/**
 * FILE: packages/cli/src/cli-shared.ts
 * PURPOSE: Shared HTTP client + terminal helpers for the @mushi-mushi/cli command
 *          modules. Extracted from the former monolithic `index.ts` so each
 *          command group module (src/commands/*.ts) can import the same typed
 *          `apiCall`, error/exit helpers, and formatting utilities.
 *
 * OVERVIEW:
 * - `apiCall<T>` — authenticated request to a Mushi sync endpoint; never throws.
 * - `die` — print an API error and exit with the appropriate code.
 * - `requireConfig` — load config and assert api key + endpoint (+ optional project).
 * - `fmtDate` / `pad` — compact date + fixed-width string formatting for tables.
 *
 * DEPENDENCIES:
 * - ./config.js — CliConfig type + loadConfig().
 * - ./version.js — MUSHI_CLI_VERSION (sent as a request header).
 * - ./signals.js — getAbortSignal() (process-wide SIGINT/SIGTERM abort).
 *
 * USAGE:
 * - Imported by index.ts and every src/commands/*.ts module.
 *
 * TECHNICAL DETAILS:
 * - The API envelope (ApiOk / ApiError / ApiResult) is the single source of
 *   truth for sync endpoint responses across the CLI.
 *
 * NOTES:
 * - Behaviour is byte-for-byte identical to the prior inline implementation;
 *   this is a pure code-move refactor (no behaviour change).
 */

import { loadConfig } from './config.js'
import type { CliConfig } from './config.js'
import { MUSHI_CLI_VERSION } from './version.js'
import { getAbortSignal } from './signals.js'
import { CLOUD_API_ENDPOINT } from './endpoint.js'
import { resolveConsoleUrlSync, consoleUrl } from './console-url.js'

// ─── API client ─────────────────────────────────────────────────────────────

export const API_TIMEOUT_MS = 15_000

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
      return {
        ok: false,
        httpStatus: res.status,
        error: {
          code: (b['code'] as string) ?? `HTTP_${res.status}`,
          message: (b['message'] as string) ?? `Request failed (${res.status})`,
        },
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

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Print an API error and exit with the appropriate code. */
export function die(result: ApiError, exitCode = 1): never {
  const { code, message } = result.error
  const status = result.httpStatus ? ` [${result.httpStatus}]` : ''
  process.stderr.write(`error${status}: ${code} — ${message}\n`)
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
    process.stderr.write(
      'error: API key not configured.\n' +
      '  Run:  mushi login --api-key <key>\n' +
      '  Or:   export MUSHI_API_KEY=<key>\n',
    )
    process.exit(2)
  }
  // Default to the Mushi Cloud endpoint — self-hosters override via env or config.
  if (!config.endpoint) {
    config.endpoint = process.env.MUSHI_API_ENDPOINT?.trim() || CLOUD_API_ENDPOINT
  }
  if (opts.needsProject && !config.projectId) {
    process.stderr.write(
      'error: Project ID not configured.\n' +
      '  Run:  mushi login --project-id <uuid>\n' +
      '  Or:   export MUSHI_PROJECT_ID=<uuid>\n' +
      '  Find your project ID: ' + consoleUrl(resolveConsoleUrlSync(), '/projects') + '\n',
    )
    process.exit(2)
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
