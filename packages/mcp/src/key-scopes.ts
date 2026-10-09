// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Which tools the configured key can actually use.
 *
 * Two fix agents on 2026-10-09 got INSUFFICIENT_SCOPE from search_reports and
 * get_report_detail: their MUSHI_API_KEY was an SDK key (report:write), which
 * can send reports but not read them. Every tool was listed anyway, and
 * diagnose_setup itself needs mcp:read, so nothing said what was wrong. At
 * start-up the stdio server now asks /v1/sync/whoami for the key's scopes:
 * with no MCP scope it serves setup mode and explains the fix; with only
 * mcp:read it hides the write tools. Any failure keeps today's behaviour.
 */
import type { McpScope } from './catalog.js'

/** The key's scopes from GET /v1/sync/whoami, or null when they cannot be read. */
export async function fetchKeyScopes(opts: {
  apiEndpoint: string
  apiKey: string
  projectId?: string
  fetch?: typeof fetch
  timeoutMs?: number
}): Promise<string[] | null> {
  const doFetch = opts.fetch ?? fetch
  try {
    const res = await doFetch(`${opts.apiEndpoint.replace(/\/+$/, '')}/v1/sync/whoami`, {
      headers: {
        'X-Mushi-Api-Key': opts.apiKey,
        ...(opts.projectId ? { 'X-Mushi-Project-Id': opts.projectId } : {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { ok?: boolean; data?: { scopes?: unknown } }
    const scopes = body?.data?.scopes
    // An older server answers without `scopes`: unknown, not "no scopes".
    if (!Array.isArray(scopes)) return null
    return scopes.filter((s): s is string => typeof s === 'string')
  } catch {
    return null
  }
}

export type ScopeDecision =
  | { kind: 'serve'; scopes: readonly McpScope[] }
  | { kind: 'sdk-key'; keyScopes: string[] }

/**
 * What to serve for a key: `mcp:write` implies `mcp:read`; a key with
 * neither is an SDK key. `configured` (MUSHI_SCOPES) is the upper bound.
 */
export function decideScopes(keyScopes: string[] | null, configured: readonly McpScope[]): ScopeDecision {
  if (keyScopes === null) return { kind: 'serve', scopes: configured }
  const granted = new Set<McpScope>()
  if (keyScopes.includes('mcp:write')) {
    granted.add('mcp:read')
    granted.add('mcp:write')
  } else if (keyScopes.includes('mcp:read')) {
    granted.add('mcp:read')
  }
  if (granted.size === 0) return { kind: 'sdk-key', keyScopes }
  return { kind: 'serve', scopes: configured.filter((s) => granted.has(s)) }
}

/** The stderr report and diagnose_setup detail for an SDK key. */
export function sdkKeyReport(keyScopes: string[], consoleUrl: string): string {
  const held = keyScopes.length > 0 ? keyScopes.join(', ') : 'none'
  return [
    '',
    `[mushi-mcp] This API key has scopes: ${held}. It can send bug reports (the SDK key) but not read them,`,
    '            so the MCP tools would all be refused. Serving setup mode.',
    `            Fix: mint an MCP key in the console (${consoleUrl}/mcp → "Mint mcp:read key"),`,
    '            or run `mushi login`, then put it in MUSHI_API_KEY for this server and restart it.',
    '',
  ].join('\n')
}
