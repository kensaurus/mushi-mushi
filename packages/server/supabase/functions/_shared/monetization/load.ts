/**
 * FILE: packages/server/supabase/functions/_shared/monetization/load.ts
 * PURPOSE: Build the inputs of the monetization rules from what Mushi already
 *          stores: current connector snapshots (revenuecat, the GitHub
 *          snapshot's billing catalog, App Store Connect and Play product
 *          states), RevenueCat bindings and each app's recipe. No vendor call
 *          happens here; the recipe collector reads the vendors daily.
 *
 * Used by the radar (one app at a time) and the console's Monetization card
 * (every hub in a team), so both say the same thing.
 */

import type { getServiceClient } from '../db.ts'
import type { RevenueCatProjectFacts } from '../connectors/revenuecat.ts'
import { catalogPathOf, type BillingCatalog } from './catalog.ts'
import type { CatalogInput, MonetizationHub, MonetizationProject, StoreRead } from './rules.ts'

type Db = ReturnType<typeof getServiceClient>

interface SnapshotRow {
  kind: string
  project_id: string
  ok: boolean
  error: string | null
  observed_at: string | null
  snapshot: { facts?: Record<string, any> } | null
  /** GitHub rows select only the catalog (`snapshot->facts->billingCatalog`). */
  catalog?: GithubCatalogFact | null
}

interface GithubCatalogFact { path: string; catalog?: BillingCatalog; error?: string }

export interface MonetizationSources {
  organizationId: string
  projects: Array<{ id: string; name: string; manifest: unknown }>
  /** Mushi project → the RevenueCat connector binding it has. */
  rcBindings: Map<string, { instanceId: string; rcProjectId: string }>
  /** RevenueCat connector instances in the team (never credentials). */
  rcInstances: Array<{ id: string; status: string | null; enabledCapabilities: string[] }>
  snapshots: SnapshotRow[]
}

const STORE_NOT_RE_READ = 'This store has not been re-read since product states were added. It is read daily.'

export async function loadMonetizationSources(db: Db, organizationId: string): Promise<MonetizationSources> {
  const { data: projectRows } = await db.from('projects').select('id, name').eq('organization_id', organizationId).limit(200)
  const projects = ((projectRows ?? []) as Array<{ id: string; name: string | null }>)
  const ids = projects.map((p) => p.id)
  if (ids.length === 0) return { organizationId, projects: [], rcBindings: new Map(), rcInstances: [], snapshots: [] }
  const [{ data: recipes }, { data: instances }, { data: snaps }, { data: gh }] = await Promise.all([
    db.from('app_recipe_snapshots').select('project_id, manifest').in('project_id', ids).eq('is_current', true),
    db.from('connector_instances').select('id, kind, status, enabled_capabilities').eq('organization_id', organizationId).eq('kind', 'revenuecat'),
    db.from('connector_snapshots').select('kind, project_id, ok, error, observed_at, snapshot').in('project_id', ids).eq('is_current', true).in('kind', ['revenuecat', 'app_store_connect', 'play_console']),
    // Only the catalog out of each GitHub snapshot: the rest (workflow files) is large.
    db.from('connector_snapshots').select('kind, project_id, ok, error, observed_at, catalog:snapshot->facts->billingCatalog').in('project_id', ids).eq('is_current', true).eq('kind', 'github'),
  ])
  const manifestOf = new Map(((recipes ?? []) as Array<{ project_id: string; manifest: unknown }>).map((r) => [r.project_id, r.manifest]))
  const rcInstances = ((instances ?? []) as Array<{ id: string; status: string | null; enabled_capabilities: string[] | null }>).map((i) => ({ id: i.id, status: i.status, enabledCapabilities: i.enabled_capabilities ?? [] }))
  const { data: binds } = rcInstances.length
    ? await db.from('connector_bindings').select('connector_instance_id, project_id, external_id').in('connector_instance_id', rcInstances.map((i) => i.id))
    : { data: [] }
  const rcBindings = new Map<string, { instanceId: string; rcProjectId: string }>()
  for (const b of (binds ?? []) as Array<{ connector_instance_id: string; project_id: string; external_id: string }>) {
    if (ids.includes(b.project_id) && !rcBindings.has(b.project_id)) rcBindings.set(b.project_id, { instanceId: b.connector_instance_id, rcProjectId: b.external_id })
  }
  const githubRows = ((gh ?? []) as Array<SnapshotRow & { snapshot?: SnapshotRow['snapshot'] }>).map((r) => ({ ...r, catalog: r.catalog ?? r.snapshot?.facts?.billingCatalog ?? null, snapshot: null }))
  return {
    organizationId,
    projects: projects.map((p) => ({ id: p.id, name: p.name ?? p.id.slice(0, 8), manifest: manifestOf.get(p.id) ?? null })),
    rcBindings,
    rcInstances,
    snapshots: [...((snaps ?? []) as SnapshotRow[]), ...githubRows],
  }
}

function snap(sources: MonetizationSources, kind: string, projectId: string): SnapshotRow | undefined {
  return sources.snapshots.find((s) => s.kind === kind && s.project_id === projectId)
}

function storeRead(sources: MonetizationSources, kind: 'app_store_connect' | 'play_console', projectId: string): StoreRead | null {
  const row = snap(sources, kind, projectId)
  if (!row) return null
  if (!row.ok || !row.snapshot) return { state: 'unknown', reason: (row.error ?? 'the store could not be read').slice(0, 200) }
  const app = ((row.snapshot.facts?.apps ?? []) as Array<{ projectId?: string; products?: StoreRead }>).find((a) => a.projectId === projectId)
  if (!app) return { state: 'unknown', reason: 'No store app is bound to this app on the connector.' }
  return app.products ?? { state: 'unknown', reason: STORE_NOT_RE_READ }
}

