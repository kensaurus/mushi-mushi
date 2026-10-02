/**
 * FILE: packages/server/supabase/functions/_shared/recipe-phase2.ts
 * PURPOSE: The Phase 2 / P2 half of recipe-collector (Plan 019 §5.3, gate
 *          struck by ADR 0017):
 *   collectProjectPhase2  connectors → snapshots → ci_drift / env_drift /
 *                         schema_drift / deploy_drift / budget gate runs,
 *                         ci_workflow_runs, deploy_observations (version
 *                         probes + SDK heartbeats), resource uses.
 *   collectOrgPortfolio   once per organization: cross-project rules →
 *                         portfolio_findings (open / resolved).
 *
 * A gate whose source is not connected gets NO run, so its element stays
 * not_connected / unknown — never a green pass from no data.
 */

import type { getServiceClient } from './db.ts'
import { budgetDrift, deployDrift, schemaMigrationDrift, type DeployObservation, type DriftFinding as RecipeDriftFinding } from './recipe-drift.ts'
import { loadConnectorEntries, runConnector, type ConnectorRunResult, type RuntimeDeps } from './connectors/runtime.ts'
import type { DriftFinding } from './connectors/types.ts'
import { publicFetch } from './safe-fetch.ts'
import {
  ciCostConcentration,
  completenessChecklist,
  deriveResourceUses,
  evaluateDeepLinks,
  sharedChannels,
  type DeepLinkFiles,
  type PortfolioRuleFinding,
  type ProjectKindValue,
} from './portfolio-rules.ts'

type Db = ReturnType<typeof getServiceClient>

const RECIPE_GATES = ['ci_drift', 'deploy_drift', 'env_drift', 'schema_drift'] as const
type RecipeGate = (typeof RECIPE_GATES)[number]

/** Which connector answers for which recipe gate (a gate with no connected source gets no run). */
const GATE_SOURCE: Record<RecipeGate, string[]> = {
  ci_drift: ['github'],
  env_drift: ['github', 'sentry'],
  schema_drift: ['supabase'],
  deploy_drift: ['github', 'app_store_connect', 'play_console', '__deploy_probe'],
}

export interface Phase2Deps extends RuntimeDeps {
  /** Public probe fetch (version.json, deep-link files). */
  probe: (url: string) => Promise<{ status: number; text: string }>
}

export const livePhase2Deps: Phase2Deps = {
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  probe: (url) => publicFetch(url, { accept: 'application/json' }),
}

export interface Phase2Summary {
  connectors: Array<{ kind: string; status: string; reason: string | null }>
  gates: Array<{ gate: string; status: string; findings: number }>
  deployObservations: number
  resourceUses: number
}

function worst(findings: readonly { severity: string }[]): 'pass' | 'warn' | 'fail' {
  if (findings.some((f) => f.severity === 'error')) return 'fail'
  if (findings.some((f) => f.severity === 'warn')) return 'warn'
  return 'pass'
}

