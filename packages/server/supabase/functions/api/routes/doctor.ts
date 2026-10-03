/**
 * FILE: api/routes/doctor.ts
 * PURPOSE: Server-side self-diagnostics — GET /v1/admin/doctor.
 *
 * Reconciles the silent-failure modes nothing else surfaces in one typed
 * report (headroom `doctor` pattern): every check returns
 * `{ name, status: 'pass'|'warn'|'fail', summary, hint }` where each
 * non-pass carries an actionable hint. Consumed by `mushi doctor` and the
 * console health page.
 *
 * Checks:
 *   - recovery_token:   mushi_runtime_config.internal_caller_token present
 *   - recovery_cron:    last pipeline-recovery run status + freshness
 *   - stranded_reports: reports stuck in new/queued past the SLA
 *   - dead_letter:      processing_queue rows in dead_letter
 *   - codebase_index:   per accessible project — enabled but 0 files, or
 *                       last_index_error set (incl. `partial:` markers)
 *   - observability:    Langfuse / Sentry transports configured
 */
import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import { ownedProjectIds } from '../shared.ts';
import { describeIndexCoverage, latestIso } from '../../_shared/index-coverage.ts';

/** The project_repos columns the codebase-index check reads. */
interface DoctorRepoRow {
  project_id: string;
  last_indexed_at: string | null;
  last_index_error: string | null;
  index_swept_at?: string | null;
  index_files_indexed?: number | null;
  index_files_eligible?: number | null;
  index_file_cap?: number | null;
  index_tree_truncated?: boolean | null;
  index_coverage_state?: string | null;
}

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  summary: string;
  hint?: string;
}

