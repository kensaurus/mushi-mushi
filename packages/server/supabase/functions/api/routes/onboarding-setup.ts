import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { callerProjectIds, enumerateAccessibleProjectIds, resolveOwnedProject } from '../shared.ts';
import { resolveNextStepTo } from '../../_shared/activation-status.ts';

export function registerOnboardingSetupRoutes(app: Hono<{ Variables: Variables }>): void {
  // =================================================================================
  // GET /v1/admin/onboarding/stats
  // Focused setup posture for the active (or first accessible) project.
  // =================================================================================
  app.get('/v1/admin/onboarding/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null;
      } catch {
        return null;
      }
    })();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      requiredComplete: 0,
      requiredTotal: 4,
      stepsComplete: 0,
      stepsTotal: 8,
      optionalComplete: 0,
      optionalTotal: 4,
      setupDone: false,
      nextStepId: 'project_created' as string | null,
      nextStepLabel: 'Create your first project' as string | null,
      sdkInstalled: false,
      sdkHostMismatch: false,
      adminEndpointHost: adminHost,
      sdkEndpointHost: null as string | null,
      hasApiKey: false,
      reportCount: 0,
      fixCount: 0,
      mergedFixCount: 0,
    };

    const accessibleIds = await callerProjectIds(c, db, userId);
    if (accessibleIds.length === 0) {
      return c.json({ ok: true, data: empty });
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { ...empty, hasAnyProject: true } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const pid = project.id;

    const [keysRes, settingsRes, reportsRes, fixesRes, reposRes, qaRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select(
          'project_id, is_active, last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host',
        )
        .eq('project_id', pid)
        .eq('is_active', true),
      db
        .from('project_settings')
        .select('project_id, github_repo_url, sentry_org_slug, byok_anthropic_key_ref')
        .eq('project_id', pid)
        .maybeSingle(),
      db
        .from('reports')
        .select('id, environment, created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(100),
      db.from('fix_attempts').select('id, merged_at').eq('project_id', pid).limit(200),
      db.from('project_repos').select('project_id').eq('project_id', pid).limit(1),
      db
        .from('qa_stories')
        .select('id, last_run_status')
        .eq('project_id', pid)
        .eq('last_run_status', 'passed')
        .limit(1),
    ]);

    const hasKey = (keysRes.data ?? []).length > 0;
    let heartbeat: {
      last_seen_at: string;
      last_seen_endpoint_host: string | null;
    } | null = null;
    for (const k of keysRes.data ?? []) {
      const seenAt = (k as { last_seen_at?: string | null }).last_seen_at ?? null;
      if (!seenAt) continue;
      if (heartbeat && heartbeat.last_seen_at >= seenAt) continue;
      heartbeat = {
        last_seen_at: seenAt,
        last_seen_endpoint_host:
          (k as { last_seen_endpoint_host?: string | null }).last_seen_endpoint_host ?? null,
      };
    }

    let sdkReportSignal = false;
    const reports = reportsRes.data ?? [];
    for (const r of reports) {
      const env = (r.environment ?? {}) as Record<string, unknown>;
      const platform = typeof env.platform === 'string' ? env.platform : '';
      if (platform && platform !== 'mushi-admin') sdkReportSignal = true;
    }

    const hasSdk = Boolean(heartbeat) || sdkReportSignal;
    const sdkEndpointHost = heartbeat?.last_seen_endpoint_host ?? null;
    const sdkHostMismatch = Boolean(
      adminHost && sdkEndpointHost && sdkEndpointHost !== adminHost && hasSdk,
    );

    const settings = settingsRes.data;
    const hasGithub = Boolean(settings?.github_repo_url) || (reposRes.data ?? []).length > 0;
    const hasSentry = Boolean(settings?.sentry_org_slug);
    const hasByok = Boolean(settings?.byok_anthropic_key_ref);
    const hasQaPassing = (qaRes.data ?? []).length > 0;
    const reportCount = reports.length;
    const fixes = fixesRes.data ?? [];
    const fixCount = fixes.length;
    const mergedFixCount = fixes.filter((f) => f.merged_at).length;

    type StepDef = { id: string; label: string; complete: boolean; required: boolean };
    const steps: StepDef[] = [
      { id: 'project_created', label: 'Create your first project', complete: true, required: true },
      { id: 'api_key_generated', label: 'Generate an API key', complete: hasKey, required: true },
      { id: 'sdk_installed', label: 'Install the SDK in your app', complete: hasSdk, required: true },
      {
        id: 'first_report_received',
        label: 'Receive your first bug report',
        complete: reportCount > 0,
        required: true,
      },
      { id: 'github_connected', label: 'Connect GitHub', complete: hasGithub, required: false },
      { id: 'sentry_connected', label: 'Connect Sentry (optional)', complete: hasSentry, required: false },
      { id: 'byok_anthropic', label: 'Add your Anthropic key (optional)', complete: hasByok, required: false },
      {
        id: 'first_fix_dispatched',
        label: 'Dispatch your first auto-fix',
        complete: fixCount > 0,
        required: false,
      },
      {
        id: 'first_qa_story_passing',
        label: 'Set up a QA story (optional)',
        complete: hasQaPassing,
        required: false,
      },
    ];

    const requiredSteps = steps.filter((s) => s.required);
    const optionalSteps = steps.filter((s) => !s.required);
    const requiredComplete = requiredSteps.filter((s) => s.complete).length;
    const setupDone = requiredComplete === requiredSteps.length;
    const nextRequired = requiredSteps.find((s) => !s.complete) ?? null;

    // Funnel dropoff stats for the operator panel (last 7 days, all users).
    // Fire-and-forget alongside main data; returns null on any DB error.
    const funnelCounts = await (async () => {
      try {
        const { data } = await db.rpc('get_setup_funnel_counts_7d')
        return data as Record<string, number> | null
      } catch {
        return null
      }
    })()

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: project.name,
        requiredComplete,
        requiredTotal: requiredSteps.length,
        stepsComplete: steps.filter((s) => s.complete).length,
        stepsTotal: steps.length,
        optionalComplete: optionalSteps.filter((s) => s.complete).length,
        optionalTotal: optionalSteps.length,
        setupDone,
        nextStepId: nextRequired?.id ?? null,
        nextStepLabel: nextRequired?.label ?? null,
        nextStepTo: resolveNextStepTo(nextRequired?.id),
        sdkInstalled: hasSdk,
        sdkHostMismatch,
        adminEndpointHost: adminHost,
        sdkEndpointHost,
        hasApiKey: hasKey,
        reportCount,
        fixCount,
        mergedFixCount,
        funnelCounts,
      },
    });
  });

  // =================================================================================
  // GET /v1/admin/onboarding/time-to-first-diagnosis
  // ---------------------------------------------------------------------------------
  // The phase-1 north-star: how long from minting an ingest key to the first
  // *classified* report (a plain-English diagnosis the user can act on).
  //
  // There is no dedicated `reports.classified_at` column, and `updated_at` is
  // polluted by later batch updates (judge runs, replies, migrations), so it is
  // NOT a reliable classification timestamp. Classification runs within seconds
  // of ingest, so we use the `created_at` of the earliest report that actually
  // produced a Stage-1 diagnosis (`stage1_classification IS NOT NULL`) as the
  // honest, stable proxy for "first diagnosis available". Derived server-side so
  // the Onboarding Verify tab can show one number.
  // =================================================================================
  app.get('/v1/admin/onboarding/time-to-first-diagnosis', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: true, data: { keyMintedAt: null, firstDiagnosisAt: null, ms: null } }),
    });
    if ('response' in resolved) return resolved.response;
    const pid = resolved.project.id;

    const [firstKeyRes, firstDiagnosisRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select('created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from('reports')
        .select('created_at')
        .eq('project_id', pid)
        .not('stage1_classification', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const keyMintedAt = (firstKeyRes.data?.created_at as string | null) ?? null;
    const firstDiagnosisAt = (firstDiagnosisRes.data?.created_at as string | null) ?? null;

    let ms: number | null = null;
    if (keyMintedAt && firstDiagnosisAt) {
      const delta = new Date(firstDiagnosisAt).getTime() - new Date(keyMintedAt).getTime();
      // Guard against clock skew producing a negative interval.
      ms = delta >= 0 ? delta : null;
    }

    return c.json({ ok: true, data: { keyMintedAt, firstDiagnosisAt, ms } });
  });

  // =================================================================================
  // GET /v1/admin/setup
  // ---------------------------------------------------------------------------------
  // Aggregates the seven onboarding signals per owned project. Single source of truth
  // for the dashboard `SetupChecklist` banner, the full `/onboarding` wizard, and
  // every contextual EmptyState nudge across the app. Reads live DB state instead of
  // the legacy `localStorage.mushi:onboarding_completed` flag so progress survives
  // across devices/browsers and reflects the actual pipeline.
  // =================================================================================
  app.get('/v1/admin/setup', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Setup wizard + ProjectSwitcher must list every accessible project.
    // callerProjectIds would collapse to the pinned X-Mushi-Project-Id.
    const accessibleIds = await enumerateAccessibleProjectIds(c, db, userId);
    const { data: projects } = accessibleIds.length
      ? await db
          .from('projects')
          .select('id, name, slug, created_at')
          .in('id', accessibleIds)
          .order('created_at', { ascending: true })
      : { data: [] as Array<{ id: string; name: string; slug: string; created_at: string }> };

    if (!projects || projects.length === 0) {
      return c.json({
        ok: true,
        data: {
          admin_endpoint_host: (() => {
            try {
              return new URL(c.req.url).host || null;
            } catch {
              return null;
            }
          })(),
          has_any_project: false,
          projects: [],
        },
      });
    }

    const projectIds = projects.map((p) => p.id);

    // Pull every signal in parallel; we project narrow column lists to keep this
    // cheap even when the user owns dozens of projects. We also pull each key's
    // SDK heartbeat (`last_seen_*`) so the dashboard can prove the SDK has
    // reached THIS backend without waiting for a real user-triggered report —
    // see migration 20260505000000_project_api_keys_last_seen.sql for rationale.
    const [keysRes, settingsRes, reportsRes, fixesRes, reposRes, codebaseFilesRes, qaRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select(
          'project_id, is_active, last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host',
        )
        .in('project_id', projectIds)
        .eq('is_active', true),
      db
        .from('project_settings')
        .select('project_id, github_repo_url, sentry_org_slug, byok_anthropic_key_ref, slack_channel_id, slack_webhook_url')
        .in('project_id', projectIds),
      db
        .from('reports')
        .select('project_id, environment, created_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(500),
      db
        .from('fix_attempts')
        .select('project_id, merged_at')
        .in('project_id', projectIds)
        .limit(1000),
      db.from('project_repos').select('project_id').in('project_id', projectIds),
      // Pull only project_id so we can count indexed files per project without
      // transferring payload. Used by ExplorePage to determine the "not indexed
      // yet" empty state.
      db.from('project_codebase_files').select('project_id').in('project_id', projectIds),
      db
        .from('qa_stories')
        .select('project_id')
        .in('project_id', projectIds)
        .eq('last_run_status', 'passed')
        .limit(500),
    ]);

    const keyByProject = new Set<string>();
    interface SdkHeartbeat {
      last_seen_at: string;
      last_seen_origin: string | null;
      last_seen_user_agent: string | null;
      last_seen_endpoint_host: string | null;
    }
    const heartbeatByProject = new Map<string, SdkHeartbeat>();
    for (const k of keysRes.data ?? []) {
      keyByProject.add(k.project_id);
      const seenAt = (k as { last_seen_at?: string | null }).last_seen_at ?? null;
      if (!seenAt) continue;
      const existing = heartbeatByProject.get(k.project_id);
      // Multiple keys per project are common (rotation, scoped keys); keep the
      // freshest heartbeat so the UI shows the most recent SDK activity.
      if (existing && existing.last_seen_at >= seenAt) continue;
      heartbeatByProject.set(k.project_id, {
        last_seen_at: seenAt,
        last_seen_origin: (k as { last_seen_origin?: string | null }).last_seen_origin ?? null,
        last_seen_user_agent: (k as { last_seen_user_agent?: string | null }).last_seen_user_agent ?? null,
        last_seen_endpoint_host:
          (k as { last_seen_endpoint_host?: string | null }).last_seen_endpoint_host ?? null,
      });
    }

    const settingsByProject = new Map<
      string,
      {
        github_repo_url: string | null;
        sentry_org_slug: string | null;
        byok_anthropic_key_ref: string | null;
        slack_channel_id: string | null;
        slack_webhook_url: string | null;
      }
    >();
    for (const s of settingsRes.data ?? []) settingsByProject.set(s.project_id, s as never);

    const reposByProject = new Set<string>();
    for (const r of reposRes.data ?? []) reposByProject.add(r.project_id);

    const indexedFileCountByProject = new Map<string, number>();
    for (const f of codebaseFilesRes.data ?? []) {
      indexedFileCountByProject.set(f.project_id, (indexedFileCountByProject.get(f.project_id) ?? 0) + 1);
    }

    // Legacy fallback signal: at least one report whose `environment.platform`
    // is a real platform (not the admin-only `mushi-admin` synthetic the
    // "send test report" button emits). This used to be the SOLE check, but
    // it falsely flagged correctly-installed SDKs as missing whenever no real
    // user had triggered a bug yet, AND it gave operators no diagnostic when
    // the SDK was talking to a different backend than the admin. The
    // heartbeat above is now the primary signal; we keep this as a fallback
    // so projects whose SDKs predate the heartbeat migration stay green.
    const sdkReportSignalByProject = new Set<string>();
    const reportsByProject = new Map<string, { count: number; firstAt: string | null }>();
    for (const r of reportsRes.data ?? []) {
      const cur = reportsByProject.get(r.project_id) ?? { count: 0, firstAt: null };
      cur.count += 1;
      cur.firstAt = r.created_at;
      reportsByProject.set(r.project_id, cur);
      const env = (r.environment ?? {}) as Record<string, unknown>;
      const platform = typeof env.platform === 'string' ? env.platform : '';
      if (platform && platform !== 'mushi-admin') sdkReportSignalByProject.add(r.project_id);
    }

    // Track BOTH "any fix dispatched" (drives the Check stage transition into
    // 'active') and "fix merged" (drives Check → 'done'). Without the merged
    // count the dashboard's PDCA loop card flips straight from 'next' to
    // 'done' and falsely claims "Loop closed" the moment a draft PR opens.
    const fixesByProject = new Map<string, number>();
    const mergedFixesByProject = new Map<string, number>();
    for (const f of fixesRes.data ?? []) {
      fixesByProject.set(f.project_id, (fixesByProject.get(f.project_id) ?? 0) + 1);
      if (f.merged_at) {
        mergedFixesByProject.set(f.project_id, (mergedFixesByProject.get(f.project_id) ?? 0) + 1);
      }
    }

    const qaPassingByProject = new Set<string>();
    for (const q of qaRes.data ?? []) qaPassingByProject.add(q.project_id);

    type StepId =
      | 'project_created'
      | 'api_key_generated'
      | 'sdk_installed'
      | 'first_report_received'
      | 'github_connected'
      | 'sentry_connected'
      | 'byok_anthropic'
      | 'first_fix_dispatched'
      | 'slack_connected'
      | 'first_qa_story_passing';

    interface Step {
      id: StepId;
      label: string;
      description: string;
      complete: boolean;
      /** True when this step is required for the basic pipeline to work. */
      required: boolean;
      /** Admin-console link the wizard / nudge should jump to. */
      cta_to: string;
      cta_label: string;
      /**
       * Optional diagnostic the FE renders inline on the row. Populated for
       * `sdk_installed` so operators can debug "installed but checklist still
       * red" without grepping logs (e.g. when the SDK and admin point at
       * different backends — the host this admin is reading from is shown
       * next to where the SDK was last seen, making the mismatch obvious).
       */
      diagnostic?: {
        last_sdk_seen_at: string | null;
        last_sdk_origin: string | null;
        last_sdk_user_agent: string | null;
        last_sdk_endpoint_host: string | null;
      };
    }

    // The hostname of THIS admin's edge function, captured once per request,
    // so the FE can compare it to last_sdk_endpoint_host on each project and
    // show "your SDK is talking to a different backend" when they diverge.
    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null;
      } catch {
        return null;
      }
    })();

    const enriched = projects.map((p) => {
      const hasKey = keyByProject.has(p.id);
      const settings = settingsByProject.get(p.id);
      const heartbeat = heartbeatByProject.get(p.id) ?? null;
      // Heartbeat (SDK reached this backend) is the canonical signal.
      // Legacy report-based fallback covers projects whose SDKs predate the
      // heartbeat columns or where keys were rotated and only old reports
      // remain — keeps already-green checklists green after the migration.
      const hasSdk = Boolean(heartbeat) || sdkReportSignalByProject.has(p.id);
      const reportInfo = reportsByProject.get(p.id) ?? { count: 0, firstAt: null };
      const hasGithub = Boolean(settings?.github_repo_url) || reposByProject.has(p.id);
      const hasSentry = Boolean(settings?.sentry_org_slug);
      const hasByok = Boolean(settings?.byok_anthropic_key_ref);
      const hasSlack = Boolean(settings?.slack_channel_id) || Boolean(settings?.slack_webhook_url);
      const hasQaPassing = qaPassingByProject.has(p.id);
      const fixCount = fixesByProject.get(p.id) ?? 0;
      const mergedFixCount = mergedFixesByProject.get(p.id) ?? 0;

      const steps: Step[] = [
        {
          id: 'project_created',
          label: 'Create your first project',
          description: 'A project groups all bug reports from one application.',
          complete: true,
          required: true,
          cta_to: '/onboarding?tab=steps&setup=cli',
          cta_label: 'Open setup wizard',
        },
        {
          id: 'api_key_generated',
          label: 'Generate an API key',
          description: 'Your SDK uses this key to authenticate report submissions.',
          complete: hasKey,
          required: true,
          cta_to: '/onboarding?tab=verify',
          cta_label: 'Generate API key',
        },
        {
          id: 'sdk_installed',
          label: 'Install the SDK in your app',
          description: 'Drop the Mushi widget into your app so users can submit reports.',
          complete: hasSdk,
          required: true,
          cta_to: '/onboarding?tab=sdk',
          cta_label: 'Install SDK',
          diagnostic: {
            last_sdk_seen_at: heartbeat?.last_seen_at ?? null,
            last_sdk_origin: heartbeat?.last_seen_origin ?? null,
            last_sdk_user_agent: heartbeat?.last_seen_user_agent ?? null,
            last_sdk_endpoint_host: heartbeat?.last_seen_endpoint_host ?? null,
          },
        },
        {
          id: 'first_report_received',
          label: 'Receive your first bug report',
          description: 'Send a test report or wait for a real user submission.',
          complete: reportInfo.count > 0,
          required: true,
          cta_to: '/onboarding?tab=verify',
          cta_label: 'Send test report',
        },
        {
          id: 'github_connected',
          label: 'Connect GitHub',
          description: 'Required for auto-fix PRs and code grounding.',
          complete: hasGithub,
          required: false,
          cta_to: '/integrations',
          cta_label: 'Connect GitHub',
        },
        {
          id: 'sentry_connected',
          label: 'Connect Sentry (optional)',
          description: 'Pull Sentry issues + Seer root-cause into Mushi reports.',
          complete: hasSentry,
          required: false,
          cta_to: '/integrations',
          cta_label: 'Connect Sentry',
        },
        {
          id: 'byok_anthropic',
          label: 'Add your Anthropic key (optional)',
          description: 'BYOK avoids platform quotas and sends usage to your own bill.',
          complete: hasByok,
          required: false,
          cta_to: '/settings',
          cta_label: 'Add API key',
        },
        {
          id: 'first_fix_dispatched',
          label: 'Dispatch your first auto-fix',
          description: 'Open a report, click "Dispatch fix", and watch the LLM agent.',
          complete: fixCount > 0,
          required: false,
          cta_to: '/reports',
          cta_label: 'Open Reports',
        },
        {
          id: 'slack_connected',
          label: 'Connect Slack (optional)',
          description: 'Get instant Slack alerts when a QA story fails or a new report is classified.',
          complete: hasSlack,
          required: false,
          cta_to: '/integrations',
          cta_label: 'Add to Slack',
        },
        {
          id: 'first_qa_story_passing',
          label: 'Set up a QA story (optional)',
          description: 'Write a plain-English test that runs on a schedule — catch regressions before your users do.',
          complete: hasQaPassing,
          required: false,
          cta_to: '/qa-coverage',
          cta_label: 'Create QA story',
        },
      ];

      const requiredSteps = steps.filter((s) => s.required);
      const completeRequired = requiredSteps.filter((s) => s.complete).length;
      const completeAll = steps.filter((s) => s.complete).length;

      return {
        project_id: p.id,
        project_name: p.name,
        project_slug: p.slug,
        created_at: p.created_at,
        steps,
        required_total: requiredSteps.length,
        required_complete: completeRequired,
        total: steps.length,
        complete: completeAll,
        done: completeRequired === requiredSteps.length,
        report_count: reportInfo.count,
        fix_count: fixCount,
        merged_fix_count: mergedFixCount,
        indexed_file_count: indexedFileCountByProject.get(p.id) ?? 0,
      };
    });

    return c.json({
      ok: true,
      data: {
        // Surfaced so the FE can compare each project's last SDK endpoint host
        // against the host the admin is actually reading from. When they
        // differ the dashboard renders an explicit "your SDK is talking to a
        // different backend" warning instead of leaving the user wondering
        // why a working SDK never ticks the checklist green.
        admin_endpoint_host: adminHost,
        has_any_project: true,
        projects: enriched,
      },
    });
  });

}