async function writeGateRun(db: Db, projectId: string, gate: string, findings: readonly DriftFinding[], summary: Record<string, unknown>, commitSha: string | null, now: Date): Promise<{ gate: string; status: string; findings: number }> {
  const status = worst(findings)
  const { data: run, error } = await db
    .from('gate_runs')
    .insert({ project_id: projectId, gate, status, summary, findings_count: findings.length, triggered_by: 'recipe-collector', commit_sha: commitSha, started_at: now.toISOString(), completed_at: now.toISOString() })
    .select('id')
    .single()
  if (error || !run) throw new Error(`could not record ${gate}: ${error?.message ?? 'no row'}`)
  const runId = (run as { id: string }).id
  if (findings.length) {
    const { error: fErr } = await db.from('gate_findings').insert(findings.slice(0, 300).map((f) => ({
      gate_run_id: runId, project_id: projectId, severity: f.severity, rule_id: f.ruleId, message: f.message.slice(0, 1000),
      file_path: f.filePath ?? null, suggested_fix: f.suggestedFix ?? null, allowlisted: false,
    })))
    if (fErr) {
      await db.from('gate_runs').update({ status: 'error', summary: { ...summary, error: `findings not stored: ${fErr.message}` } }).eq('id', runId)
      return { gate, status: 'error', findings: 0 }
    }
  }
  return { gate, status, findings: findings.length }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Probe each declared deploy target and record what it runs. */
async function observeDeploys(db: Db, projectId: string, manifest: Record<string, any> | null, deps: Phase2Deps, now: Date): Promise<DeployObservation[]> {
  const targets = Array.isArray(manifest?.deploy?.targets) ? manifest!.deploy.targets.slice(0, 10) : []
  const out: DeployObservation[] = []
  for (const t of targets) {
    const id = str(t?.id)
    const type = str(t?.probe?.type)
    if (!id || !type) continue
    let obs: Omit<DeployObservation, 'observed_at'> & { kind: string | null; environment: string | null }
    if (type === 'version_json') {
      const url = str(t.probe.url)
      if (!url) continue
      try {
        const res = await deps.probe(url)
        const body = JSON.parse(res.text) as { version?: unknown; commit?: unknown }
        obs = { target_id: id, kind: str(t.kind), environment: str(t.environment), observed_version: str(body.version), observed_commit: str(body.commit), ok: res.status >= 200 && res.status < 300, error: res.status >= 300 ? `HTTP ${res.status}` : null, source: 'version_json' }
      } catch (err) {
        obs = { target_id: id, kind: str(t.kind), environment: str(t.environment), observed_version: null, observed_commit: null, ok: false, error: String((err as Error)?.message ?? err).slice(0, 200), source: 'version_json' }
      }
    } else if (type === 'sdk_heartbeat') {
      const platform = /android/i.test(String(t.kind ?? id)) ? 'android' : /ios/i.test(String(t.kind ?? id)) ? 'ios' : null
      const since = new Date(now.getTime() - 7 * 86400_000).toISOString()
      const { data } = await db.from('reports').select('environment, created_at').eq('project_id', projectId).gte('created_at', since).order('created_at', { ascending: false }).limit(200)
      const seen = ((data ?? []) as Array<{ environment: Record<string, unknown> | null }>)
        .map((r) => r.environment)
        .filter((e) => e && typeof e.app_version === 'string' && (!platform || String(e.platform ?? '').toLowerCase().includes(platform)))
      if (seen.length === 0) continue // unobserved → unknown, not a failure
      obs = { target_id: id, kind: str(t.kind), environment: str(t.environment), observed_version: String(seen[0]!.app_version), observed_commit: null, ok: true, error: null, source: 'sdk_heartbeat' }
    } else {
      continue
    }
    await db.from('deploy_observations').insert({ project_id: projectId, ...obs, observed_at: now.toISOString() })
    out.push({ ...obs, observed_at: now.toISOString() })
  }
  return out
}

/** Upsert a shared resource and return its id (read back by its natural key). */
export async function upsertResource(db: Db, organizationId: string, kind: string, externalId: string, now: Date): Promise<{ id: string } | null> {
  const { error } = await db.from('portfolio_resources').upsert({ organization_id: organizationId, kind, external_id: externalId, updated_at: now.toISOString() }, { onConflict: 'organization_id,kind,external_id' })
  if (error) return null
  const { data } = await db.from('portfolio_resources').select('id').eq('organization_id', organizationId).eq('kind', kind).eq('external_id', externalId).maybeSingle()
  return (data as { id: string } | null) ?? null
}

async function upsertUses(db: Db, organizationId: string, projectId: string, uses: Array<{ kind: string; externalId: string; role: string; source: 'manifest' | 'connector' }>, now: Date): Promise<number> {
  let n = 0
  for (const u of uses.slice(0, 100)) {
    const res = await upsertResource(db, organizationId, u.kind, u.externalId, now)
    if (!res) continue
    const { error: uErr } = await db.from('portfolio_resource_uses').upsert(
      { resource_id: (res as { id: string }).id, project_id: projectId, role: u.role, source: u.source, observed_at: now.toISOString() },
      { onConflict: 'resource_id,project_id,role' },
    )
    if (!uErr) n++
  }
  return n
}

export async function collectProjectPhase2(db: Db, projectId: string, deps: Phase2Deps = livePhase2Deps): Promise<Phase2Summary> {
  const now = deps.now()
  const [{ data: snap }, { data: project }] = await Promise.all([
    db.from('app_recipe_snapshots').select('manifest').eq('project_id', projectId).eq('is_current', true).maybeSingle(),
    db.from('projects').select('id, name, organization_id').eq('id', projectId).maybeSingle(),
  ])
  const manifest = ((snap as { manifest?: Record<string, any> | null } | null)?.manifest) ?? null
  const organizationId = (project as { organization_id?: string } | null)?.organization_id ?? null
  const entries = (await loadConnectorEntries(db, projectId, deps, manifest)).filter((e) => e.connector.kind !== 'public_probe')
  const results: ConnectorRunResult[] = []
  for (const e of entries) results.push(await runConnector(db, e, manifest))

  const connected = new Set(results.filter((r) => r.status === 'connected').map((r) => r.kind as string))
  const github = results.find((r) => r.kind === 'github' && r.snapshot)?.snapshot?.facts as { headSha?: string; headCommittedAt?: string | null; runs?: Array<Record<string, unknown>> } | undefined
  const findings = results.flatMap((r) => r.findings)

  findings.push(...migrationDrift(results))

  // ci_workflow_runs from the GitHub snapshot.
  if (github?.runs?.length) {
    const repo = (results.find((r) => r.kind === 'github')?.snapshot?.resources ?? []).find((x) => x.kind === 'repo')?.externalId ?? 'unknown'
    await db.from('ci_workflow_runs').upsert(github.runs.map((x) => ({ project_id: projectId, repo, source: 'github', ...x })), { onConflict: 'project_id,repo,run_id' })
  }

  // Deploy truth: probes, then drift.
  const observations = await observeDeploys(db, projectId, manifest, deps, now)
  if (observations.length) connected.add('__deploy_probe')
  const targets = Array.isArray(manifest?.deploy?.targets) ? manifest!.deploy.targets.filter((t: any) => typeof t?.id === 'string').map((t: any) => ({ id: t.id, kind: String(t.kind ?? ''), maxLagHours: typeof t.maxLagHours === 'number' ? t.maxLagHours : undefined })) : []
  if (targets.length && (observations.length || github)) {
    const d = deployDrift({ targets, observations, headSha: github?.headSha ?? null, headCommittedAt: github?.headCommittedAt ?? null, now })
    findings.push(...d.findings.map(toConnectorFinding))
  }

  // Budgets against the latest metric values.
  const budgets = (manifest?.gates?.budgets && typeof manifest.gates.budgets === 'object') ? manifest.gates.budgets as Record<string, number> : null
  const gates: Phase2Summary['gates'] = []
  if (budgets && Object.keys(budgets).length) {
    const { data: metrics } = await db.from('metric_series').select('metric_name, value, ts').eq('project_id', projectId).in('metric_name', Object.keys(budgets)).order('ts', { ascending: false }).limit(200)
    const latest: Record<string, number> = {}
    for (const m of (metrics ?? []) as Array<{ metric_name: string; value: number }>) if (!(m.metric_name in latest)) latest[m.metric_name] = Number(m.value)
    if (Object.keys(latest).length) gates.push(await writeGateRun(db, projectId, 'code_health', budgetDrift(budgets, latest).map(toConnectorFinding), { source: 'recipe-budgets', budgets }, github?.headSha ?? null, now))
  }

  for (const gate of RECIPE_GATES) {
    if (!GATE_SOURCE[gate].some((k) => connected.has(k))) continue
    const own = findings.filter((f) => f.gate === gate)
    gates.push(await writeGateRun(db, projectId, gate, own, { source: 'connectors', connectors: GATE_SOURCE[gate].filter((k) => connected.has(k)) }, github?.headSha ?? null, now))
  }

  // Shared resources this project uses.
  let resourceUses = 0
  if (organizationId) {
    const uses = [
      ...deriveResourceUses([{ id: projectId, name: String((project as { name?: string })?.name ?? projectId), kind: null, manifest }]).map((u) => ({ kind: u.kind, externalId: u.externalId, role: u.role, source: 'manifest' as const })),
      ...results.flatMap((r) => (r.snapshot?.resources ?? []).map((x) => ({ kind: x.kind, externalId: x.externalId, role: x.role, source: 'connector' as const }))),
    ]
    resourceUses = await upsertUses(db, organizationId, projectId, uses, now)
  }

  return {
    connectors: results.map((r) => ({ kind: r.kind, status: r.status, reason: r.reason })),
    gates,
    deployObservations: observations.length,
    resourceUses,
  }
}

/**
 * Declared (the GitHub connector's migration files) vs applied (the Supabase
 * connector's schema_migrations) — the "migration is in the repo but was never
 * applied" failure. Needs both sources read; otherwise nothing is claimed.
 */
export function migrationDrift(results: readonly Pick<ConnectorRunResult, 'kind' | 'snapshot'>[]): DriftFinding[] {
  const files = (results.find((r) => r.kind === 'github' && r.snapshot)?.snapshot?.facts as { migrationFiles?: string[] | null } | undefined)?.migrationFiles ?? null
  const applied = (results.find((r) => r.kind === 'supabase' && r.snapshot)?.snapshot?.facts as { appliedVersions?: string[] | null } | undefined)?.appliedVersions ?? null
  if (!Array.isArray(files) || !Array.isArray(applied)) return []
  return schemaMigrationDrift({ declared: files, applied }).map(toConnectorFinding)
}

function toConnectorFinding(d: RecipeDriftFinding): DriftFinding {
  return { gate: d.gate, ruleId: d.ruleId, severity: d.severity, message: d.message, filePath: d.filePath ?? null, suggestedFix: d.suggestedFix }
}

// ── organization ─────────────────────────────────────────────────────────────

export async function collectOrgPortfolio(db: Db, organizationId: string, deps: Phase2Deps = livePhase2Deps): Promise<{ findings: number; resolved: number; unknown: number }> {
  const now = deps.now()
  const { data: projects } = await db.from('projects').select('id, name, kind').eq('organization_id', organizationId).limit(100)
  const rows = (projects ?? []) as Array<{ id: string; name: string | null; kind: ProjectKindValue | null }>
  if (rows.length < 2) return { findings: 0, resolved: 0, unknown: 0 }
  const ids = rows.map((p) => p.id)
  const [{ data: snaps }, { data: settings }, { data: ciRuns }] = await Promise.all([
    db.from('app_recipe_snapshots').select('project_id, manifest').in('project_id', ids).eq('is_current', true),
    db.from('project_settings').select('project_id, slack_channel_id, sentry_dsn, sentry_org_slug').in('project_id', ids),
    db.from('ci_workflow_runs').select('project_id, repo, est_billable_minutes, started_at').in('project_id', ids).gte('started_at', new Date(now.getTime() - 30 * 86400_000).toISOString()).limit(20000),
  ])
  const manifestOf = new Map(((snaps ?? []) as Array<{ project_id: string; manifest: unknown }>).map((s) => [s.project_id, s.manifest]))
  const names = rows.map((p) => ({ id: p.id, name: p.name ?? p.id.slice(0, 8) }))
  const findings: PortfolioRuleFinding[] = []

  findings.push(...sharedChannels(((settings ?? []) as Array<{ project_id: string; slack_channel_id: string | null }>).map((s) => ({ projectId: s.project_id, slackChannelId: s.slack_channel_id, pushKeyId: null })), names))

  const minutes = new Map<string, { projectId: string; repo: string; minutes30d: number }>()
  for (const r of (ciRuns ?? []) as Array<{ project_id: string; repo: string; est_billable_minutes: number | null }>) {
    const key = `${r.project_id}:${r.repo}`
    const m = minutes.get(key) ?? { projectId: r.project_id, repo: r.repo, minutes30d: 0 }
    m.minutes30d += Number(r.est_billable_minutes ?? 0)
    minutes.set(key, m)
  }
  findings.push(...ciCostConcentration([...minutes.values()]))

  // Deep links between sibling apps: fetch each declared domain's files once.
  const appLinks: Array<{ fromProjectId: string; toProjectId: string; domain: string }> = []
  const targets: Record<string, { bundleId?: string; appleTeamId?: string; androidPackage?: string }> = {}
  for (const p of rows) {
    const m = (manifestOf.get(p.id) ?? {}) as Record<string, any>
    const ids2 = m.app?.ids ?? {}
    targets[p.id] = { bundleId: str(ids2.bundleId) ?? undefined, appleTeamId: str(ids2.appleTeamId) ?? undefined, androidPackage: str(ids2.androidPackage) ?? undefined }
    for (const l of Array.isArray(m.links?.deepLinks?.appLinks) ? m.links.deepLinks.appLinks.slice(0, 20) : []) {
      const to = rows.find((x) => x.id === l?.toProject || x.name === l?.toProject)
      const domain = str((manifestOf.get(to?.id ?? '') as Record<string, any> | undefined)?.links?.deepLinks?.universalLinkDomains?.[0])
      if (to && domain) appLinks.push({ fromProjectId: p.id, toProjectId: to.id, domain })
    }
  }
  const files: Record<string, DeepLinkFiles> = {}
  for (const domain of [...new Set(appLinks.map((a) => a.domain))].slice(0, 10)) {
    const get = async (path: string) => {
      const r = await deps.probe(`https://${domain}${path}`)
      return r.status === 200 ? r.text : null
    }
    try {
      files[domain] = { aasa: await get('/.well-known/apple-app-site-association'), assetlinks: await get('/.well-known/assetlinks.json') }
    } catch (err) {
      files[domain] = { aasa: null, assetlinks: null, fetchError: String((err as Error)?.message ?? err).slice(0, 120) }
    }
  }
  const deep = evaluateDeepLinks(appLinks, files, targets, names)
  findings.push(...deep.findings)

  findings.push(...completenessChecklist(rows.map((p) => {
    const m = (manifestOf.get(p.id) ?? null) as Record<string, any> | null
    const s = ((settings ?? []) as Array<{ project_id: string; sentry_dsn: string | null; sentry_org_slug: string | null }>).find((x) => x.project_id === p.id)
    return {
      id: p.id,
      name: p.name ?? p.id.slice(0, 8),
      kind: (p.kind ?? m?.app?.kind ?? null) as ProjectKindValue | null,
      signals: {
        hasCrashReporting: s ? Boolean(s.sentry_dsn || s.sentry_org_slug) : undefined,
        hasVersionProbe: m ? Array.isArray(m.deploy?.targets) && m.deploy.targets.some((t: any) => t?.probe?.type === 'version_json') : undefined,
      },
    }
  })))

  // Upsert open findings; resolve the open ones this run did not see.
  const { data: open } = await db.from('portfolio_findings').select('id, rule_id, resource_key, project_ids').eq('organization_id', organizationId).eq('status', 'open')
  const keyOf = (f: { rule_id?: string; ruleId?: string; resource_key?: string | null; resourceKey?: string | null; project_ids?: string[]; projectIds?: string[] }) =>
    `${f.rule_id ?? f.ruleId}|${f.resource_key ?? f.resourceKey ?? ''}|${[...(f.project_ids ?? f.projectIds ?? [])].sort().join(',')}`
  const seen = new Set(findings.map(keyOf))
  const existing = new Map(((open ?? []) as Array<{ id: string; rule_id: string; resource_key: string | null; project_ids: string[] }>).map((o) => [keyOf(o), o.id]))
  for (const f of findings) {
    const id = existing.get(keyOf(f))
    const row = { organization_id: organizationId, rule_id: f.ruleId, severity: f.severity, project_ids: [...f.projectIds].sort(), resource_key: f.resourceKey, message: f.message.slice(0, 1000), evidence: f.evidence ?? {}, suggested_fix: { text: f.suggestedFix }, status: 'open', updated_at: now.toISOString() }
    if (id) await db.from('portfolio_findings').update(row).eq('id', id)
    else await db.from('portfolio_findings').insert(row)
  }
  let resolved = 0
  for (const [k, id] of existing) {
    if (seen.has(k)) continue
    await db.from('portfolio_findings').update({ status: 'resolved', resolved_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', id)
    resolved++
  }
  return { findings: findings.length, resolved, unknown: deep.unknown.length }
}
