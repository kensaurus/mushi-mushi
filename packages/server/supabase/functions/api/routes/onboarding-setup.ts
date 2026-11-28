import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { callerProjectIds, enumerateAccessibleProjectIds, resolveOwnedProject } from '../shared.ts';
import { resolveNextStepTo } from '../../_shared/activation-status.ts';
import { isOperatorUser } from '../../_shared/operator-gate.ts';
import { isNotFirstReportSource } from '../../_shared/first-report.ts';
import { loadProjectSetupSignals } from '../../_shared/setup-signals.ts';
import {
  FIRST_SETUP_STEP,
  SETUP_OPTIONAL_TOTAL,
  SETUP_REQUIRED_TOTAL,
  SETUP_STEPS_TOTAL,
  setupStepCounts,
} from '../../_shared/setup-steps.ts';
import { buildSetupResponse } from './activation-setup-builder.ts';

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
      requiredTotal: SETUP_REQUIRED_TOTAL,
      stepsComplete: 0,
      stepsTotal: SETUP_STEPS_TOTAL,
      optionalComplete: 0,
      optionalTotal: SETUP_OPTIONAL_TOTAL,
      setupDone: false,
      nextStepId: FIRST_SETUP_STEP.id as string | null,
      nextStepLabel: FIRST_SETUP_STEP.label as string | null,
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
    const reportCount = sig?.reportCount ?? 0;
    const fixCount = sig?.fixCount ?? 0;
    const mergedFixCount = sig?.mergedFixCount ?? 0;

    // The one step list (_shared/setup-steps.ts), as /v1/admin/setup counts it.
    const counts = setupStepCounts({
      hasKey,
      hasSdk,
      reportCount,
      hasGithub: sig?.hasGithub ?? false,
      hasSentry: sig?.hasSentry ?? false,
      hasByok: sig?.hasByok ?? false,
      hasSlack: sig?.hasSlack ?? false,
      fixCount,
      hasQaPassing: sig?.hasQaPassing ?? false,
    });
    const nextRequired = counts.next;

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
        requiredComplete: counts.requiredComplete,
        requiredTotal: counts.requiredTotal,
        stepsComplete: counts.stepsComplete,
        stepsTotal: counts.stepsTotal,
        optionalComplete: counts.optionalComplete,
        optionalTotal: counts.optionalTotal,
        setupDone: counts.setupDone,
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
  /** Oldest classified reports read to find the first real one past test reports. */
  const FIRST_DIAGNOSIS_SCAN = 25;
  app.get('/v1/admin/onboarding/time-to-first-diagnosis', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { keyMintedAt: null, firstDiagnosisAt: null, ms: null, firstReportId: null, testDiagnosisAt: null },
        }),
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
      // The console's "Send test report" and the marketing seed are not the
      // user's first diagnosis. The test report carries a Stage-1 object
      // since 2026-10-04 (REPORT A2), so they are skipped here by source,
      // with the same predicate as first_report_received.
      db
        .from('reports')
        .select('id, created_at, custom_metadata')
        .eq('project_id', pid)
        .not('stage1_classification', 'is', null)
        .order('created_at', { ascending: true })
        .limit(FIRST_DIAGNOSIS_SCAN),
    ]);

    const keyMintedAt = (firstKeyRes.data?.created_at as string | null) ?? null;
    const classified = (firstDiagnosisRes.data ?? []) as Array<{
      id: string;
      created_at: string;
      custom_metadata: Record<string, unknown> | null;
    }>;
    const firstReal = classified.find((row) => !isNotFirstReportSource(row.custom_metadata));
    const firstDiagnosisAt = firstReal?.created_at ?? null;
    // A test or seed report that was diagnosed, so Set up can say the
    // pipeline works while it waits for one from the app (report 9b7624e6).
    const testDiagnosisAt = classified.find((row) => isNotFirstReportSource(row.custom_metadata))?.created_at ?? null;

    let ms: number | null = null;
    if (keyMintedAt && firstDiagnosisAt) {
      const delta = new Date(firstDiagnosisAt).getTime() - new Date(keyMintedAt).getTime();
      // Guard against clock skew producing a negative interval.
      ms = delta >= 0 ? delta : null;
    }

    return c.json({
      ok: true,
      data: { keyMintedAt, firstDiagnosisAt, ms, firstReportId: firstReal?.id ?? null, testDiagnosisAt },
    });
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
    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null;
      } catch {
        return null;
      }
    })();

    // The same builder as the `setup` block of /v1/admin/activation, over the
    // one step list in _shared/setup-steps.ts: the two used to carry their own
    // copies and disagreed on whether the SDK step is required.
    const data = await buildSetupResponse(db, userId, adminHost, accessibleIds);
    return c.json({ ok: true, data });
  });
}
