/**
 * FILE: packages/server/supabase/functions/_shared/connectors/github.ts
 * PURPOSE: The GitHub connector (Plan 019 §2b): legacy-backed — it uses the
 *          project's existing vaulted token (resolveProjectGithubToken); no
 *          credential is migrated. Snapshot: workflows at the head SHA,
 *          recent default-branch runs, Actions secret and variable NAMES
 *          (never values), and the login settings declared in
 *          supabase/config.toml (non-secret keys only). Drift: ci_drift,
 *          default_branch_red, env_drift.
 *          It is the only connector that proposes file edits; the PR itself
 *          is opened by the recipe-change worker as a draft.
 *
 * config: { owner, repo, defaultBranchHint? }  readCredential: the token.
 */

import { ciWorkflowDrift, defaultBranchRed, envDrift } from '../recipe-drift.ts'
import { estimateRunMinutes } from '../ci-minutes.ts'
import { presentEnvNames } from '../recipe-detail.ts'
import { isWritablePath, type RecipeManifest } from '../recipe-schema.ts'
import { parseSupabaseAuthConfig, type DeclaredAuthSettings } from '../supabase-config-toml.ts'
import { fetchJson, statusReason } from './http-util.ts'
import { ConnectorError, notConnected, type ConnectorContext, type DriftFinding, type FileEdit, type RecipeConnector } from './types.ts'

const API = 'https://api.github.com'
/** Deployment environments read per snapshot (two list calls each). */
export const MAX_ENVIRONMENTS = 10

function repoOf(ctx: ConnectorContext): { owner: string; repo: string } | null {
  const owner = typeof ctx.config.owner === 'string' ? ctx.config.owner : null
  const repo = typeof ctx.config.repo === 'string' ? ctx.config.repo : null
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null
  return { owner, repo }
}

