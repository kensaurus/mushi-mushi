/**
 * FILE: packages/server/supabase/functions/api/routes/release-kits.ts
 * PURPOSE: The release kit (Plan 025 P5) and store media upload requests
 *          (P6), ADR 0074. Served by `api-ext` (api forwards these paths).
 *
 *   GET    /v1/admin/projects/:id/releases/:rid/kit                         (mcp:read)  the kit, its assets (signed 1 h), checks per preset, store targets, upload requests
 *   PUT    /v1/admin/projects/:id/releases/:rid/kit                         (mcp:write) { preset?, brand?, changelog?, clipsEnabled? }
 *   POST   /v1/admin/projects/:id/releases/:rid/kit/refresh                 (mcp:write) copy the release's before/after baselines into the kit
 *   POST   /v1/admin/projects/:id/releases/:rid/kit/uploads                 (mcp:write) { files: [...] } → signed upload URLs (clips, device recordings, the rendered video)
 *   POST   /v1/admin/projects/:id/releases/:rid/kit/assets/:aid/finalize    (mcp:write) { sha256? } after the PUT: hash, measure, mark ready
 *   DELETE /v1/admin/projects/:id/releases/:rid/kit/assets/:aid             (mcp:write)
 *   POST   /v1/admin/projects/:id/releases/:rid/kit/export                  (mcp:write) → { kitUrl, expiresAt, manifest } (export_release_kit)
 *   POST   /v1/admin/projects/:id/releases/:rid/kit/store-upload            (mcp:write) → a connector_actions row waiting for a person's
 *                                                                            approval (console JWT only), never an upload
 *   POST   …/kit/store-upload/:actionId/execute                              console JWT, owner/admin: runs one approved upload
 *                                                                            once. The only route that injects the uploaders
 *                                                                            (store-media-act.ts); the generic execute refuses them.
 *
 * Mushi never renders video. Uploads to a store run only after an owner or
 * admin approves the exact payload in the console (ADR 0017's exception).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { toPublicSupabaseUrl } from '../../_shared/public-url.ts'
import { executeConnectorAction, requestConnectorAction } from '../../_shared/connector-actions.ts'
import { isStoreMediaAction, type StoreMediaActs } from '../../_shared/connectors/types.ts'
import { storeMediaActs } from '../../_shared/connectors/store-media-act.ts'
import {
  checkAsset,
  EmptyKitError,
  KIT_MIMES,
  KIT_PRESETS,
  kitReadiness,
  PRESET_SPECS,
  STORE_UPLOAD_ACTIONS,
  storeUploadPayload,
} from '../../_shared/release-kit.ts'
import {
  ensureKit,
  exportKit,
  finalizeAsset,
  KitMigrationPending,
  kitAssets,
  kitBrand,
  loadKitSettings,
  loadRelease,
  refreshScreenshots,
  refuseUpload,
  removeAsset,
  reserveUpload,
  signAssets,
  type KitRelease,
  type KitRow,
} from '../../_shared/release-kit-db.ts'
import { loadSecurityProof } from '../../_shared/security-proof-db.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'

const klog = log.child('release-kits')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VIEW_URL_TTL_SEC = 3600

type Db = ReturnType<typeof getServiceClient>

export interface ReleaseKitRouteDeps {
  getServiceClient: () => Db
  readAuth: MiddlewareHandler
  writeAuth: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  callerCanAccessProject: typeof callerCanAccessProject
  requestAction: typeof requestConnectorAction
  executeAction: typeof executeConnectorAction
  storeMedia: StoreMediaActs
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  publicUrl: (u: string) => string
  now: () => Date
}

export const defaultReleaseKitRouteDeps: ReleaseKitRouteDeps = {
  getServiceClient,
  readAuth: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  writeAuth: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  callerCanAccessProject,
  requestAction: requestConnectorAction,
  executeAction: executeConnectorAction,
  storeMedia: storeMediaActs,
  fetch: (url, init) => fetch(url, init),
  publicUrl: (u) => toPublicSupabaseUrl(u),
  now: () => new Date(),
}

const brandSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  theme: z.enum(['light', 'dark', 'auto']).nullable().optional(),
  logoUrl: z.string().url().startsWith('https://').max(500).nullable().optional(),
}).strict()

const putSchema = z.object({
  preset: z.enum(KIT_PRESETS).optional(),
  brand: brandSchema.optional(),
  changelog: z.array(z.string().min(1).max(140)).max(12).optional(),
  clipsEnabled: z.boolean().optional(),
}).strict()

const uploadSchema = z.object({
  files: z.array(z.object({
    name: z.string().min(1).max(120),
    kind: z.enum(['screenshot_before', 'screenshot_after', 'clip', 'device_recording', 'product_video']),
    mime: z.enum(KIT_MIMES),
    bytes: z.number().int().positive().max(104857600),
    source: z.enum(['playwright', 'upload', 'lazycow']).default('upload'),
    platform: z.enum(['web', 'ios', 'android']).nullable().optional(),
    durationMs: z.number().int().positive().max(600000).nullable().optional(),
    fps: z.number().positive().max(240).nullable().optional(),
    codec: z.string().max(40).nullable().optional(),
    width: z.number().int().positive().max(8192).nullable().optional(),
    height: z.number().int().positive().max(8192).nullable().optional(),
    surfacePath: z.string().max(500).nullable().optional(),
    label: z.string().max(200).nullable().optional(),
  })).min(1).max(12),
})

const storeSchema = z.object({
  connectorId: z.string().uuid(),
  action: z.enum(['upload_screenshots', 'upload_app_preview', 'upload_listing_images', 'set_promo_video']),
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  displayType: z.string().max(40).optional(),
  previewType: z.string().max(40).optional(),
  imageType: z.string().max(40).optional(),
  replace: z.boolean().optional(),
  youtubeUrl: z.string().url().max(200).optional(),
  previewFrameTimeCode: z.string().regex(/^\d{2}:\d{2}:\d{2}:\d{2}$/).optional(),
  assetIds: z.array(z.string().uuid()).max(10).default([]),
  reason: z.string().max(500).optional(),
}).strict()

export function registerReleaseKitRoutes(app: Hono<{ Variables: Variables }>, deps: ReleaseKitRouteDeps = defaultReleaseKitRouteDeps): void {
  // Literal paths: the route manifest and the MCP catalog check read them as written.
  app.get('/v1/admin/projects/:id/releases/:rid/kit', deps.readAuth, (c) => withKit(c, deps, 'read', getKit))
  app.put('/v1/admin/projects/:id/releases/:rid/kit', deps.writeAuth, (c) => withKit(c, deps, 'write', putKit))
  app.post('/v1/admin/projects/:id/releases/:rid/kit/refresh', deps.writeAuth, (c) => withKit(c, deps, 'write', postRefresh))
  app.post('/v1/admin/projects/:id/releases/:rid/kit/uploads', deps.writeAuth, (c) => withKit(c, deps, 'write', postUploads))
  app.post('/v1/admin/projects/:id/releases/:rid/kit/assets/:aid/finalize', deps.writeAuth, (c) => withKit(c, deps, 'write', postFinalize))
  app.delete('/v1/admin/projects/:id/releases/:rid/kit/assets/:aid', deps.writeAuth, (c) => withKit(c, deps, 'write', deleteAsset))
  app.post('/v1/admin/projects/:id/releases/:rid/kit/export', deps.writeAuth, (c) => withKit(c, deps, 'write', postExport))
  app.post('/v1/admin/projects/:id/releases/:rid/kit/store-upload', deps.writeAuth, (c) => withKit(c, deps, 'write', postStoreUpload))
  // Run one approved store upload: a person signed in to the console, owner or admin. Approve and reject stay on
  // /v1/admin/orgs/:orgId/connector-actions/:id/approve|reject; this is the only place the uploaders are injected.
  app.post('/v1/admin/projects/:id/releases/:rid/kit/store-upload/:actionId/execute', deps.jwtAuth, (c) => withKit(c, deps, 'write', postStoreExecute))
}

interface KitCtx { db: Db; projectId: string; release: KitRelease; kit: KitRow; userId: string }
type Handler = (c: Context, deps: ReleaseKitRouteDeps, k: KitCtx) => Promise<Response>

async function withKit(c: Context, deps: ReleaseKitRouteDeps, mode: 'read' | 'write', handler: Handler): Promise<Response> {
  const projectId = c.req.param('id') ?? ''
  const releaseId = c.req.param('rid') ?? ''
  if (!UUID_RE.test(projectId) || !UUID_RE.test(releaseId)) return jsonError(c, 'VALIDATION_ERROR', 'id and rid must be uuids', 400)
  const db = deps.getServiceClient()
  const userId = c.get('userId') as string
  const access = await deps.callerCanAccessProject(c, db, userId, projectId)
  if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403)
  if (mode === 'write') {
    const viewer = denyViewerWrite(c, (access.role as string | null | undefined) ?? null, 'change a release kit')
    if (viewer) return viewer
  }
  try {
    const release = await loadRelease(db as never, projectId, releaseId)
    if (!release) return jsonError(c, 'NOT_FOUND', 'No such release in this project.', 404)
    const kit = await ensureKit(db as never, release, userId ?? null)
    return await handler(c, deps, { db, projectId, release, kit, userId })
  } catch (err) {
    if (err instanceof KitMigrationPending) return jsonError(c, 'MIGRATION_PENDING', err.message, 409)
    klog.warn('release kit request failed', { projectId, releaseId, err: String(err).slice(0, 200) })
    return jsonError(c, 'DB_ERROR', 'The release kit could not be read or saved. Try again in a moment.', 500)
  }
}

async function storeTargets(db: Db, projectId: string): Promise<Array<{ connectorId: string; kind: string; name: string; externalId: string; actEnabled: boolean; actions: readonly string[] }>> {
  const { data: bindings } = await db.from('connector_bindings').select('connector_instance_id, external_id').eq('project_id', projectId).limit(50)
  const rows = (bindings ?? []) as Array<{ connector_instance_id: string; external_id: string }>
  if (!rows.length) return []
  const { data: inst } = await db.from('connector_instances').select('id, kind, display_name, enabled_capabilities').in('id', rows.map((r) => r.connector_instance_id)).in('kind', ['app_store_connect', 'play_console'])
  return ((inst ?? []) as Array<{ id: string; kind: 'app_store_connect' | 'play_console'; display_name: string; enabled_capabilities: string[] }>).flatMap((i) => {
    const b = rows.find((r) => r.connector_instance_id === i.id)
    return b ? [{ connectorId: i.id, kind: i.kind, name: i.display_name, externalId: b.external_id, actEnabled: (i.enabled_capabilities ?? []).includes('act'), actions: STORE_UPLOAD_ACTIONS[i.kind] }] : []
  })
}

async function getKit(c: Context, deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const [assets, settings, brand, targets, actions, project] = await Promise.all([
    kitAssets(k.db as never, k.kit.id),
    loadKitSettings(k.db as never, k.projectId),
    kitBrand(k.db as never, k.kit),
    storeTargets(k.db, k.projectId),
    k.db.from('connector_actions').select('id, action, status, payload, payload_sha256, reason, requested_by, requested_at, expires_at, error, result').eq('project_id', k.projectId).eq('payload->>kitId', k.kit.id).order('requested_at', { ascending: false }).limit(20),
    k.db.from('projects').select('organization_id').eq('id', k.projectId).maybeSingle(),
  ])
  const urls = await signAssets(k.db as never, assets, VIEW_URL_TTL_SEC, deps.publicUrl)
  const preset = (c.req.query('preset') as typeof KIT_PRESETS[number] | undefined) ?? k.kit.preset
  const p = (KIT_PRESETS as readonly string[]).includes(preset) ? preset : k.kit.preset
  return c.json({
    ok: true,
    data: {
      kit: { id: k.kit.id, preset: k.kit.preset, changelog: k.kit.changelog, brand, exportedAt: k.kit.exported_at, exportCount: k.kit.export_count },
      release: { id: k.release.id, version: k.release.version, title: k.release.title, status: k.release.status, publishedAt: k.release.published_at, commitSha: k.release.commit_sha },
      assets: assets.map((a) => ({ ...a, url: urls.get(a.id) ?? null, ...checkAsset(a, p) })),
      readiness: kitReadiness(assets, p),
      presets: Object.values(PRESET_SPECS),
      settings,
      storeTargets: targets,
      storeActions: (actions as { data?: unknown[] }).data ?? [],
      // The approve / run routes are the team's: /v1/admin/orgs/:orgId/connector-actions/:id/approve|reject|execute.
      organizationId: ((project as { data?: { organization_id?: string } | null }).data?.organization_id) ?? null,
    },
  })
}

async function putKit(c: Context, _deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const parsed = putSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'That kit change is not valid.', 400, { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) })
  const b = parsed.data
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (b.preset) patch.preset = b.preset
  if (b.brand) patch.brand = { ...(k.kit.brand ?? {}), ...b.brand }
  if (b.changelog) patch.changelog = b.changelog
  const { error } = await k.db.from('release_kits').update(patch).eq('id', k.kit.id)
  if (error) return jsonError(c, 'DB_ERROR', 'The kit could not be saved.', 500)
  if (b.clipsEnabled !== undefined) {
    const { error: sErr } = await k.db.from('project_settings').update({ release_kit_clips_enabled: b.clipsEnabled }).eq('project_id', k.projectId)
    if (sErr) return jsonError(c, 'DB_ERROR', 'The clip setting could not be saved.', 500)
  }
  return c.json({ ok: true, data: { saved: true } })
}

async function postRefresh(c: Context, _deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const out = await refreshScreenshots(k.db as never, k.kit, k.release)
  return c.json({ ok: true, data: out })
}

async function postUploads(c: Context, deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const parsed = uploadSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'Those files are not valid.', 400, { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) })
  const [settings, assets] = await Promise.all([loadKitSettings(k.db as never, k.projectId), kitAssets(k.db as never, k.kit.id)])
  let videos = assets.filter((a) => a.mime.startsWith('video/') && a.status !== 'rejected').length
  const uploads: Array<{ name: string; assetId: string; signedUrl: string }> = []
  let n = assets.length
  for (const f of parsed.data.files) {
    const refusal = refuseUpload(f, settings, videos)
    if (refusal) return jsonError(c, refusal.code, refusal.message, refusal.code === 'CLIPS_OFF' ? 403 : 400, { uploads })
    n++
    const r = await reserveUpload(k.db as never, k.kit, f, n)
    if (f.mime.startsWith('video/')) videos++
    uploads.push({ name: f.name, assetId: r.assetId, signedUrl: deps.publicUrl(r.signedUrl) })
  }
  return c.json({ ok: true, data: { uploads } }, 201)
}

async function postFinalize(c: Context, _deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const aid = c.req.param('aid') ?? ''
  if (!UUID_RE.test(aid)) return jsonError(c, 'VALIDATION_ERROR', 'aid must be a uuid', 400)
  const body = (await c.req.json().catch(() => ({}))) as { sha256?: unknown }
  const sha = typeof body?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(body.sha256) ? body.sha256 : null
  const r = await finalizeAsset(k.db as never, k.kit, aid, sha)
  if ('refused' in r) return jsonError(c, 'ASSET_REFUSED', r.refused, 409)
  return c.json({ ok: true, data: r })
}

async function deleteAsset(c: Context, _deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const aid = c.req.param('aid') ?? ''
  if (!UUID_RE.test(aid)) return jsonError(c, 'VALIDATION_ERROR', 'aid must be a uuid', 400)
  return (await removeAsset(k.db as never, k.kit, aid)) ? c.json({ ok: true, data: { removed: true } }) : jsonError(c, 'NOT_FOUND', 'No such asset in this kit.', 404)
}

async function postExport(c: Context, deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const [proof, targets] = await Promise.all([
    loadSecurityProof(k.db as never, k.projectId, { release: k.release }, deps.now()).catch(() => null),
    storeTargets(k.db, k.projectId),
  ])
  const stores = targets.map((t) => (t.kind === 'app_store_connect' ? 'app-store' as const : 'google-play' as const))
  try {
    const out = await exportKit(k.db as never, k.kit, k.release, {
      now: deps.now(),
      publicUrl: deps.publicUrl,
      securityProof: proof ? { state: proof.state, headline: proof.headline } : null,
      returnTo: `/v1/admin/projects/${k.projectId}/releases/${k.release.id}/kit/uploads`,
      stores,
    })
    return c.json({ ok: true, data: out })
  } catch (err) {
    if (err instanceof EmptyKitError) return jsonError(c, 'KIT_EMPTY', err.message, 422)
    throw err
  }
}

async function postStoreExecute(c: Context, deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  if (c.get('authMethod') === 'apiKey') return jsonError(c, 'HUMAN_REQUIRED', 'Only a person signed in to the console can run a store upload. An API key can only ask.', 403)
  const actionId = c.req.param('actionId') ?? ''
  if (!UUID_RE.test(actionId)) return jsonError(c, 'NOT_FOUND', 'Action not found.', 404)
  const { data: project } = await k.db.from('projects').select('organization_id').eq('id', k.projectId).maybeSingle()
  const orgId = (project as { organization_id?: string } | null)?.organization_id
  if (!orgId) return jsonError(c, 'NOT_FOUND', 'This app has no team.', 404)
  const { data: member } = await k.db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', k.userId).maybeSingle()
  const role = (member as { role?: string } | null)?.role
  if (role !== 'owner' && role !== 'admin') return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can run store uploads.', 403)
  const { data: row } = await k.db.from('connector_actions').select('id, project_id, action, payload').eq('id', actionId).eq('organization_id', orgId).maybeSingle()
  const action = row as { project_id: string | null; action: string; payload: { kitId?: unknown } } | null
  if (!action || action.project_id !== k.projectId || action.payload?.kitId !== k.kit.id || !isStoreMediaAction(action.action)) {
    return jsonError(c, 'NOT_FOUND', 'No such store upload on this release\'s kit.', 404)
  }
  const r = await deps.executeAction(k.db, actionId, orgId, k.userId, { fetch: deps.fetch, now: deps.now, storeMedia: deps.storeMedia })
  if (!r.ok) return jsonError(c, r.code, r.message, r.status)
  return c.json({ ok: true, data: r.value })
}

async function postStoreUpload(c: Context, deps: ReleaseKitRouteDeps, k: KitCtx): Promise<Response> {
  const parsed = storeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'That upload request is not valid.', 400, { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) })
  const b = parsed.data
  const targets = await storeTargets(k.db, k.projectId)
  const target = targets.find((t) => t.connectorId === b.connectorId)
  if (!target) return jsonError(c, 'NOT_FOUND', 'That store connector is not bound to this app. Connect App Store Connect or Google Play under Connectors first.', 404)
  const built = storeUploadPayload(k.kit.id, await kitAssets(k.db as never, k.kit.id), {
    kind: target.kind as 'app_store_connect' | 'play_console',
    action: b.action,
    externalId: target.externalId,
    locale: b.locale,
    displayType: b.displayType,
    previewType: b.previewType,
    imageType: b.imageType,
    replace: b.replace,
    youtubeUrl: b.youtubeUrl,
    previewFrameTimeCode: b.previewFrameTimeCode,
    assetIds: b.assetIds,
    releaseId: k.release.id,
  })
  if (!built.ok) return jsonError(c, 'SPEC_CHECK_FAILED', built.message, 422)
  const { data: project } = await k.db.from('projects').select('organization_id').eq('id', k.projectId).maybeSingle()
  const orgId = (project as { organization_id?: string } | null)?.organization_id
  if (!orgId) return jsonError(c, 'NOT_FOUND', 'This app has no team.', 404)
  const r = await deps.requestAction(k.db, {
    organizationId: orgId,
    instanceId: target.connectorId,
    action: b.action,
    payload: built.payload,
    requestedBy: `${(c.get('authMethod') as string | undefined) === 'apiKey' ? 'agent' : 'user'}:${k.userId}`,
    reason: b.reason ?? `Release ${k.release.version}: ${b.action.replace(/_/g, ' ')}`,
    projectId: k.projectId,
  }, { storeMediaFromKit: true })
  if (!r.ok) return jsonError(c, r.code, r.message, r.status)
  return c.json({
    ok: true,
    data: {
      actionId: r.value.id,
      payloadSha256: r.value.payloadSha256,
      payload: built.payload,
      status: 'pending_approval',
      next: 'An owner or admin approves it on the release\'s kit (or Portfolio → Store and payment actions), then runs it. Nothing is uploaded before that.',
      actEnabled: target.actEnabled,
    },
  }, 201)
}
