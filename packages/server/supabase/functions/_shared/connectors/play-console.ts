/**
 * FILE: packages/server/supabase/functions/_shared/connectors/play-console.ts
 * PURPOSE: The Google Play Console connector (Plan 019 §2b, Plan 020 §5).
 *          A service account signs an RS256 assertion for an OAuth token
 *          (scope androidpublisher). Snapshot: tracks, releases, version
 *          codes and rollout %, read through a temporary edit that is
 *          deleted, never committed.
 *
 * Act (Plan 020 Phase 4, ADR 0017): `set_rollout` and `promote_track` are
 * implemented but run ONLY through executeConnectorAction
 * (_shared/connector-actions.ts), which consumes a human-approved,
 * hash-matched, single-use, unexpired connector_actions row. This file also
 * re-checks the payload hash itself. Nothing here runs on a schedule. Per
 * Play's API terms the operator's own service account does the publishing.
 *
 * readCredential (read) / writeCredential (act): the service-account JSON.
 */

import { sha256Hex, signJwt } from './jwt.ts'
import { failureOfStatus, fetchJson, statusReason, vendorError, type JsonResponse } from './http-util.ts'
import { canonicalJson } from './canonical.ts'
import { ConnectorError, notConnected, type ApprovedConnectorAction, type ConnectorActionResult, type ConnectorContext, type RecipeConnector } from './types.ts'

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PKG = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/
const TRACKS = new Set(['internal', 'alpha', 'beta', 'production'])

interface ServiceAccount { client_email: string; private_key: string }

function parseSa(raw: string | null): ServiceAccount | null {
  if (!raw) return null
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>
    if (typeof sa.client_email === 'string' && typeof sa.private_key === 'string') return sa as ServiceAccount
  } catch {
    // fall through
  }
  return null
}

async function accessToken(ctx: ConnectorContext, sa: ServiceAccount): Promise<string> {
  const iat = Math.floor(ctx.now().getTime() / 1000)
  const assertion = await signJwt('RS256', sa.private_key, {}, {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: TOKEN_URL, iat, exp: iat + 3600,
  })
  const res = await fetchJson<{ access_token?: string; error?: string }>(ctx, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
  })
  // Google answers a revoked, deleted or mistyped service-account key with 400 invalid_grant (or 401).
  if (res.status !== 200 || !res.body?.access_token) throw new ConnectorError(`Google refused the service account (${res.body?.error ?? res.status}).`, 'error', res.status === 400 || res.status === 401 ? 'credential_rejected' : failureOfStatus(res.status))
  return res.body.access_token
}

