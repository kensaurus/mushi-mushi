/**
 * FILE: packages/server/supabase/functions/_shared/connectors/runtime.ts
 * PURPOSE: Run connectors for one project (Plan 019 §5.3, Phase 2): build
 *          each connector's context (legacy-backed kinds from the project's
 *          existing settings; connector_instances from Vault refs), snapshot,
 *          validate, store the current snapshot, and return drift findings.
 *
 * A connector with no credential yields `not_connected` and no snapshot — not
 * an error. A connector that throws or returns invalid data yields an `error`
 * snapshot row with the reason, so its elements read `error`, never `ok`.
 * Each connector is bounded by its own deadline.
 */

import type { getServiceClient } from '../db.ts'
import { resolveRecipeRepo } from '../recipe-github.ts'
import { resolveSupabasePat } from '../supabase-mcp-client.ts'
import { resolveEffectivePlatformSettings } from '../integration-settings.ts'
import { dereferenceMaybeVault } from '../integration-probes.ts'
import { resolveCredential } from './credentials.ts'
import { getConnector, LEGACY_BACKED } from './index.ts'
import { validateSnapshot } from './schema.ts'
import { ConnectorError, type ConnectorBinding, type ConnectorContext, type ConnectorKind, type ConnectorSnapshot, type ConnectorStatus, type DriftFinding, type RecipeConnector } from './types.ts'

type Db = ReturnType<typeof getServiceClient>

export const CONNECTOR_TIMEOUT_MS = 45_000
const MAX_CONNECTORS_PER_PROJECT = 10

export interface ConnectorEntry {
  connector: RecipeConnector
  instanceId: string | null
  ctx: ConnectorContext
  bindings: ConnectorBinding[]
}

export interface ConnectorRunResult {
  kind: ConnectorKind
  instanceId: string | null
  status: ConnectorStatus
  reason: string | null
  snapshot: ConnectorSnapshot | null
  findings: DriftFinding[]
}

export interface RuntimeDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  now: () => Date
}

export const liveRuntimeDeps: RuntimeDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
}

function baseCtx(db: Db, deps: RuntimeDeps, organizationId: string, projectId: string): Omit<ConnectorContext, 'readCredential' | 'writeCredential' | 'config'> {
  return { db, organizationId, projectId, fetch: deps.fetch, now: deps.now }
}

/** Every connector that serves a project: legacy-backed kinds plus bound connector_instances. */
export async function loadConnectorEntries(db: Db, projectId: string, deps: RuntimeDeps, manifest: unknown): Promise<ConnectorEntry[]> {
  const { data: project } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  const organizationId = (project as { organization_id?: string } | null)?.organization_id
  if (!organizationId) return []
  const base = baseCtx(db, deps, organizationId, projectId)
  const out: ConnectorEntry[] = []

  // Legacy-backed: the existing project settings, no credential migrated.
  const repo = await resolveRecipeRepo(db, projectId).catch(() => null)
  out.push({
    connector: getConnector('github'), instanceId: null, bindings: [],
    ctx: { ...base, readCredential: repo?.ok ? repo.repo.token : null, writeCredential: null, config: repo?.ok ? { owner: repo.repo.ref.owner, repo: repo.repo.ref.repo, defaultBranchHint: repo.repo.defaultBranchHint, migrationsDir: (manifest as { data?: { migrationsDir?: unknown } } | null)?.data?.migrationsDir ?? null } : {} },
  })
  const { data: settings } = await db.from('project_settings').select('supabase_project_ref').eq('project_id', projectId).maybeSingle()
  const ref = (settings as { supabase_project_ref?: string | null } | null)?.supabase_project_ref ?? null
  out.push({
    connector: getConnector('supabase'), instanceId: null, bindings: [],
    ctx: { ...base, readCredential: ref ? await resolveSupabasePat(db as never, projectId).catch(() => null) : null, writeCredential: null, config: { projectRef: ref } },
  })
  const platform = await resolveEffectivePlatformSettings(db as never, projectId).catch(() => null)
  const ps = (platform?.settings ?? {}) as Record<string, string | null>
  out.push({
    connector: getConnector('sentry'), instanceId: null, bindings: [],
    ctx: { ...base, readCredential: await dereferenceMaybeVault(db as never, ps.sentry_auth_token_ref ?? null).catch(() => null), writeCredential: null, config: { orgSlug: ps.sentry_org_slug ?? null, projectSlug: ps.sentry_project_slug ?? null } },
  })
  out.push({ connector: getConnector('public_probe'), instanceId: null, bindings: [], ctx: { ...base, readCredential: null, writeCredential: null, config: { manifest } } })

  // Instances bound to this project (or owned by it).
  const { data: binds } = await db.from('connector_bindings').select('connector_instance_id, project_id, external_id, role').eq('project_id', projectId)
  const bindRows = (binds ?? []) as Array<{ connector_instance_id: string; project_id: string; external_id: string; role: string }>
  const ids = [...new Set(bindRows.map((b) => b.connector_instance_id))]
  const { data: owned } = await db.from('connector_instances').select('id').eq('project_id', projectId)
  for (const o of (owned ?? []) as Array<{ id: string }>) if (!ids.includes(o.id)) ids.push(o.id)
  if (ids.length) {
    const { data: rows } = await db
      .from('connector_instances')
      .select('id, kind, organization_id, read_credential_ref, write_credential_ref, enabled_capabilities, config')
      .in('id', ids)
      .eq('organization_id', organizationId)
    for (const r of ((rows ?? []) as Array<{ id: string; kind: string; read_credential_ref: string | null; write_credential_ref: string | null; enabled_capabilities: string[]; config: Record<string, unknown> }>).slice(0, MAX_CONNECTORS_PER_PROJECT)) {
      if ((LEGACY_BACKED as readonly string[]).includes(r.kind) && r.kind !== 'public_probe') continue
      let connector: RecipeConnector
      try {
        connector = getConnector(r.kind)
      } catch {
        continue
      }
      const wantsWrite = r.enabled_capabilities.includes('act') || r.enabled_capabilities.includes('propose')
      out.push({
        connector,
        instanceId: r.id,
        bindings: bindRows.filter((b) => b.connector_instance_id === r.id).map((b) => ({ projectId: b.project_id, externalId: b.external_id, role: b.role })),
        ctx: {
          ...base,
          readCredential: await resolveCredential(db, r.read_credential_ref),
          writeCredential: wantsWrite ? await resolveCredential(db, r.write_credential_ref) : null,
          config: r.config ?? {},
        },
      })
    }
  }
  return out
}