function gh(ctx: ConnectorContext, path: string) {
  return fetchJson<any>(ctx, `${API}${path}`, {
    headers: { Authorization: `Bearer ${ctx.readCredential}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mushi-mushi-recipe' },
  })
}

function decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export const githubConnector: RecipeConnector = {
  kind: 'github',
  title: 'GitHub',
  capabilities: ['snapshot', 'drift', 'propose'],
  requiredScopes: {
    snapshot: ['contents:read', 'actions:read', 'secrets:read (names only)', 'metadata:read'],
    propose: ['contents:write', 'pull_requests:write'],
  },
  credentialNote: 'Uses the GitHub token already connected to this project. Mushi reads files, runs and secret NAMES, never secret values, and writes only draft pull requests.',
  async probe(ctx) {
    const r = repoOf(ctx)
    if (!r) return notConnected('No GitHub repo is connected to this project.')
    if (!ctx.readCredential) return notConnected('No GitHub token is stored for this project.')
    const res = await gh(ctx, `/repos/${r.owner}/${r.repo}`)
    if (res.status !== 200) return { ok: false, status: 'error', granted: [], missing: [], reason: statusReason('GitHub', res.status) }
    const granted = ['metadata:read', 'contents:read']
    const perms = (res.body?.permissions ?? {}) as Record<string, boolean>
    if (perms.push) granted.push('contents:write', 'pull_requests:write')
    const actions = await gh(ctx, `/repos/${r.owner}/${r.repo}/actions/runs?per_page=1`)
    if (actions.status === 200) granted.push('actions:read')
    const secrets = await gh(ctx, `/repos/${r.owner}/${r.repo}/actions/secrets?per_page=1`)
    if (secrets.status === 200) granted.push('secrets:read (names only)')
    const wanted = [...new Set(Object.values(githubConnector.requiredScopes).flat())]
    return { ok: true, status: 'connected', granted, missing: wanted.filter((w) => !granted.includes(w)) }
  },
  async snapshot(ctx) {
    const r = repoOf(ctx)
    if (!r || !ctx.readCredential) throw new ConnectorError('GitHub is not connected for this project.', 'not_connected')
    const info = await gh(ctx, `/repos/${r.owner}/${r.repo}`)
    if (info.status !== 200) throw new ConnectorError(statusReason('GitHub', info.status))
    const branch = String(info.body?.default_branch ?? ctx.config.defaultBranchHint ?? 'main')
    const head = await gh(ctx, `/repos/${r.owner}/${r.repo}/commits/${encodeURIComponent(branch)}`)
    if (head.status !== 200) throw new ConnectorError(`Could not read the head of ${branch}: ${statusReason('GitHub', head.status)}`)
    const headSha = String(head.body?.sha ?? '')
    const headCommittedAt = (head.body?.commit?.committer?.date as string | undefined) ?? null

    const dir = await gh(ctx, `/repos/${r.owner}/${r.repo}/contents/.github/workflows?ref=${headSha}`)
    const workflowFiles: Record<string, string> = {}
    if (dir.status === 200 && Array.isArray(dir.body)) {
      for (const f of (dir.body as Array<{ type: string; path: string; name: string }>).filter((x) => x.type === 'file' && /\.ya?ml$/.test(x.name)).slice(0, 30)) {
        const file = await gh(ctx, `/repos/${r.owner}/${r.repo}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${headSha}`)
        if (file.status === 200 && typeof file.body?.content === 'string') workflowFiles[f.path] = decode(file.body.content)
      }
    } else if (dir.status !== 404) {
      throw new ConnectorError(`Could not list the workflows: ${statusReason('GitHub', dir.status)}`)
    }

    const runsRes = await gh(ctx, `/repos/${r.owner}/${r.repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`)
    const runs = runsRes.status === 200 ? ((runsRes.body?.workflow_runs ?? []) as Array<Record<string, any>>).map((x) => ({
      run_id: x.id, workflow_path: x.path ?? null, name: x.name ?? null, event: x.event ?? null, head_branch: x.head_branch ?? null,
      head_sha: x.head_sha ?? null, status: x.status ?? null, conclusion: x.conclusion ?? null,
      started_at: x.run_started_at ?? x.created_at ?? null, completed_at: x.updated_at ?? null, html_url: x.html_url ?? null,
    })) : []

    // Estimated minutes for up to 10 completed runs (GitHub closed the usage APIs).
    for (const run of runs.filter((x) => x.status === 'completed').slice(0, 10)) {
      const jobs = await gh(ctx, `/repos/${r.owner}/${r.repo}/actions/runs/${run.run_id}/jobs?per_page=100`)
      if (jobs.status !== 200) continue
      const est = estimateRunMinutes(((jobs.body?.jobs ?? []) as Array<Record<string, any>>).map((j) => ({ started_at: j.started_at ?? null, completed_at: j.completed_at ?? null, labels: j.labels ?? [], runner_name: j.runner_name ?? null })))
      Object.assign(run, { est_billable_minutes: est.minutes, runner_breakdown: est.breakdown })
    }

    // A list GitHub refused (no secrets scope, 403) is "not checked", never "empty":
    // actionsNamesComplete says whether both lists were read.
    const listNames = async (base: string): Promise<string[] | null> => {
      const out: string[] = []
      for (const kind of ['secrets', 'variables'] as const) {
        const res = await gh(ctx, `${base}/${kind}?per_page=100`)
        if (res.status !== 200) return null
        for (const s of (res.body?.[kind] ?? []) as Array<{ name?: unknown }>) if (typeof s.name === 'string') out.push(s.name)
      }
      return out
    }
    const repoNames = await listNames(`/repos/${r.owner}/${r.repo}/actions`)
    const names = repoNames ?? []
    const actionsNamesComplete = repoNames !== null

    // Deployment environments (at most MAX_ENVIRONMENTS): names per environment
    // that could be read. An environment whose lists were refused is left out.
    const environmentNames: Record<string, string[]> = {}
    const envs = await gh(ctx, `/repos/${r.owner}/${r.repo}/environments?per_page=${MAX_ENVIRONMENTS}`)
    if (envs.status === 200) {
      const list = ((envs.body?.environments ?? []) as Array<{ name?: unknown }>)
        .map((e) => e.name)
        .filter((n): n is string => typeof n === 'string' && /^[\w.-]{1,60}$/.test(n))
        .slice(0, MAX_ENVIRONMENTS)
      for (const env of list) {
        const got = await listNames(`/repos/${r.owner}/${r.repo}/environments/${encodeURIComponent(env)}`)
        if (got) environmentNames[env] = got
      }
    }

    // Declared migrations: filenames under the manifest's data.migrationsDir at the head SHA.
    let migrationFiles: string[] | null = null
    const migDir = typeof ctx.config.migrationsDir === 'string' ? ctx.config.migrationsDir.replace(/^\/+|\/+$/g, '') : null
    if (migDir && /^[\w./-]{1,200}$/.test(migDir) && !migDir.includes('..')) {
      const list = await gh(ctx, `/repos/${r.owner}/${r.repo}/contents/${migDir.split('/').map(encodeURIComponent).join('/')}?ref=${headSha}`)
      if (list.status === 200 && Array.isArray(list.body)) {
        migrationFiles = (list.body as Array<{ type: string; name: string }>).filter((x) => x.type === 'file' && /\.sql$/i.test(x.name)).map((x) => x.name).sort()
      } else if (list.status === 404) {
        migrationFiles = []
      }
    }

    // Declared login settings (supabase/config.toml next to the migrations), for the shared-auth rule.
    // Only non-secret keys are kept; `null` = no file or no [auth] table; `undefined` = could not read.
    const tomlPath = migDir && /(^|\/)migrations$/.test(migDir) ? migDir.replace(/migrations$/, 'config.toml') : 'supabase/config.toml'
    let supabaseAuth: { path: string; settings: DeclaredAuthSettings | null } | undefined
    const toml = await gh(ctx, `/repos/${r.owner}/${r.repo}/contents/${tomlPath.split('/').map(encodeURIComponent).join('/')}?ref=${headSha}`)
    if (toml.status === 200 && typeof toml.body?.content === 'string') supabaseAuth = { path: `${r.owner}/${r.repo}/${tomlPath}`, settings: parseSupabaseAuthConfig(decode(toml.body.content)) }
    else if (toml.status === 404) supabaseAuth = { path: `${r.owner}/${r.repo}/${tomlPath}`, settings: null }

    const latest = runs.find((x) => x.status === 'completed') ?? null
    return {
      observedAt: ctx.now().toISOString(),
      elements: {
        ci: { summary: { workflows: Object.keys(workflowFiles).length, branch, latestConclusion: latest?.conclusion ?? null } },
        env: { summary: { actionsNames: names.length } },
      },
      resources: [{ kind: 'repo', externalId: `${r.owner}/${r.repo}`, role: 'source' }],
      facts: { branch, headSha, headCommittedAt, workflowFiles, runs, actionsNames: names, actionsNamesComplete, environmentNames, migrationsDir: migDir, migrationFiles, supabaseAuth },
      cursor: runs[0]?.run_id ? String(runs[0].run_id) : undefined,
    }
  },
  detectDrift(_prev, next, manifest) {
    const f = next.facts as { branch: string; workflowFiles: Record<string, string>; runs: Array<{ head_branch: string | null; conclusion: string | null; completed_at: string | null }>; actionsNames: string[]; actionsNamesComplete?: boolean; environmentNames?: Record<string, string[]> }
    type DeclaredEnv = { name: string; in?: unknown; environments?: unknown }
    const m = (manifest && typeof manifest === 'object' ? manifest : {}) as { env?: { required?: unknown } }
    const required = m.env?.required
    const declared: DeclaredEnv[] = Array.isArray(required) ? required.filter((e): e is DeclaredEnv => !!e && typeof (e as DeclaredEnv).name === 'string') : []
    const out: DriftFinding[] = [
      ...ciWorkflowDrift(f.workflowFiles ?? {}),
      ...defaultBranchRed(f.runs ?? [], f.branch),
      ...(declared.length ? envDrift({ declared: declared.map((e) => ({ name: e.name, in: Array.isArray(e.in) ? e.in : ['github-actions'], environments: Array.isArray(e.environments) ? e.environments : [] })), present: presentEnvNames(f), exampleNames: null }) : []),
    ]
    return out.map((d) => ({ gate: d.gate, ruleId: d.ruleId, severity: d.severity, message: d.message, filePath: d.filePath ?? null, suggestedFix: d.suggestedFix }))
  },
  async proposeChange(_ctx, change): Promise<FileEdit[]> {
    // The GitHub connector carries the edits other connectors propose. A
    // denied path (workflows, env files, lockfiles, generated exports, paths
    // outside change.allowPaths) is never returned; the recipe-change worker
    // checks again against the live tree before the draft PR.
    const manifest = (change.intent.manifest ?? null) as RecipeManifest | null
    const edits = Array.isArray(change.intent.edits) ? change.intent.edits : []
    return edits.flatMap((e: unknown) => {
      const x = e as { path?: unknown; content?: unknown }
      if (typeof x.path !== 'string' || typeof x.content !== 'string') return []
      const check = isWritablePath(x.path, manifest)
      return check.ok ? [{ path: check.path, content: x.content }] : []
    })
  },
}
