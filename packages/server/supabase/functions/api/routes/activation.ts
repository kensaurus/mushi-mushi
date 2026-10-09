/**
 * FILE: packages/server/supabase/functions/api/routes/activation.ts
 * PURPOSE: Unified activation cockpit — one round-trip for setup posture,
 *          onboarding stats, dispatch preflight, and the next best action.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import {
  callerProjectIds,
  enumerateAccessibleProjectIds,
  resolveOwnedProject,
  callerCanAccessProject,
} from '../shared.ts';
import { resolveLlmKey } from '../../_shared/byok.ts';
import {
  buildTopPriority,
  deriveActivationPhase,
  resolveNextStepTo,
} from '../../_shared/activation-status.ts';
import { buildSetupResponse } from './activation-setup-builder.ts';
import { buildOnboardingStatsPayload } from './activation-onboarding-builder.ts';
import { isNonRealReport } from '../../_shared/first-report.ts';
import { loadIntegrationSignals, loadProjectSetupSignals } from '../../_shared/setup-signals.ts';

export function registerActivationRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/activation', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIdParam = c.req.query('project_id') ?? null;

    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null;
      } catch {
        return null;
      }
    })();

    const allAccessibleIds = await enumerateAccessibleProjectIds(c, db, userId);
    if (allAccessibleIds.length === 0) {
      const emptyStats = buildOnboardingStatsPayload({
        hasAnyProject: false,
        adminHost,
        project: null,
        signals: null,
      });
      return c.json({
        ok: true,
        data: {
          setup: {
            admin_endpoint_host: adminHost,
            has_any_project: false,
            projects: [],
          },
          stats: emptyStats,
          preflight: null,
          phase: 'ingest' as const,
          top_priority: buildTopPriority({
            setupDone: false,
            nextStepId: 'project_created',
            nextStepLabel: 'Create your first project',
            reportCount: 0,
          }),
          feature_flags: { activation_cockpit_v2: true },
        },
      });
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      overrideProjectId: projectIdParam ?? undefined,
      noProjectResponse: () =>
        c.json({
          ok: false,
          error: { code: 'NO_PROJECT', message: 'No accessible project found' },
        }, 404),
    });
    if ('response' in resolvedProject) return resolvedProject.response;

    const project = resolvedProject.project;
    const pid = project.id;

    const [setupData, statsPayload, preflight] = await Promise.all([
      buildSetupResponse(db, userId, adminHost, allAccessibleIds),
      buildOnboardingStatsForProject(db, userId, pid, adminHost),
      buildPreflightSummary(c, db, userId, pid),
    ]);

    const stats = {
      ...statsPayload,
      nextStepTo: resolveNextStepTo(statsPayload.nextStepId),
    };

    const phase = deriveActivationPhase({
      setupDone: stats.setupDone,
      reportCount: stats.reportCount,
      fixCount: stats.fixCount,
      mergedFixCount: stats.mergedFixCount,
    });

    return c.json({
      ok: true,
      data: {
        setup: setupData,
        stats,
        preflight,
        phase,
        top_priority: buildTopPriority({
          setupDone: stats.setupDone,
          nextStepId: stats.nextStepId,
          nextStepLabel: stats.nextStepLabel,
          reportCount: stats.reportCount,
        }),
        feature_flags: { activation_cockpit_v2: true },
      },
    });
  });
}

async function buildOnboardingStatsForProject(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  projectId: string,
  adminHost: string | null,
) {
  const { data: project } = await db
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .maybeSingle();

  const [signalsByProject, firstReportsRes] = await Promise.all([
    loadProjectSetupSignals(db, [projectId]),
    // Oldest reports, filtered in TS below to the first REAL one (console test
    // reports and the marketing seed never count — same predicate as
    // first_report_received). 50 is plenty: a project has at most a handful
    // of test reports before a real one lands.
    db
      .from('reports')
      .select('id, created_at, custom_metadata')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(50),
  ]);

  const sig = signalsByProject.get(projectId);
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

  let firstReportAt: string | null = null;
  for (const r of (firstReportsRes.data ?? []) as Array<{
    created_at: string;
    custom_metadata: Record<string, unknown> | null;
  }>) {
    if (isNonRealReport(r.custom_metadata)) continue;
    firstReportAt = r.created_at;
    break;
  }

  return buildOnboardingStatsPayload({
    hasAnyProject: true,
    adminHost,
    project: project ? { id: project.id, name: project.name } : null,
    signals: {
      hasKey,
      hasSdk,
      sdkEndpointHost,
      sdkHostMismatch,
      hasGithub,
      hasSentry,
      hasByok,
      hasQaPassing,
      reportCount,
      fixCount,
      mergedFixCount,
      firstReportAt,
    },
  });
}

async function buildPreflightSummary(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  projectId: string,
) {
  const access = await callerCanAccessProject(c, db, userId, projectId);
  if (!access.allowed) return null;

  const [settingsRes, integrationSignals, anthropicKey] = await Promise.all([
    db
      .from('project_settings')
      .select('codebase_index_enabled, autofix_enabled')
      .eq('project_id', projectId)
      .maybeSingle(),
    loadIntegrationSignals(db, [projectId]),
    // Is a key configured? A probe, not a generation: no budget check.
    resolveLlmKey(db, projectId, 'anthropic', { purpose: 'probe' }),
  ]);

  const settings = settingsRes.data;
  // Same rule as the setup checklist: a repo AND a credential to open PRs with.
  const hasGithub = integrationSignals.get(projectId)?.hasGithub ?? false;
  const hasAnthropic = Boolean(anthropicKey);
  const hasCodebase = Boolean(settings?.codebase_index_enabled);
  const hasAutofix = Boolean(settings?.autofix_enabled);

  const checks = [
    { key: 'github', ready: hasGithub, label: 'GitHub repo connected' },
    { key: 'codebase', ready: hasCodebase, label: 'Codebase indexed' },
    { key: 'anthropic', ready: hasAnthropic, label: 'Anthropic key available' },
    { key: 'autofix', ready: hasAutofix, label: 'Autofix enabled' },
  ];

  return {
    ready: checks.every((c) => c.ready),
    checks,
  };
}
