import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { resolveLlmKey } from '../../_shared/byok.ts';
import { dbError, userCanAccessProject } from '../shared.ts';
import { ingestReport, triggerClassification } from '../helpers.ts';
import { emitFunnelEvent } from '../../_shared/setup-funnel.ts';
import { emitProductEvent } from '../../_shared/product-events.ts';
import { getDemoReportFixture, materializeDemoReport, precomputedClassification } from '../../_shared/demo-report-fixtures.ts';
import { checkIngestQuota } from '../../_shared/quota.ts';
import { log } from '../../_shared/logger.ts';
import { classifyIngestRateLimitError } from './ingest-rate-limit.ts';
// Pure readiness → dry-run shaping lives in its own import-free module so it
// can be unit-tested under CI's permission-less `deno test`.
import { buildDryRunResult, type DispatchReadiness } from './dispatch-dry-run.ts';

/**
 * Console test reports per user per hour. Each one runs the real Stage-1
 * fast-filter LLM call, and the route is one click in the console, so without
 * a cap any signed-in user could turn the button into free LLM spend. Ten is
 * far above what onboarding needs (one, maybe a retry).
 */
export const TEST_REPORTS_PER_USER_PER_HOUR = 10;

/**
 * One query set behind both GET /preflight and POST /fixes/dry-run, so the
 * two routes cannot drift apart on what "ready" means.
 */
