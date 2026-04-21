// ============================================================
// D7: Multi-repo coordinated fix orchestrator.
//
// One bug → many repos. The flow:
//
//   1. plan(reportId) — pull all `project_repos`, assemble FixContext,
//      ask the planning agent (Claude by default) which subset of repos
//      need a change. Persist the result as `fix_coordinations.plan`.
//
//   2. execute(coordinationId) — for each task in the plan, spawn a
//      single-repo `FixOrchestrator.run()` with a `coordination_id`
//      stamped on the resulting `fix_attempts` row, and a per-repo
//      FixContext narrowed to that repo's path globs.
//
//   3. linkPRs(coordinationId) — once every child finishes, post a
//      cross-link comment on each PR ("Coordinated with kensaurus/foo-fe#42, …").
//
//   4. rollupStatus(coordinationId) — succeeded only if every child
//      fix_attempt is `completed`; otherwise partial_success / failed.
//
// The implementation is intentionally additive: single-repo callers
// keep working unchanged. This class only kicks in when a project has
// >1 row in `project_repos` AND the planning agent decides multiple
// repos need work.
// ============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  CoordinatedFixResult,
  CoordinationPlan,
  CoordinationTask,
  FixContext,
  ProjectRepo,
  RepoRole,
} from './types.js'
import { FixOrchestrator, type OrchestratorConfig } from './orchestrator.js'

/**
 * Lightweight order-preserving concurrent map. Imported here rather than
 * shared because `@mushi-mushi/agents` deliberately has zero runtime deps
 * outside `@supabase/supabase-js`.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i]!, i)
    }
  })
  await Promise.all(runners)
  return results
}

interface MultiRepoConfig extends OrchestratorConfig {
  /**
   * Optional override of the planner. If omitted, a deterministic
   * heuristic plan is built from `relevantCode` + `path_globs`. Real
   * deployments wire this to the same Claude/Codex agent used for
   * single-repo fixes.
   */
  planner?: (input: {
    context: FixContext
    repos: ProjectRepo[]
  }) => Promise<CoordinationPlan>
}

const matchesGlob = (path: string, glob: string): boolean => {
  const re = new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0001/g, '.*') +
      '$',
  )
  return re.test(path)
}

const heuristicPlanner = async (input: {
  context: FixContext
  repos: ProjectRepo[]
}): Promise<CoordinationPlan> => {
  const { context, repos } = input
  const filesByRepo = new Map<string, string[]>()
  for (const repo of repos) filesByRepo.set(repo.id, [])

  for (const file of context.relevantCode) {
    let matched: ProjectRepo | undefined
    for (const repo of repos) {
      if (repo.pathGlobs.length === 0) continue
      if (repo.pathGlobs.some((g) => matchesGlob(file.path, g))) {
        matched = repo
        break
      }
    }
    if (!matched) matched = repos.find((r) => r.isPrimary) ?? repos[0]
    if (matched) filesByRepo.get(matched.id)!.push(file.path)
  }

  const tasks: CoordinationTask[] = []
  for (const repo of repos) {
    const files = filesByRepo.get(repo.id) ?? []
    if (files.length === 0) continue
    tasks.push({
      repoId: repo.id,
      role: repo.role,
      description: `Apply fix to ${files.length} file(s) in ${repo.role} repo: ${repo.repoUrl}`,
      pathHints: files,
    })
  }

  return {
    tasks,
    rationale: 'heuristic-plan: routed by path_globs match against context.relevantCode',
  }
}

export class MultiRepoFixOrchestrator {
  private db: SupabaseClient
  private config: MultiRepoConfig
  private singleRepoOrchestrator: FixOrchestrator

  constructor(config: MultiRepoConfig) {
    this.config = config
    this.db = createClient(config.supabaseUrl, config.supabaseServiceKey)
    this.singleRepoOrchestrator = new FixOrchestrator(config)
  }

  private async fetchRepos(projectId: string): Promise<ProjectRepo[]> {
    const { data } = await this.db
      .from('project_repos')
      .select('id, repo_url, role, default_branch, path_globs, is_primary')
      .eq('project_id', projectId)
      .order('is_primary', { ascending: false })

    return (data ?? []).map((row: {
      id: string; repo_url: string; role: string; default_branch: string;
      path_globs: string[]; is_primary: boolean
    }) => ({
      id: row.id,
      repoUrl: row.repo_url,
      role: row.role as RepoRole,
      defaultBranch: row.default_branch,
      pathGlobs: row.path_globs ?? [],
      isPrimary: row.is_primary,
    }))
  }

  /** Step 1 — produce a coordination plan and persist it. */
  async plan(reportId: string): Promise<{ coordinationId: string; plan: CoordinationPlan }> {
    const context = await this.singleRepoOrchestrator.assembleContext(reportId)
    const repos = await this.fetchRepos(context.projectId)

    if (repos.length <= 1) {
      throw new Error(
        'MultiRepoFixOrchestrator requires >1 row in project_repos. ' +
          'Use FixOrchestrator directly for single-repo projects.',
      )
    }

    const planner = this.config.planner ?? heuristicPlanner
    const plan = await planner({ context, repos })

    const { data: coord, error } = await this.db
      .from('fix_coordinations')
      .insert({
        project_id: context.projectId,
        report_id: reportId,
        status: 'planning',
        plan,
      })
      .select('id')
      .single()
    if (error || !coord) throw new Error(`failed to insert coordination: ${error?.message}`)

    return { coordinationId: coord.id as string, plan }
  }

