import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { resolveLlmKey } from '../../_shared/byok.ts';
import { dbError, userCanAccessProject } from '../shared.ts';
import { ingestReport } from '../helpers.ts';

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

  // Admin pipeline diagnostic. Exists so the admin console's "Send test report"
  // buttons (DashboardPage.GettingStartedEmpty, SettingsPage.QuickTestSection)
  // can verify the ingest path without copy-pasting an API key — the admin is
  // already JWT-authenticated and owns the project. Goes through ingestReport()
  // so it really exercises schema validation, queue insert, circuit breaker, and
  // classification trigger. Tagged with metadata.source so admins can filter
  // these out of the inbox.
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

    const ipAddress =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent') ?? 'mushi-admin';
    const now = new Date().toISOString();

    const syntheticBody = {
      projectId, // schema-required; ingestReport actually uses the auth-context projectId
      category: 'other' as const,
      description:
        'Admin pipeline test — verifying ingest, validation, queue, and classification end-to-end.',
      environment: {
        userAgent,
        platform: 'mushi-admin',
        language: 'en',
        viewport: { width: 0, height: 0 },
        url: 'admin://test-report',
        referrer: '',
        timestamp: now,
        timezone: 'UTC',
      },
      reporterToken: `admin-test-${userId}`,
      metadata: { source: 'admin_test_report', userId },
      createdAt: now,
    };

    const result = await ingestReport(db, projectId, syntheticBody, { ipAddress, userAgent });
    if (!result.ok) {
      return c.json({ ok: false, error: { code: 'INGEST_ERROR', message: result.error } }, 400);
    }

    return c.json(
      {
        ok: true,
        data: { reportId: result.reportId, projectName: project.name },
      },
      201,
    );
  });

}
