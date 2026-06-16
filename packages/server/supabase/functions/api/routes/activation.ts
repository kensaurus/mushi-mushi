/**
 * FILE: packages/server/supabase/functions/api/routes/activation.ts
 * PURPOSE: Unified activation cockpit — one round-trip for setup posture,
 *          onboarding stats, dispatch preflight, and the next best action.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import {
  callerProjectIds,
  enumerateAccessibleProjectIds,
  resolveOwnedProject,
  userCanAccessProject,
} from '../shared.ts';
import { resolveLlmKey } from '../../_shared/byok.ts';
import {
  buildTopPriority,
  deriveActivationPhase,
  resolveNextStepTo,
} from '../../_shared/activation-status.ts';
import { buildSetupResponse } from './activation-setup-builder.ts';
import { buildOnboardingStatsPayload } from './activation-onboarding-builder.ts';

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
      buildPreflightSummary(db, userId, pid),
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

  const [keysRes, settingsRes, reportsRes, fixesRes, reposRes, qaRes] = await Promise.all([
    db
      .from('project_api_keys')
      .select('project_id, is_active, last_seen_at, last_seen_endpoint_host')
      .eq('project_id', projectId)
      .eq('is_active', true),
    db
      .from('project_settings')
      .select('project_id, github_repo_url, sentry_org_slug, byok_anthropic_key_ref')
      .eq('project_id', projectId)
      .maybeSingle(),
    db
      .from('reports')
      .select('id, environment, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('fix_attempts').select('id, merged_at').eq('project_id', projectId).limit(200),
    db.from('project_repos').select('project_id').eq('project_id', projectId).limit(1),
    db
      .from('qa_stories')
      .select('id, last_run_status')
      .eq('project_id', projectId)
      .eq('last_run_status', 'passed')
      .limit(1),
  ]);

  const hasKey = (keysRes.data ?? []).length > 0;
  let heartbeat: { last_seen_at: string; last_seen_endpoint_host: string | null } | null = null;
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
    },
  });
}

async function buildPreflightSummary(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  projectId: string,
) {
  const access = await userCanAccessProject(db, userId, projectId);
  if (!access.allowed) return null;

  const [settingsRes, reposRes, anthropicKey] = await Promise.all([
    db
      .from('project_settings')
      .select('github_repo_url, codebase_index_enabled, autofix_enabled')
      .eq('project_id', projectId)
      .maybeSingle(),
    db.from('project_repos').select('repo_url').eq('project_id', projectId).limit(1),
    resolveLlmKey(db, projectId, 'anthropic'),
  ]);

  const settings = settingsRes.data;
  const repos = reposRes.data ?? [];
  const hasGithub = Boolean(settings?.github_repo_url) || repos.length > 0;
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
