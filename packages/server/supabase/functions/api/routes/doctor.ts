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
 *   - observability:    Langfuse / Sentry transports configured (info when off:
 *                       both are optional)
 *   - instance checks (self-hosted callers, or a super-admin on Cloud;
 *     _shared/doctor-checks.ts): llm_key, runtime_url (cron jobs still
 *     calling Mushi Mushi Cloud), screenshots_bucket, console_url
 *   - platform_*:       super-admins only: server secrets an app owner cannot
 *                       set (Slack and Linear OAuth, Slack signing), present
 *                       or missing, never their values
 *                       (_shared/platform-setup-checks.ts, console ops plan P1)
 */
import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import { ownedProjectIds } from '../shared.ts';
import { codebaseIndexDoctorCheck, type IndexDoctorRepo } from '../../_shared/index-coverage.ts';
import { getUserRole, SUPER_ADMIN_ROLE } from '../../_shared/super-admin.ts';
import { platformGaps } from '../../_shared/platform-setup-checks.ts';
import { CLOUD_PROJECT_REF, instanceMode } from '../../_shared/instance-mode.ts';
import {
  consoleUrlCheck,
  type DoctorCheck,
  doctorLabel,
  doctorWorst,
  llmKeyCheck,
  observabilityCheck,
  REAPPLY_SETUP,
  runtimeUrlCheck,
  screenshotsBucketCheck,
  SELF_HOST_DOCS,
  sentryDsnSet,
} from '../../_shared/doctor-checks.ts';

export type { DoctorCheck, DoctorStatus } from '../../_shared/doctor-checks.ts';

/** The project_repos columns the codebase-index check reads. */
interface DoctorRepoRow extends IndexDoctorRepo {
  project_id: string;
}

type Db = ReturnType<typeof getServiceClient>;

const LLM_PROVIDERS = ['anthropic', 'openai', 'openrouter'];

export interface DoctorOptions {
  /** Narrow the per-project checks to these apps (the caller checked access); default: the caller's own apps. */
  projectIds?: string[];
  /** Include the super-admin platform secret checks (default true). */
  platform?: boolean;
  /**
   * Include the instance checks (AI key, cron URL, screenshots bucket,
   * console address). Default: on a self-hosted server, or for a super-admin.
   */
  instance?: boolean;
}

/**
 * The doctor's checks, worst status first in `status`. Shared by
 * GET /v1/admin/doctor and the Health check registry
 * (GET /v1/admin/health-checks, which narrows it to one app).
 */