function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new ConnectorError(`${label} took longer than ${Math.round(ms / 1000)} s.`)), ms)
    }),
  ])
}

async function storeSnapshot(db: Db, entry: ConnectorEntry, ok: boolean, snapshot: ConnectorSnapshot | null, error: string | null): Promise<void> {
  const key = entry.instanceId
    ? db.from('connector_snapshots').update({ is_current: false }).eq('connector_instance_id', entry.instanceId).eq('project_id', entry.ctx.projectId as string)
    : db.from('connector_snapshots').update({ is_current: false }).is('connector_instance_id', null).eq('kind', entry.connector.kind).eq('project_id', entry.ctx.projectId as string)
  await key.eq('is_current', true)
  await db.from('connector_snapshots').insert({
    connector_instance_id: entry.instanceId,
    kind: entry.connector.kind,
    project_id: entry.ctx.projectId,
    organization_id: entry.ctx.organizationId,
    ok,
    error,
    snapshot,
    is_current: true,
    observed_at: entry.ctx.now().toISOString(),
  })
}

async function previousSnapshot(db: Db, entry: ConnectorEntry): Promise<ConnectorSnapshot | null> {
  let q = db.from('connector_snapshots').select('snapshot').eq('project_id', entry.ctx.projectId as string).eq('is_current', true).eq('ok', true)
  q = entry.instanceId ? q.eq('connector_instance_id', entry.instanceId) : q.eq('kind', entry.connector.kind).is('connector_instance_id', null)
  const { data } = await q.maybeSingle()
  return ((data as { snapshot?: ConnectorSnapshot } | null)?.snapshot) ?? null
}

/** Snapshot one connector, store it, and return its drift findings. Never throws. */
export async function runConnector(db: Db, entry: ConnectorEntry, manifest: unknown): Promise<ConnectorRunResult> {
  const kind = entry.connector.kind
  if (!entry.ctx.readCredential && kind !== 'public_probe') {
    return { kind, instanceId: entry.instanceId, status: 'not_connected', reason: `${entry.connector.title} is not connected for this project.`, snapshot: null, findings: [] }
  }
  try {
    const prev = await previousSnapshot(db, entry)
    const raw = await withDeadline(entry.connector.snapshot(entry.ctx, entry.bindings), CONNECTOR_TIMEOUT_MS, entry.connector.title)
    const v = validateSnapshot(raw)
    if (!v.ok) {
      await storeSnapshot(db, entry, false, null, `invalid snapshot: ${v.error}`)
      return { kind, instanceId: entry.instanceId, status: 'error', reason: `${entry.connector.title} returned data Mushi cannot read.`, snapshot: null, findings: [] }
    }
    await storeSnapshot(db, entry, true, v.snapshot, null)
    const findings = entry.connector.detectDrift ? entry.connector.detectDrift(prev, v.snapshot, manifest) : []
    return { kind, instanceId: entry.instanceId, status: 'connected', reason: null, snapshot: v.snapshot, findings }
  } catch (err) {
    const status: ConnectorStatus = err instanceof ConnectorError ? err.status : 'error'
    const reason = ((err as Error)?.message ?? String(err)).slice(0, 300)
    if (status === 'not_connected') return { kind, instanceId: entry.instanceId, status, reason, snapshot: null, findings: [] }
    await storeSnapshot(db, entry, false, null, reason).catch(() => {})
    return { kind, instanceId: entry.instanceId, status, reason, snapshot: null, findings: [] }
  }
}