/** The catalog for a hub: one whose project id is the hub (or names none), read through GitHub. */
export function catalogFor(sources: MonetizationSources, rcProjectId: string | null): CatalogInput {
  const declared = sources.projects.filter((p) => catalogPathOf(p.manifest))
  if (declared.length === 0) return { state: 'none' }
  let failure: CatalogInput | null = null
  let fallback: CatalogInput | null = null
  for (const p of declared) {
    const row = snap(sources, 'github', p.id)
    const source = `${p.name}: ${catalogPathOf(p.manifest)}`
    if (!row) {
      failure ??= { state: 'error', reason: 'GitHub has not been read for that project yet.', source }
      continue
    }
    if (!row.ok) {
      failure ??= { state: 'error', reason: `GitHub could not be read: ${(row.error ?? 'unknown error').slice(0, 160)}`, source }
      continue
    }
    const fact = row.catalog
    if (!fact) {
      failure ??= { state: 'error', reason: 'GitHub has not been re-read since the catalog was declared.', source }
      continue
    }
    if (!fact.catalog) {
      failure ??= { state: 'error', reason: fact.error ?? 'The file could not be read.', source }
      continue
    }
    if (rcProjectId && fact.catalog.projectId === rcProjectId) return { state: 'read', catalog: fact.catalog, source }
    // A catalog for another hub still names its hub, so app_outside_hub can say where an app belongs
    // (and catalog drift reads it as "describes another project", not as a match).
    fallback ??= { state: 'read', catalog: fact.catalog, source }
  }
  return fallback ?? failure!
}

function rcFacts(sources: MonetizationSources, projectId: string, rcProjectId: string): { rc: RevenueCatProjectFacts | null; missing?: MonetizationHub['rcMissing']; observedAt: string | null } {
  const row = snap(sources, 'revenuecat', projectId)
  if (!row) return { rc: null, missing: { state: 'unknown', reason: 'RevenueCat is connected but has not been read yet. It is read daily at 03:35 UTC.' }, observedAt: null }
  if (!row.ok || !row.snapshot) return { rc: null, missing: { state: 'error', reason: `RevenueCat could not be read: ${(row.error ?? 'unknown error').slice(0, 200)}` }, observedAt: row.observed_at }
  const rc = ((row.snapshot.facts?.projects ?? []) as RevenueCatProjectFacts[]).find((p) => p.rcProjectId === rcProjectId) ?? null
  return rc ? { rc, observedAt: row.observed_at } : { rc: null, missing: { state: 'unknown', reason: `The last RevenueCat read did not include project ${rcProjectId}.` }, observedAt: row.observed_at }
}

function project(sources: MonetizationSources, p: { id: string; name: string; manifest: unknown }): MonetizationProject {
  return {
    id: p.id, name: p.name, manifest: p.manifest,
    rcProjectId: sources.rcBindings.get(p.id)?.rcProjectId ?? null,
    ios: storeRead(sources, 'app_store_connect', p.id),
    android: storeRead(sources, 'play_console', p.id),
  }
}

/** One app's hub: its own RevenueCat read (or why there is none), the catalog and its store states. */
export function hubForProject(sources: MonetizationSources, projectId: string): MonetizationHub {
  const p = sources.projects.find((x) => x.id === projectId) ?? { id: projectId, name: projectId.slice(0, 8), manifest: null }
  const rcProjectId = sources.rcBindings.get(projectId)?.rcProjectId ?? null
  const rc = rcProjectId ? rcFacts(sources, projectId, rcProjectId) : { rc: null, missing: undefined }
  return { rc: rc.rc, ...(rc.missing ? { rcMissing: rc.missing } : {}), catalog: catalogFor(sources, rcProjectId), projects: [project(sources, p)] }
}

export interface OrgHub {
  rcProjectId: string
  instanceId: string
  observedAt: string | null
  hub: MonetizationHub
}

/** Every RevenueCat hub in the team, with all the apps bound to it; the newest read of each hub wins. */
export function orgHubs(sources: MonetizationSources): { hubs: OrgHub[]; unbound: MonetizationProject[] } {
  const byRc = new Map<string, Array<{ id: string; name: string; manifest: unknown }>>()
  for (const p of sources.projects) {
    const b = sources.rcBindings.get(p.id)
    if (b) byRc.set(b.rcProjectId, [...(byRc.get(b.rcProjectId) ?? []), p])
  }
  const hubs: OrgHub[] = []
  for (const [rcProjectId, members] of byRc) {
    const reads = members.map((m) => rcFacts(sources, m.id, rcProjectId))
    const best = reads.filter((r) => r.rc).sort((a, b) => Date.parse(b.observedAt ?? '') - Date.parse(a.observedAt ?? ''))[0] ?? reads[0]
    hubs.push({
      rcProjectId,
      instanceId: sources.rcBindings.get(members[0].id)!.instanceId,
      observedAt: best?.observedAt ?? null,
      hub: { rc: best?.rc ?? null, ...(best?.missing && !best.rc ? { rcMissing: best.missing } : {}), catalog: catalogFor(sources, rcProjectId), projects: members.map((m) => project(sources, m)) },
    })
  }
  return { hubs, unbound: sources.projects.filter((p) => !sources.rcBindings.has(p.id)).map((p) => project(sources, p)) }
}
