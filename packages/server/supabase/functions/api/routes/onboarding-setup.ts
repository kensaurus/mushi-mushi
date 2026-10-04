import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { callerProjectIds, enumerateAccessibleProjectIds, resolveOwnedProject } from '../shared.ts';
import { resolveNextStepTo } from '../../_shared/activation-status.ts';
import { isOperatorUser } from '../../_shared/operator-gate.ts';
import { loadProjectSetupSignals } from '../../_shared/setup-signals.ts';

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

    const sig = (await loadProjectSetupSignals(db, [pid])).get(pid);
    const hasKey = sig?.hasKey ?? false;
    const hasSdk = sig?.hasSdk ?? false;
    const sdkEndpointHost = sig?.heartbeat?.last_seen_endpoint_host ?? null;
    const sdkHostMismatch = Boolean(
      adminHost && sdkEndpointHost && sdkEndpointHost !== adminHost && hasSdk,
    );
    const hasGithub = sig?.hasGithub ?? false;
    const hasSentry = sig?.hasSentry ?? false;
    const hasByok = sig?.hasByok ?? false;
    const hasQaPassing = sig?.hasQaPassing ?? false;
    const reportCount = sig?.reportCount ?? 0;
    const fixCount = sig?.fixCount ?? 0;
    const mergedFixCount = sig?.mergedFixCount ?? 0;

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

    // Funnel dropoff stats for the operator panel (last 7 days, ALL users).
    // Cross-tenant aggregate → operators only (MUSHI_OPERATOR_USER_IDS); the
    // field is omitted for everyone else. Returns null on any DB error.
    const isOperator = isOperatorUser(userId);
    const funnelCounts = isOperator
      ? await (async () => {
          try {
            const { data } = await db.rpc('get_setup_funnel_counts_7d')
            return data as Record<string, number> | null
          } catch {
            return null
          }
        })()
      : null

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
        ...(isOperator ? { funnelCounts } : {}),
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

    // One shared loader (with the activation builder) so this checklist and the
    // onboarding lanes can never disagree. It includes each key's SDK heartbeat
    // (`last_seen_*`) so the dashboard can prove the SDK has reached THIS
    // backend without waiting for a real user-triggered report — see migration
    // 20260505000000_project_api_keys_last_seen.sql for rationale.
    const signalsByProject = await loadProjectSetupSignals(db, projectIds);

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
      const sig = signalsByProject.get(p.id);
      const hasKey = sig?.hasKey ?? false;
      const heartbeat = sig?.heartbeat ?? null;
      // Heartbeat (SDK reached this backend) is the canonical signal; the
      // curated SDK observation and the report-platform signal cover SDKs
      // that predate the heartbeat columns or keys that were rotated.
      const hasSdk = sig?.hasSdk ?? false;
      const reportCount = sig?.reportCount ?? 0;
      const hasGithub = sig?.hasGithub ?? false;
      const hasSentry = sig?.hasSentry ?? false;
      const hasByok = sig?.hasByok ?? false;
      const hasSlack = sig?.hasSlack ?? false;
      const hasQaPassing = sig?.hasQaPassing ?? false;
      const fixCount = sig?.fixCount ?? 0;
      const mergedFixCount = sig?.mergedFixCount ?? 0;

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
          complete: reportCount > 0,
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
          cta_to: '/integrations/config#platform-card-github',
          cta_label: 'Connect GitHub',
        },
        {
          id: 'sentry_connected',
          label: 'Connect Sentry (optional)',
          description: 'Pull Sentry issues + Seer root-cause into Mushi reports.',
          complete: hasSentry,
          required: false,
          cta_to: '/integrations/config#platform-card-sentry',
          cta_label: 'Connect Sentry',
        },
        {
          id: 'byok_anthropic',
          label: 'Add your Anthropic key (optional)',
          description: 'BYOK avoids platform quotas and sends usage to your own bill.',
          complete: hasByok,
          required: false,
          cta_to: '/settings?tab=byok',
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
          cta_to: '/integrations/config#integrations-slack',
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
        report_count: reportCount,
        fix_count: fixCount,
        merged_fix_count: mergedFixCount,
        indexed_file_count: sig?.indexedFileCount ?? 0,
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
