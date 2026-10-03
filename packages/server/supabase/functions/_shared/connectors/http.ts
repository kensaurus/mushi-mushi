/**
 * FILE: packages/server/supabase/functions/_shared/connectors/http.ts
 * PURPOSE: The generic signed HTTP connector (Plan 019 §2b) for systems Mushi
 *          has no connector for, including legacy ones. Mushi POSTs a signed
 *          request to the host's own https endpoint; the host answers with a
 *          ConnectorSnapshot. Mushi signs with the instance's HMAC secret in
 *          the plugin-sdk format (`X-Mushi-Signature: t=<ms>,v1=<hex>`, over
 *          `${t}.${body}`), so the host verifies with `verifySignature` from
 *          @mushi-mushi/plugin-sdk. 1 MB cap, 10 s deadline, SSRF-safe,
 *          Zod-validated. No third-party code runs on Mushi's edge.
 */

import { publicFetch } from '../safe-fetch.ts'
import { hmacSha256Hex } from './jwt.ts'
import { validateSnapshot } from './schema.ts'
import { ConnectorError, notConnected, type ConnectorSnapshot, type DriftFinding, type RecipeConnector } from './types.ts'

function endpointOf(config: Record<string, unknown>): string | null {
  const u = config.endpoint
  if (typeof u !== 'string') return null
  try {
    return new URL(u).protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

export async function signedBody(secret: string, payload: unknown, nowMs: number): Promise<{ body: string; signature: string }> {
  const body = JSON.stringify(payload)
  const v1 = await hmacSha256Hex(secret, `${nowMs}.${body}`)
  return { body, signature: `t=${nowMs},v1=${v1}` }
}

async function call(ctx: Parameters<RecipeConnector['probe']>[0], kind: 'probe' | 'snapshot', extra: Record<string, unknown> = {}) {
  const endpoint = endpointOf(ctx.config)
  if (!endpoint) throw new ConnectorError('No https endpoint is set for this connector.', 'not_connected')
  if (!ctx.readCredential) throw new ConnectorError('No signing secret is stored for this connector.', 'not_connected')
  const signed = await signedBody(ctx.readCredential, { kind, organizationId: ctx.organizationId, requestedAt: ctx.now().toISOString(), ...extra }, ctx.now().getTime())
  return publicFetch(endpoint, { fetchImpl: ctx.fetch as typeof fetch, signedPost: signed, accept: 'application/json' })
}

export const httpConnector: RecipeConnector = {
  kind: 'http',
  title: 'Your own endpoint (signed HTTP)',
  capabilities: ['snapshot', 'drift'],
  requiredScopes: { snapshot: ['endpoint answers a signed POST with a snapshot'] },
  credentialNote: 'Mushi stores a signing secret, not a key to your system. Your endpoint checks the signature and decides what to return.',
  async probe(ctx) {
    if (!endpointOf(ctx.config)) return notConnected('Set the https endpoint Mushi should call.')
    if (!ctx.readCredential) return notConnected('Store a signing secret for this endpoint.')
    try {
      const res = await call(ctx, 'probe')
      if (res.status >= 200 && res.status < 300) return { ok: true, status: 'connected', granted: ['snapshot'], missing: [] }
      if (res.status === 401 || res.status === 403) return { ok: false, status: 'error', granted: [], missing: ['snapshot'], reason: 'Your endpoint refused the signature. Check it uses the same secret.' }
      return { ok: false, status: 'error', granted: [], missing: [], reason: `Your endpoint answered ${res.status}.` }
    } catch (err) {
      return { ok: false, status: 'error', granted: [], missing: [], reason: `Could not reach your endpoint: ${(err as Error).message.slice(0, 160)}` }
    }
  },
  async snapshot(ctx, bindings) {
    const res = await call(ctx, 'snapshot', { bindings })
    if (res.truncated) throw new ConnectorError('Your endpoint returned more than 1 MB.')
    if (res.status < 200 || res.status >= 300) throw new ConnectorError(`Your endpoint answered ${res.status}.`)
    let raw: unknown
    try {
      raw = JSON.parse(res.text)
    } catch {
      throw new ConnectorError('Your endpoint did not return JSON.')
    }
    const v = validateSnapshot(raw)
    if (!v.ok) throw new ConnectorError(`Your endpoint returned a snapshot Mushi cannot read: ${v.error}`)
    return v.snapshot
  },
  detectDrift(_prev, next: ConnectorSnapshot): DriftFinding[] {
    const list = Array.isArray(next.facts.findings) ? next.facts.findings : []
    return list.slice(0, 100).flatMap((f): DriftFinding[] => {
      const x = f as Record<string, unknown>
      if (typeof x.ruleId !== 'string' || typeof x.message !== 'string') return []
      const severity = x.severity === 'error' || x.severity === 'warn' ? x.severity : 'info'
      return [{ gate: 'portfolio_radar', ruleId: x.ruleId.slice(0, 80), severity, message: x.message.slice(0, 500) }]
    })
  },
}