export async function runDoctorChecks(
  db: Db,
  userId: string,
  opts: DoctorOptions = {},
): Promise<{ status: 'pass' | 'warn' | 'fail'; checks: DoctorCheck[] }> {
  const checks: DoctorCheck[] = [];

  const projectIds = opts.projectIds ?? await ownedProjectIds(db, userId);

  const [tokenRes, cronRes, strandedRes, deadRes, settingsRes, reposRes, projectsRes] = await Promise.all([
    // A row the migrations seeded empty is not a token.
    db.from('mushi_runtime_config').select('key').eq('key', 'internal_caller_token').neq('value', '').maybeSingle(),
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
    projectIds.length
      ? db.from('projects').select('id, name, organization_id').in('id', projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const projects = (projectsRes.data ?? []) as Array<{ id: string; name: string | null; organization_id: string | null }>;
  const appName = new Map(projects.map((p) => [p.id, p.name ?? null]));

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
      hint: `${REAPPLY_SETUP} Each sets MUSHI_INTERNAL_CALLER_SECRET and writes the same value into mushi_runtime_config (${SELF_HOST_DOCS}/supabase).`,
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
      hint: `The migrations schedule it every 5 minutes. Check that pg_cron and pg_net are enabled and that mushi_runtime_config points at this server (${SELF_HOST_DOCS}/supabase).`,
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
    checks.push(codebaseIndexDoctorCheck(pid, repoByProject.get(pid), appName.get(pid) ?? null));
  }

  // ── Observability transports ───────────────────────────────────────
  const env = (name: string) => Deno.env.get(name);
  checks.push(observabilityCheck({
    langfuse: Boolean(env('LANGFUSE_SECRET_KEY') && env('LANGFUSE_PUBLIC_KEY')),
    sentry: sentryDsnSet(env),
  }));

  const superAdmin = opts.platform !== false && (await getUserRole(userId)) === SUPER_ADMIN_ROLE;

  // ── Instance setup (what a self-host gets wrong) ─────────────────────
  const mode = instanceMode();
  if (opts.instance ?? (mode === 'self-hosted' || superAdmin)) {
    checks.push(...(await instanceChecks(db, userId, projectIds, projects, mode)));
  }

  // ── Platform secrets (super-admins only; app owners never see these) ──
  if (superAdmin) {
    for (const g of platformGaps((name) => !!Deno.env.get(name))) {
      checks.push({
        name: g.id,
        status: g.status === 'gap' ? 'fail' : 'pass',
        summary: g.summary,
        ...(g.status === 'gap' ? { hint: `Set ${g.missing.join(' and ')} as function secrets (${g.fixHref}).` } : {}),
      });
    }
  }

  for (const ch of checks) ch.label ??= doctorLabel(ch.name);
  return { status: doctorWorst(checks), checks };
}

/** AI key, cron URL, screenshots bucket and console address; each read degrades to its own line. */
async function instanceChecks(
  db: Db,
  userId: string,
  projectIds: string[],
  projects: Array<{ id: string; organization_id: string | null }>,
  mode: 'hosted' | 'self-hosted',
): Promise<DoctorCheck[]> {
  const envAnthropic = Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
  const envOpenai = Boolean(Deno.env.get('OPENAI_API_KEY'));
  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter((id): id is string => !!id))];

  const [appKeys, runtime, bucket] = await Promise.all([
    envAnthropic || envOpenai ? Promise.resolve(0) : countAppLlmKeys(db, userId, projectIds, orgIds),
    readRuntimeUrl(db),
    readScreenshotsBucket(db),
  ]);

  return [
    llmKeyCheck({ envAnthropic, envOpenai, appKeys }),
    runtimeUrlCheck({ mode, cloudRef: CLOUD_PROJECT_REF, ...runtime }),
    screenshotsBucketCheck(bucket),
    consoleUrlCheck({ adminBaseUrl: Deno.env.get('ADMIN_BASE_URL') }),
  ];
}

async function readRuntimeUrl(db: Db): Promise<{ supabaseUrl: string | null; readError: string | null }> {
  try {
    const { data, error } = await db.from('mushi_runtime_config').select('value').eq('key', 'supabase_url').maybeSingle();
    if (error) return { supabaseUrl: null, readError: error.message };
    return { supabaseUrl: (data as { value?: string | null } | null)?.value ?? null, readError: null };
  } catch (err) {
    return { supabaseUrl: null, readError: err instanceof Error ? err.message : String(err) };
  }
}

/** AI keys on the caller's apps, their teams, or their own universal keys; null when unreadable. */
async function countAppLlmKeys(db: Db, userId: string, projectIds: string[], orgIds: string[]): Promise<number | null> {
  const count = async (column: string, ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const { count: n, error } = await db
      .from('byok_keys')
      .select('id', { count: 'exact', head: true })
      .in('provider_slug', LLM_PROVIDERS)
      .in(column, ids);
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  try {
    const [own, team, universal] = await Promise.all([
      count('project_id', projectIds),
      count('organization_id', orgIds),
      // Before the owner_user_id column exists, universal keys count as none.
      count('owner_user_id', [userId]).catch(() => 0),
    ]);
    return own + team + universal;
  } catch {
    return null;
  }
}

async function readScreenshotsBucket(db: Db): Promise<{ bucket: { public: boolean } | null; readError?: string | null }> {
  try {
    const { data, error } = await db.storage.getBucket('screenshots');
    if (error) {
      return /not.?found/i.test(error.message) ? { bucket: null } : { bucket: null, readError: error.message };
    }
    return { bucket: { public: Boolean((data as { public?: boolean } | null)?.public) } };
  } catch (err) {
    return { bucket: null, readError: err instanceof Error ? err.message : String(err) };
  }
}

export function registerDoctorRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/doctor', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    return c.json({ ok: true, data: await runDoctorChecks(db, userId) });
  });
}