export async function loadDispatchReadiness(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<DispatchReadiness> {
  const [settingsRes, reposRes, anthropicKey, embeddingKey] = await Promise.all([
    db
      .from('project_settings')
      .select(
        'github_repo_url, byok_anthropic_key_ref, codebase_index_enabled, autofix_enabled, codebase_repo_url',
      )
      .eq('project_id', projectId)
      .maybeSingle(),
    db.from('project_repos').select('repo_url').eq('project_id', projectId).limit(1),
    resolveLlmKey(db, projectId, 'anthropic'),
    resolveLlmKey(db, projectId, 'openai'),
  ]);

  const settings = settingsRes.data;
  const repos = reposRes.data ?? [];
  const repoUrl =
    settings?.github_repo_url ??
    settings?.codebase_repo_url ??
    (repos.length > 0 ? (repos[0] as { repo_url?: string | null }).repo_url ?? null : null);

  return {
    repoUrl,
    hasGithub: Boolean(settings?.github_repo_url) || repos.length > 0,
    hasAnthropic: Boolean(anthropicKey),
    anthropicSource: anthropicKey?.source ?? null,
    hasCodebase: Boolean(settings?.codebase_index_enabled),
    hasAutofix: Boolean(settings?.autofix_enabled),
    hasEmbedding: Boolean(embeddingKey),
    embeddingSource: embeddingKey?.source ?? null,
  };
}

export function registerProjectIntegrationsRoutes(app: Hono<{ Variables: Variables }>): void {
  // Lenient UUID matcher (mirrors projects-crud.ts; see note there).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ---------------------------------------------------------------------------
  // Dispatch preflight — GET /v1/admin/projects/:id/preflight
  //
  // Returns a consolidated "is this project ready to dispatch an auto-fix?"
  // summary consumed by:
  //   - DispatchFixPreflight popover on every report row (ReportsPage)
  //   - DispatchPreflightBanner at the top of ReportsPage
  //   - The GitHub integration card's Autofix toggle (IntegrationsPage)
  //
  // Checks: github (repo configured) | codebase (index enabled) |
  //         anthropic (BYOK key present) | autofix (feature flag on)
  //
  // Auth: adminOrApiKey({ scope: 'mcp:read' }) — JWT admins and mcp:read API
  // keys. An API key grants preflight reads on every project its owner can
  // access (userCanAccessProject), not only the key's bound project — same
  // owner-wide semantics as other adminOrApiKey routes.
  // ---------------------------------------------------------------------------
  app.get('/v1/admin/projects/:id/preflight', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const [settingsRes, reposRes, anthropicKey] = await Promise.all([
      db
        .from('project_settings')
        .select(
          'github_repo_url, byok_anthropic_key_ref, codebase_index_enabled, autofix_enabled, codebase_repo_url',
        )
        .eq('project_id', projectId)
        .maybeSingle(),
      db.from('project_repos').select('repo_url').eq('project_id', projectId).limit(1),
      resolveLlmKey(db, projectId, 'anthropic'),
    ]);

    const settings = settingsRes.data;
    const repos = reposRes.data ?? [];

    const repoUrl =
      settings?.github_repo_url ??
      settings?.codebase_repo_url ??
      (repos.length > 0 ? (repos[0] as { repo_url?: string | null }).repo_url ?? null : null);

    const hasGithub = Boolean(settings?.github_repo_url) || repos.length > 0;
    const hasAnthropic = Boolean(anthropicKey);
    const anthropicSource = anthropicKey?.source ?? null;
    const hasCodebase = Boolean(settings?.codebase_index_enabled);
    const hasAutofix = Boolean(settings?.autofix_enabled);

    type Check = {
      key: 'github' | 'codebase' | 'anthropic' | 'autofix';
      ready: boolean;
      label: string;
      hint: string;
      fixHref: string;
    };

    const checks: Check[] = [
      {
        key: 'github',
        ready: hasGithub,
        label: 'GitHub repo connected',
        hint: 'Connect a GitHub repository so the fix worker can open pull requests.',
        fixHref: '/integrations/config?tab=github',
      },
      {
        key: 'codebase',
        ready: hasCodebase,
        label: 'Codebase indexed',
        hint: 'Enable codebase indexing so the AI can read your source files.',
        fixHref: '/integrations/config?tab=codebase',
      },
      {
        key: 'anthropic',
        ready: hasAnthropic,
        label: anthropicSource === 'env'
          ? 'Anthropic key available (platform)'
          : anthropicSource === 'byok'
            ? 'Anthropic API key set'
            : 'Anthropic API key set',
        hint: anthropicSource === 'env'
          ? 'Using the platform Anthropic key — add your own in Settings → API Keys to isolate usage.'
          : 'Add your Anthropic API key (BYOK) to power the fix-generation model.',
        fixHref: '/settings?tab=byok',
      },
      {
        key: 'autofix',
        ready: hasAutofix,
        label: 'Autofix enabled',
        hint: 'Turn on Autofix in Project Settings to allow the worker to open PRs.',
        fixHref: '/settings?tab=autofix',
      },
    ];

    const ready = checks.every((c) => c.ready);

    return c.json({ ok: true, data: { ready, checks, repoUrl } });
  });

  // ---------------------------------------------------------------------------
  // Dispatch dry-run — POST /v1/admin/projects/:id/fixes/dry-run
  //
  // Consumed by DryRunPanel ("Validate pipeline") on /integrations. Simulates
  // the auto-fix pipeline WITHOUT calling the LLM or opening a PR: the first
  // three steps are real checks on the same signals as /preflight (plus the
  // embedding key, which preflight does not check and which is what actually
  // sank a live dispatch on 2026-09-23), the last two are always `simulated`.
  // The panel has POSTed here since it shipped; the route never existed, so
  // "Run dry-run" got a plain-text 404 and the advertised way to validate the
  // pipeline before spending a dispatch never worked. Same auth as /preflight:
  // JWT admins and mcp:read API keys, same owner-wide project access check.
  // ---------------------------------------------------------------------------
  app.post(
    '/v1/admin/projects/:id/fixes/dry-run',
    adminOrApiKey({ scope: 'mcp:read' }),
    async (c) => {
      const projectId = c.req.param('id')!;
      const userId = c.get('userId') as string;
      const db = getServiceClient();

      if (!UUID_RE.test(projectId)) {
        return c.json(
          { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
          400,
        );
      }

      const access = await userCanAccessProject(db, userId, projectId);
      if (!access.allowed) {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      const readiness = await loadDispatchReadiness(db, projectId);
      return c.json({ ok: true, data: buildDryRunResult(readiness) });
    },
  );

  // ---------------------------------------------------------------------------
  // Autofix flag — GET /v1/admin/projects/:id/autofix
  //
  // Returns the current autofix_enabled flag for the project. Consumed by
  // CodebaseIndexCard (IntegrationsPage) so the autofix toggle can reflect
  // the live state without requiring a full settings reload.
  // ---------------------------------------------------------------------------
  app.get('/v1/admin/projects/:id/autofix', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const { data, error } = await db
      .from('project_settings')
      .select('autofix_enabled')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) return dbError(c, error);

    return c.json({ ok: true, data: { autofix_enabled: Boolean(data?.autofix_enabled) } });
  });

  // ---------------------------------------------------------------------------
  // Autofix toggle — POST /v1/admin/projects/:id/autofix/toggle
  //
  // Flips the autofix_enabled flag on project_settings. Accepts { enabled: boolean }.
  // Returns the updated flag so the caller can sync its local state.
  // ---------------------------------------------------------------------------
  app.post('/v1/admin/projects/:id/autofix/toggle', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const enabled = Boolean(body.enabled);

    const { error } = await db
      .from('project_settings')
      .upsert(
        { project_id: projectId, autofix_enabled: enabled },
        { onConflict: 'project_id' },
      );

    if (error) return dbError(c, error);

    return c.json({ ok: true, data: { autofix_enabled: enabled } });
  });

  // One-click test report. Exists so the admin console's "Send test report"
  // buttons (onboarding S2, DashboardPage.GettingStartedEmpty,
  // SettingsPage.QuickTestSection) can produce a real diagnosis without
  // copy-pasting an API key — the admin is already JWT-authenticated and owns
  // the project. Goes through ingestReport() so it really exercises schema
  // validation, queue insert, circuit breaker, and classification trigger.
  //
  // The payload is the iPad-Safari login fixture from
  // _shared/demo-report-fixtures.json (breadcrumbs, a 401 on /api/session,
  // a real user agent) so the first diagnosis a new user sees is an aha, not
  // "Admin pipeline test". metadata.source = 'admin_test_report' keeps it out
  // of activation (first_report_received) and the growth funnel; the console
  // inbox filters on the same tag.
  //
  // Metered like SDK ingest (2026-09-21): a per-user hourly claim
  // (scoped_rate_limit_claim, scope 'test_report') and the project's monthly
  // report quota (checkIngestQuota), so the button cannot bypass either.
  app.post('/v1/admin/projects/:id/test-report', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Test reports verify the ingest path — anyone with project access can
    // do this (matches what an end-user reporter could do anyway).
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    const { data: project } = await db
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single();
    if (!project)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);

    // Per-user hourly cap. Same outcome classification as SDK ingest: a
    // breach is a 429, a missing claim function (migration window) fails
    // open, and any other RPC error fails closed.
    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: userId,
      p_scope: 'test_report',
      p_max_per_window: TEST_REPORTS_PER_USER_PER_HOUR,
      p_window: '1 hour',
    });
    const rateOutcome = classifyIngestRateLimitError(rateErr);
    if (rateOutcome === 'breach' || rateOutcome === 'fail-closed') {
      if (rateOutcome === 'fail-closed') {
        log.error('test-report: rate-limit claim failed — failing closed', { err: rateErr?.message });
      }
      c.header('Retry-After', rateOutcome === 'breach' ? '3600' : '30');
      return c.json(
        {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message:
              rateOutcome === 'breach'
                ? `Test report limit reached (${TEST_REPORTS_PER_USER_PER_HOUR} per hour). Try again later.`
                : 'Test reports are temporarily throttled. Retry in 30 seconds.',
          },
        },
        429,
      );
    }

    // A test report is a stored report: it counts against the plan like one.
    const quota = await checkIngestQuota(db, projectId);
    if (!quota.allowed) {
      c.header('Retry-After', String(quota.retryAfterSeconds ?? 3600));
      return c.json(
        {
          ok: false,
          error: {
            code: 'QUOTA_EXCEEDED',
            message: `${quota.plan.display_name} plan quota of ${quota.limit?.toLocaleString() ?? 'n/a'} reports/month exceeded. Upgrade or wait until ${quota.periodResetsAt}.`,
            used: quota.used,
            limit: quota.limit,
            plan: quota.plan,
            reason: quota.reason,
            periodResetsAt: quota.periodResetsAt,
          },
        },
        402,
      );
    }

    const ipAddress =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent') ?? 'mushi-admin';

    // projectId in the body is schema-required; ingestReport actually uses the
    // auth-context projectId. The reporter token is per-admin so repeated test
    // reports from the same person group under one reporter.
    const fixture = getDemoReportFixture();
    const syntheticBody = materializeDemoReport(fixture, {
      projectId,
      reporterToken: `admin-test-${userId}`,
      metadata: { source: 'admin_test_report', userId },
    });

    // The report is synthetic, so its diagnosis is written with the fixture
    // rather than bought from the LLM pipeline: no Stage-1 call on the
    // project's budget, and the first diagnosis appears on the next poll.
    const precomputed = precomputedClassification(fixture);
    const result = await ingestReport(db, projectId, syntheticBody, {
      ipAddress,
      userAgent,
      skipClassification: precomputed !== null,
    });
    if (!result.ok) {
      return c.json({ ok: false, error: { code: 'INGEST_ERROR', message: result.error } }, 400);
    }
    if (precomputed && result.reportId) {
      const { error: classifyErr } = await db.from('reports').update(precomputed).eq('id', result.reportId);
      if (classifyErr) {
        log.warn('test-report: precomputed diagnosis write failed — running the pipeline', {
          reportId: result.reportId,
          err: classifyErr.message,
        });
        triggerClassification(result.reportId, projectId);
      }
    }

    // Activation funnel (setup_funnel_events) + product_events, both
    // background writes and idempotent on their dedup keys. A deduplicated
    // ingest returns the existing reportId, so a double click cannot
    // double-count.
    const reportId = result.reportId ?? 'unknown';
    void emitFunnelEvent(db, {
      userId,
      projectId,
      eventName: 'test_report_sent',
      dedupKey: `${projectId}:${reportId}`,
      source: 'console',
    });
    void emitProductEvent(db, {
      userId,
      eventName: 'test_report_sent',
      surface: 'console',
      properties: { project_id: projectId },
      dedupKey: `test_report_sent:${reportId}`,
    });

    return c.json(
      {
        ok: true,
        data: { reportId: result.reportId, projectName: project.name },
      },
      201,
    );
  });

  // Activation funnel step `diagnosis_viewed`: the console's first-diagnosis
  // screen calls this once the classified test report renders. The
  // setup_funnel_events CHECK (20260921000002) and FunnelEventName allowed the
  // step from the start, but nothing wrote it — the console has no API key
  // for POST /v1/cli/funnel. JWT + project access like the test-report route
  // above; one row per project (dedup_key = project id), so a refresh or a
  // second diagnosis never adds another.
  app.post('/v1/admin/projects/:id/setup-funnel/diagnosis-viewed', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const db = getServiceClient();
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    // Optional `{ reportId }`, kept as metadata when it is a UUID.
    let reportId: string | null = null;
    try {
      const body: unknown = await c.req.json();
      const raw = body && typeof body === 'object' ? (body as { reportId?: unknown }).reportId : undefined;
      if (typeof raw === 'string' && UUID_RE.test(raw)) reportId = raw;
    } catch {
      /* no body */
    }

    void emitFunnelEvent(db, {
      userId,
      projectId,
      eventName: 'diagnosis_viewed',
      dedupKey: projectId,
      source: 'console',
      metadata: reportId ? { report_id: reportId } : {},
    });

    return c.json({ ok: true }, 202);
  });
}