  /**
   * Step 2 — fan out one single-repo fix per task.
   *
   * Wave S5: the previous implementation called `singleRepoOrchestrator.run(reportId)`
   * once per task but always targeted the *primary* repo (because `run()`
   * reads `project_settings.github_repo_url`). That produced N duplicate
   * PRs on the same repo, which is worse than not fanning out at all.
   *
   * The fix: filter `relevantCode` to the files that match the task's
   * `path_globs` (via the heuristic planner's globbing), override
   * `context.config.repoUrl` with the per-repo URL, and let each task run
   * concurrently (max 4 at a time — GitHub secondary rate limits punish
   * higher bursts hard).
   */
  async execute(coordinationId: string): Promise<CoordinatedFixResult> {
    const { data: coord, error } = await this.db
      .from('fix_coordinations')
      .select('id, project_id, report_id, plan')
      .eq('id', coordinationId)
      .single()
    if (error || !coord) throw new Error(`coordination ${coordinationId} not found`)

    await this.db
      .from('fix_coordinations')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', coordinationId)

    const tasks = ((coord.plan as { tasks?: CoordinationTask[] } | null)?.tasks ?? []) as CoordinationTask[]
    const repos = await this.fetchRepos(coord.project_id as string)
    const repoById = new Map(repos.map((r) => [r.id, r]))

    // Assemble the shared context once so every task sees the same graph /
    // Sentry / report payload. Per-task we narrow `relevantCode` to the
    // repo's path globs so each agent sees only its slice of the codebase.
    const baseContext = await this.singleRepoOrchestrator.assembleContext(coord.report_id as string)

    const runTask = async (task: CoordinationTask): Promise<CoordinatedFixResult['attempts'][number]> => {
      const repo = repoById.get(task.repoId)
      if (!repo) {
        return { fixId: '', repoId: task.repoId, role: task.role, success: false, error: 'repo not found in project_repos' }
      }

      const relevantCode = task.pathHints.length
        ? baseContext.relevantCode.filter((f) => task.pathHints.includes(f.path))
        : baseContext.relevantCode.filter((f) => repo.pathGlobs.some((g) => matchesGlob(f.path, g)))

      const repoContext: FixContext = {
        ...baseContext,
        relevantCode,
        config: { ...baseContext.config, repoUrl: repo.repoUrl },
      }

      try {
        const { fixId, result } = await this.singleRepoOrchestrator.runWithContext(repoContext, {
          coordinationId,
          repoId: repo.id,
          repoRole: repo.role,
        })
        return {
          fixId,
          repoId: task.repoId,
          role: task.role,
          success: result.success,
          prUrl: result.prUrl,
          error: result.error,
        }
      } catch (err) {
        return {
          fixId: '',
          repoId: task.repoId,
          role: task.role,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    const attempts = await mapWithConcurrency(tasks, 4, runTask)

    const successCount = attempts.filter((a) => a.success).length
    let parentStatus: CoordinatedFixResult['status']
    if (successCount === attempts.length && attempts.length > 0) parentStatus = 'succeeded'
    else if (successCount === 0) parentStatus = 'failed'
    else parentStatus = 'partial_success'

    await this.db
      .from('fix_coordinations')
      .update({
        status: parentStatus,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', coordinationId)

    return { coordinationId, status: parentStatus, attempts }
  }

  /** Step 3 — cross-link the open PRs in their bodies. */
  async linkPRs(coordinationId: string, octokit: {
    rest: { issues: { createComment: (args: { owner: string; repo: string; issue_number: number; body: string }) => Promise<unknown> } }
  }): Promise<void> {
    const { data } = await this.db
      .from('fix_attempts')
      .select('id, pr_url, repo_role')
      .eq('coordination_id', coordinationId)
      .not('pr_url', 'is', null)
    const attempts = (data ?? []) as Array<{ pr_url: string; repo_role: string }>
    if (attempts.length < 2) return

    const links = attempts.map((a) => `- [${a.repo_role}] ${a.pr_url}`).join('\n')
    const body =
      `🤝 **Mushi multi-repo coordination**\n\n` +
      `This PR is part of a coordinated fix across multiple repos:\n\n${links}\n\n` +
      `Merge order matters when there are FE↔BE contract changes — review siblings first.`

    for (const a of attempts) {
      const m = a.pr_url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
      if (!m) continue
      const [, owner, repo, number] = m
      try {
        await octokit.rest.issues.createComment({
          owner: owner!,
          repo: repo!,
          issue_number: Number(number),
          body,
        })
      } catch {
        // tolerate — annotation is best-effort
      }
    }
  }
}
