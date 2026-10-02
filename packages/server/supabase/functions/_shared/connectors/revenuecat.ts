/**
 * FILE: packages/server/supabase/functions/_shared/connectors/revenuecat.ts
 * PURPOSE: `revenuecat` (ADR 0017, Plan 020 §7): read-only REST v2 view of
 *          entitlements, offerings and apps per RevenueCat project, so Mushi
 *          can check that apps meant to share a "portfolio pass" really sit
 *          in one RevenueCat project (entitlements are shared only inside
 *          one project) and that each store app is registered. Mushi never
 *          holds balances or changes purchases.
 *
 * Bindings: externalId = the RevenueCat project id, one per Mushi project.
 * readCredential: a v2 secret key with read-only permissions.
 */

import { fetchJson, statusReason } from './http-util.ts'
import { ConnectorError, notConnected, type ConnectorContext, type DriftFinding, type RecipeConnector } from './types.ts'

const API = 'https://api.revenuecat.com/v2'
const ID = /^[\w-]{3,64}$/

function rc(ctx: ConnectorContext, path: string) {
  return fetchJson<any>(ctx, `${API}${path}`, { headers: { Authorization: `Bearer ${ctx.readCredential}` } })
}

export interface RevenueCatProjectFacts {
  rcProjectId: string
  projectIds: string[]
  entitlements: Array<{ lookupKey: string; name: string | null }>
  offerings: Array<{ lookupKey: string; isCurrent: boolean }>
  apps: Array<{ type: string; storeId: string | null }>
}

export const revenuecatConnector: RecipeConnector = {
  kind: 'revenuecat',
  title: 'RevenueCat',
  capabilities: ['snapshot', 'drift'],
  requiredScopes: { snapshot: ['project configuration: read only'] },
  credentialNote: 'Use a v2 secret key with read-only permissions. Mushi reads entitlements, offerings and apps; it never reads customers or changes purchases.',
  async probe(ctx) {
    if (!ctx.readCredential) return notConnected('Add a RevenueCat v2 secret key with read-only permissions.')
    const res = await rc(ctx, '/projects?limit=1')
    if (res.status === 200) return { ok: true, status: 'connected', granted: ['project configuration: read only'], missing: [] }
    return { ok: false, status: 'error', granted: [], missing: res.status === 403 ? ['project configuration: read only'] : [], reason: statusReason('RevenueCat', res.status) }
  },
  async snapshot(ctx, bindings) {
    if (!ctx.readCredential) throw new ConnectorError('RevenueCat is not connected.', 'not_connected')
    const byRc = new Map<string, string[]>()
    for (const b of bindings) if (ID.test(b.externalId)) byRc.set(b.externalId, [...(byRc.get(b.externalId) ?? []), b.projectId])
    const projects: RevenueCatProjectFacts[] = []
    for (const [rcId, projectIds] of [...byRc].slice(0, 10)) {
      const [ent, off, apps] = await Promise.all([
        rc(ctx, `/projects/${rcId}/entitlements?limit=100`),
        rc(ctx, `/projects/${rcId}/offerings?limit=100`),
        rc(ctx, `/projects/${rcId}/apps?limit=100`),
      ])
      for (const r of [ent, off, apps]) if (r.status !== 200) throw new ConnectorError(statusReason('RevenueCat', r.status))
      projects.push({
        rcProjectId: rcId,
        projectIds,
        entitlements: ((ent.body?.items ?? []) as Array<Record<string, any>>).map((e) => ({ lookupKey: String(e.lookup_key ?? ''), name: e.display_name ?? null })),
        offerings: ((off.body?.items ?? []) as Array<Record<string, any>>).map((o) => ({ lookupKey: String(o.lookup_key ?? ''), isCurrent: o.is_current === true })),
        apps: ((apps.body?.items ?? []) as Array<Record<string, any>>).map((a) => ({
          type: String(a.type ?? ''),
          storeId: a.app_store?.bundle_id ?? a.play_store?.package_name ?? null,
        })),
      })
    }
    return {
      observedAt: ctx.now().toISOString(),
      elements: { integrations: { summary: { revenuecatProjects: projects.length } } },
      resources: projects.map((p) => ({ kind: 'revenuecat_project', externalId: p.rcProjectId, role: 'billing' })),
      facts: { projects },
    }
  },
  detectDrift(_prev, next, manifests) {
    // `manifests` here is { [projectId]: manifest } — the portfolio passes every app's recipe.
    const ms = (manifests && typeof manifests === 'object' ? manifests : {}) as Record<string, any>
    const projects = (next.facts.projects ?? []) as RevenueCatProjectFacts[]
    const rcOf = new Map<string, string>()
    for (const p of projects) for (const id of p.projectIds) rcOf.set(id, p.rcProjectId)
    const out: DriftFinding[] = []
    for (const [projectId, m] of Object.entries(ms)) {
      const shared = Array.isArray(m?.links?.billing?.sharedCreditsWith) ? m.links.billing.sharedCreditsWith.map(String) : []
      for (const other of shared) {
        const a = rcOf.get(projectId)
        const b = rcOf.get(other)
        if (a && b && a !== b) {
          out.push({ gate: 'radar', ruleId: 'revenuecat_project_split', severity: 'warn', message: `These apps share credits, but sit in two RevenueCat projects (${a} and ${b}). Entitlements are only shared inside one project, so a purchase in one app will not unlock the other.`, suggestedFix: { kind: 'prompt', text: 'Move both apps into one RevenueCat project, or stop declaring shared credits.' } })
        }
      }
      const rcProject = projects.find((p) => p.projectIds.includes(projectId))
      const ids = [m?.app?.ids?.bundleId, m?.app?.ids?.androidPackage].filter((x): x is string => typeof x === 'string')
      if (rcProject) {
        for (const id of ids) {
          if (!rcProject.apps.some((a) => a.storeId === id)) {
            out.push({ gate: 'radar', ruleId: 'revenuecat_app_missing', severity: 'warn', message: `The store app ${id} is not registered in its RevenueCat project, so its purchases will not be seen.`, suggestedFix: { kind: 'prompt', text: `Add ${id} as an app in RevenueCat project ${rcProject.rcProjectId}.` } })
          }
        }
        if (rcProject.entitlements.length > 0 && !rcProject.offerings.some((o) => o.isCurrent)) {
          out.push({ gate: 'radar', ruleId: 'revenuecat_offering_missing', severity: 'info', message: `RevenueCat project ${rcProject.rcProjectId} has entitlements but no current offering, so the paywall has nothing to show.`, suggestedFix: { kind: 'prompt', text: 'Mark one offering as current in RevenueCat.' } })
        }
      }
    }
    return out
  },
}