function api(ctx: ConnectorContext, tokenValue: string, method: string, path: string, body?: unknown) {
  return fetchJson<any>(ctx, `${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenValue}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

export interface PlayTrack {
  track: string
  releases: Array<{ name: string | null; versionCodes: string[]; status: string; userFraction: number | null }>
}

/** Read every track through a temporary edit that is always deleted. */
async function readTracks(ctx: ConnectorContext, tokenValue: string, pkg: string): Promise<PlayTrack[]> {
  const edit = await api(ctx, tokenValue, 'POST', `/${pkg}/edits`)
  if (edit.status !== 200 || !edit.body?.id) throw vendorError('Google Play', edit.status)
  try {
    const tracks = await api(ctx, tokenValue, 'GET', `/${pkg}/edits/${edit.body.id}/tracks`)
    if (tracks.status !== 200) throw vendorError('Google Play', tracks.status)
    return ((tracks.body?.tracks ?? []) as Array<Record<string, any>>).map((t) => ({
      track: String(t.track),
      releases: ((t.releases ?? []) as Array<Record<string, any>>).map((r) => ({
        name: r.name ?? null, versionCodes: (r.versionCodes ?? []).map(String), status: String(r.status ?? ''), userFraction: typeof r.userFraction === 'number' ? r.userFraction : null,
      })),
    }))
  } finally {
    await api(ctx, tokenValue, 'DELETE', `/${pkg}/edits/${edit.body.id}`).catch(() => {})
  }
}

/** True for an Android package name (com.example.app). */
export function isPlayPackage(value: unknown): value is string {
  return typeof value === 'string' && PKG.test(value)
}

/**
 * One read-only GET under applications/ with the read service account (the
 * store review intake lists reviews with it). Throws ConnectorError
 * `not_connected` when there is no readable key.
 */
export async function playConsoleGet(ctx: ConnectorContext, path: string): Promise<JsonResponse<unknown>> {
  const sa = parseSa(ctx.readCredential)
  if (!sa) throw new ConnectorError('Google Play is not connected.', 'not_connected')
  const t = await accessToken(ctx, sa)
  return fetchJson<unknown>(ctx, `${API}${path}`, { headers: { Authorization: `Bearer ${t}` } })
}

export const playConsoleConnector: RecipeConnector = {
  kind: 'play_console',
  title: 'Google Play Console',
  capabilities: ['snapshot', 'drift', 'act'],
  requiredScopes: {
    snapshot: ['View app information (read-only)'],
    act: ['Release to production, exclude devices, and use Play App Signing', 'Release apps to testing tracks'],
  },
  credentialNote: 'Invite a service account with app-level "View app information" for reading. Releasing (rollout %, promote a track) needs release permissions and a separate write key, and every release is approved by a person first.',
  actions: ['set_rollout', 'promote_track'],
  async probe(ctx) {
    const sa = parseSa(ctx.readCredential)
    if (!sa) return notConnected('Add a Google Play service account key (JSON).')
    const pkg = ctx.config.package
    if (typeof pkg !== 'string' || !PKG.test(pkg)) return notConnected('Bind an Android package name to this connector.')
    try {
      const t = await accessToken(ctx, sa)
      await readTracks(ctx, t, pkg)
      const granted = ['View app information (read-only)']
      return { ok: true, status: 'connected', granted, missing: ctx.writeCredential ? [] : ['Release apps to testing tracks'] }
    } catch (err) {
      // Only a 403 means the read permission is missing; a rejected key, a 404 or a network error is not a scope problem.
      const failure = err instanceof ConnectorError ? err.failure : undefined
      return {
        ok: false, status: 'error', granted: [],
        missing: failure === 'permission_missing' ? ['View app information (read-only)'] : [],
        reason: (err as Error).message.slice(0, 200),
        ...(failure ? { failure } : {}),
      }
    }
  },
  async snapshot(ctx, bindings) {
    const sa = parseSa(ctx.readCredential)
    if (!sa) throw new ConnectorError('Google Play is not connected.', 'not_connected')
    const t = await accessToken(ctx, sa)
    const apps: Array<{ projectId: string; package: string; tracks: PlayTrack[] }> = []
    for (const b of bindings.filter((x) => PKG.test(x.externalId)).slice(0, 10)) {
      apps.push({ projectId: b.projectId, package: b.externalId, tracks: await readTracks(ctx, t, b.externalId) })
    }
    const prod = apps[0]?.tracks.find((x) => x.track === 'production')?.releases[0] ?? null
    return {
      observedAt: ctx.now().toISOString(),
      elements: { deploy: { summary: { androidLive: prod?.name ?? null, rolloutPct: prod?.userFraction != null ? Math.round(prod.userFraction * 100) : prod ? 100 : null } } },
      resources: apps.map((a) => ({ kind: 'bundle_id', externalId: `android:${a.package}`, role: 'play' })),
      facts: { apps },
    }
  },
  detectDrift(_prev, next) {
    const apps = (next.facts.apps ?? []) as Array<{ package: string; tracks: PlayTrack[] }>
    return apps.flatMap((a) => a.tracks.flatMap((t) => t.releases
      .filter((r) => r.status === 'halted')
      .map((r) => ({ gate: 'deploy_drift', ruleId: 'rollout_halted', severity: 'warn' as const, message: `The ${t.track} release ${r.name ?? r.versionCodes.join(',')} of ${a.package} is halted.`, suggestedFix: { kind: 'prompt' as const, text: 'Check why the rollout was halted in Play Console before resuming it.' } }))))
  },
  async act(ctx, action: ApprovedConnectorAction): Promise<ConnectorActionResult> {
    if (await sha256Hex(canonicalJson(action.payload)) !== action.payloadSha256) return { ok: false, detail: 'The payload does not match what was approved.' }
    const sa = parseSa(ctx.writeCredential)
    if (!sa) return { ok: false, detail: 'No write key is stored for Google Play.' }
    const p = action.payload as { package?: string; track?: string; toTrack?: string; userFraction?: number; versionCodes?: string[] }
    if (typeof p.package !== 'string' || !PKG.test(p.package)) return { ok: false, detail: 'The payload has no valid package name.' }
    const t = await accessToken(ctx, sa)
    const edit = await api(ctx, t, 'POST', `/${p.package}/edits`)
    if (edit.status !== 200 || !edit.body?.id) return { ok: false, detail: statusReason('Google Play', edit.status) }
    const editId = edit.body.id
    try {
      let body: unknown
      let track: string
      if (action.action === 'set_rollout') {
        if (!p.track || !TRACKS.has(p.track) || typeof p.userFraction !== 'number' || p.userFraction <= 0 || p.userFraction > 1 || !Array.isArray(p.versionCodes) || p.versionCodes.length === 0) {
          return { ok: false, detail: 'set_rollout needs track, versionCodes and a userFraction between 0 and 1.' }
        }
        track = p.track
        body = { track, releases: [{ versionCodes: p.versionCodes.map(String), status: p.userFraction === 1 ? 'completed' : 'inProgress', ...(p.userFraction < 1 ? { userFraction: p.userFraction } : {}) }] }
      } else if (action.action === 'promote_track') {
        if (!p.track || !p.toTrack || !TRACKS.has(p.track) || !TRACKS.has(p.toTrack) || !Array.isArray(p.versionCodes) || p.versionCodes.length === 0) {
          return { ok: false, detail: 'promote_track needs track, toTrack and versionCodes.' }
        }
        track = p.toTrack
        const fraction = typeof p.userFraction === 'number' && p.userFraction > 0 && p.userFraction < 1 ? p.userFraction : null
        body = { track, releases: [{ versionCodes: p.versionCodes.map(String), status: fraction ? 'inProgress' : 'completed', ...(fraction ? { userFraction: fraction } : {}) }] }
      } else {
        return { ok: false, detail: `Unknown Play action ${action.action}.` }
      }
      const put = await api(ctx, t, 'PUT', `/${p.package}/edits/${editId}/tracks/${track}`, body)
      if (put.status !== 200) return { ok: false, detail: statusReason('Google Play', put.status) }
      const commit = await api(ctx, t, 'POST', `/${p.package}/edits/${editId}:commit`)
      if (commit.status !== 200) return { ok: false, detail: statusReason('Google Play', commit.status) }
      return { ok: true, detail: `Committed ${action.action} on ${track}.`, result: { editId, track } }
    } finally {
      // A committed edit is gone already; deleting an open one discards it.
      await api(ctx, t, 'DELETE', `/${p.package}/edits/${editId}`).catch(() => {})
    }
  },
}