export function registerDoctorRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/doctor', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const checks: DoctorCheck[] = [];

    const projectIds = await ownedProjectIds(db, userId);

    const [tokenRes, cronRes, strandedRes, deadRes, settingsRes, reposRes] = await Promise.all([
      db.from('mushi_runtime_config').select('key').eq('key', 'internal_caller_token').maybeSingle(),
      db
        .from('cron_runs')
        .select('status, finished_at, metadata')
        .eq('job_name', 'pipeline-recovery')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      projectIds.length
        ? db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .in('status', ['new', 'queued'])
            .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
        : Promise.resolve({ count: 0, error: null }),
      projectIds.length
        ? db
            .from('processing_queue')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .eq('status', 'dead_letter')
        : Promise.resolve({ count: 0, error: null }),
      projectIds.length
        ? db
            .from('project_settings')
            .select('project_id, codebase_index_enabled')
            .in('project_id', projectIds)
            .eq('codebase_index_enabled', true)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? db
            .from('project_repos')
            .select('project_id, last_indexed_at, last_index_error, index_swept_at, index_files_indexed, index_files_eligible, index_file_cap, index_tree_truncated, index_coverage_state')
            .in('project_id', projectIds)
            .eq('is_primary', true)
        : Promise.resolve({ data: [], error: null }),
    ]);

    // ── Recovery token ────────────────────────────────────────────────
    if (tokenRes.error) {
      checks.push({
        name: 'recovery_token',
        status: 'warn',
        summary: `Could not read mushi_runtime_config: ${tokenRes.error.message}`,
      });
    } else if (!tokenRes.data) {
      checks.push({
        name: 'recovery_token',
        status: 'fail',
        summary: 'internal_caller_token is not configured — pipeline recovery is skipping every run.',
        hint: 'Set mushi_runtime_config.internal_caller_token and the MUSHI_INTERNAL_CALLER_SECRET function secret (SELF_HOSTED.md → pg_cron section).',
      });
    } else {
      checks.push({ name: 'recovery_token', status: 'pass', summary: 'internal_caller_token configured.' });
    }

    // ── Recovery cron freshness + reconciled outcome ───────────────────
    const run = cronRes.data as
      | { status: string; finished_at: string; metadata?: Record<string, unknown> }
      | null;
    if (!run) {
      checks.push({
        name: 'recovery_cron',
        status: 'fail',
        summary: 'pipeline-recovery has never run.',
        hint: "Register the pg_cron schedule (SELF_HOSTED.md → 'Recommended pg_cron schedules').",
      });
    } else {
      const ageMin = (Date.now() - new Date(run.finished_at).getTime()) / 60_000;
      if (ageMin > 15) {
        checks.push({
          name: 'recovery_cron',
          status: 'fail',
          summary: `pipeline-recovery last ran ${Math.round(ageMin)} minutes ago (expected every 5).`,
          hint: 'Check cron.job_run_details for errors, and that pg_cron + pg_net are enabled.',
        });
      } else if (run.status === 'skipped') {
        checks.push({
          name: 'recovery_cron',
          status: 'fail',
          summary: 'pipeline-recovery is running but skipping: no internal caller token.',
          hint: 'Set mushi_runtime_config.internal_caller_token (see recovery_token check).',
        });
      } else if (run.status === 'degraded' || (run.metadata?.responses_failed as number | undefined ?? 0) > 0) {
        checks.push({
          name: 'recovery_cron',
          status: 'warn',
          summary: 'Recent recovery posts to fast-filter returned non-2xx.',
          hint: 'Inspect cron_runs.metadata (responses_failed) and edge-function logs for fast-filter.',
        });
      } else {
        checks.push({ name: 'recovery_cron', status: 'pass', summary: `pipeline-recovery healthy (last run ${Math.round(ageMin)}m ago).` });
      }
    }

    // ── Stranded reports ───────────────────────────────────────────────
    const strandedCount = (strandedRes as { count: number | null }).count ?? 0;
    checks.push(
      strandedCount > 0
        ? {
            name: 'stranded_reports',
            status: 'warn',
            summary: `${strandedCount} report(s) stuck in new/queued for >10 minutes.`,
            hint: 'They retry automatically (3 attempts); persistent stranding means fast-filter is failing — check its logs and reports.processing_error.',
          }
        : { name: 'stranded_reports', status: 'pass', summary: 'No stranded reports.' },
    );

    // ── Dead-lettered work ─────────────────────────────────────────────
    const deadCount = (deadRes as { count: number | null }).count ?? 0;
    checks.push(
      deadCount > 0
        ? {
            name: 'dead_letter',
            status: 'warn',
            summary: `${deadCount} queue item(s) dead-lettered after exhausting retries.`,
            hint: 'Review them in the console DLQ page and requeue after fixing the cause.',
          }
        : { name: 'dead_letter', status: 'pass', summary: 'Dead-letter queue is empty.' },
    );

    // ── Codebase index health (the "repo added but unused" detector) ───
    const enabledProjects = new Set(
      ((settingsRes.data ?? []) as Array<{ project_id: string }>).map((s) => s.project_id),
    );
    const repoByProject = new Map(
      ((reposRes.data ?? []) as DoctorRepoRow[]).map((r) => [r.project_id, r]),
    );
    for (const pid of enabledProjects) {
      const repo = repoByProject.get(pid);
      // A partial sweep (plan cap, or still filling) sets index_swept_at only.
      const sweptAt = repo ? latestIso(repo.last_indexed_at, repo.index_swept_at) : null;
      const coverage = repo
        ? describeIndexCoverage({
          indexed: repo.index_files_indexed ?? null,
          eligible: repo.index_files_eligible ?? null,
          cap: repo.index_file_cap ?? null,
          truncated: repo.index_tree_truncated === true,
          state: repo.index_coverage_state ?? null,
        })
        : null;
      if (!repo || !sweptAt) {
        checks.push({
          name: `codebase_index:${pid}`,
          status: 'fail',
          summary: 'Codebase indexing is enabled but no sweep has completed — diagnoses run without code context.',
          hint: 'Re-run the sweep from the console Integrations card, and verify the GitHub App installation.',
        });
      } else if (repo.last_index_error) {
        checks.push({
          name: `codebase_index:${pid}`,
          status: 'warn',
          summary: `Index issue: ${repo.last_index_error.slice(0, 200)}`,
          hint: repo.last_index_error.startsWith('partial:')
            ? 'Some chunks failed to embed; the next sweep retries them.'
            : 'Fix the recorded error, then re-run the sweep from the Integrations card.',
        });
      } else if (
        repo.index_coverage_state === 'filling' ||
        repo.index_coverage_state === 'capped' ||
        repo.index_coverage_state === 'stalled'
      ) {
        checks.push({
          name: `codebase_index:${pid}`,
          status: 'warn',
          summary: `Partly indexed: ${coverage ?? 'coverage unknown'} (last sweep ${sweptAt}).`,
          hint: repo.index_coverage_state === 'capped'
            ? 'Diagnoses only see the indexed files. A higher plan indexes more files; a path filter on the Integrations card narrows the sweep to the files that matter.'
            : repo.index_coverage_state === 'stalled'
            ? 'The last sweep added no file. Re-run the sweep from the Integrations card; it is retried daily.'
            : 'The hourly sweep keeps adding files until the repo or the plan limit is covered.',
        });
      } else {
        checks.push({
          name: `codebase_index:${pid}`,
          status: 'pass',
          summary: coverage ? `Indexed: ${coverage} (last sweep ${sweptAt}).` : `Indexed (last sweep ${sweptAt}).`,
        });
      }
    }

    // ── Observability transports ───────────────────────────────────────
    const langfuseConfigured = Boolean(Deno.env.get('LANGFUSE_SECRET_KEY') && Deno.env.get('LANGFUSE_PUBLIC_KEY'));
    const sentryConfigured = Boolean(Deno.env.get('SENTRY_DSN'));
    checks.push({
      name: 'observability',
      status: langfuseConfigured && sentryConfigured ? 'pass' : 'warn',
      summary: `Langfuse: ${langfuseConfigured ? 'configured' : 'not configured'}; Sentry: ${sentryConfigured ? 'configured' : 'not configured'}.`,
      ...(langfuseConfigured && sentryConfigured
        ? {}
        : { hint: 'Set LANGFUSE_SECRET_KEY/LANGFUSE_PUBLIC_KEY and SENTRY_DSN function secrets for full pipeline observability.' }),
    });

    const worst = checks.some((ch) => ch.status === 'fail')
      ? 'fail'
      : checks.some((ch) => ch.status === 'warn')
        ? 'warn'
        : 'pass';

    return c.json({ ok: true, data: { status: worst, checks } });
  });
}
