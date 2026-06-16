/**
 * FILE: packages/server/supabase/functions/api/routes/activation-setup-builder.ts
 * PURPOSE: Setup response builder shared by `/v1/admin/setup` and activation.
 */

import type { getServiceClient } from '../../_shared/db.ts';
import { ownedProjectIds } from '../shared.ts';

export const SetupResponseSchema = {
  async parseAsync<T>(value: T): Promise<T> {
    return value;
  },
};

export async function buildSetupResponse(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  adminHost: string | null,
  accessibleIdsOverride?: string[],
) {
  const accessibleIds = accessibleIdsOverride ?? (await ownedProjectIds(db, userId));
  const { data: projects } = accessibleIds.length
    ? await db
        .from('projects')
        .select('id, name, slug, created_at')
        .in('id', accessibleIds)
        .order('created_at', { ascending: true })
    : { data: [] as Array<{ id: string; name: string; slug: string; created_at: string }> };

  if (!projects || projects.length === 0) {
    return {
      admin_endpoint_host: adminHost,
      has_any_project: false,
      projects: [],
    };
  }

  const projectIds = projects.map((p) => p.id);

  const [keysRes, settingsRes, reportsRes, fixesRes, reposRes, codebaseFilesRes, qaRes] =
    await Promise.all([
      db
        .from('project_api_keys')
        .select(
          'project_id, is_active, last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host',
        )
        .in('project_id', projectIds)
        .eq('is_active', true),
      db
        .from('project_settings')
        .select(
          'project_id, github_repo_url, sentry_org_slug, byok_anthropic_key_ref, slack_channel_id, slack_webhook_url',
        )
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
      db.from('project_codebase_files').select('project_id').in('project_id', projectIds),
      db
        .from('qa_stories')
        .select('project_id, last_run_status')
        .in('project_id', projectIds)
        .eq('last_run_status', 'passed'),
    ]);

  const keyByProject = new Set<string>();
  const heartbeatByProject = new Map<
    string,
    {
      last_seen_at: string;
      last_seen_origin: string | null;
      last_seen_user_agent: string | null;
      last_seen_endpoint_host: string | null;
    }
  >();
  for (const k of keysRes.data ?? []) {
    keyByProject.add(k.project_id);
    const seenAt = (k as { last_seen_at?: string | null }).last_seen_at ?? null;
    if (!seenAt) continue;
    const existing = heartbeatByProject.get(k.project_id);
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
    indexedFileCountByProject.set(
      f.project_id,
      (indexedFileCountByProject.get(f.project_id) ?? 0) + 1,
    );
  }

  const qaPassingByProject = new Set<string>();
  for (const q of qaRes.data ?? []) qaPassingByProject.add(q.project_id);

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

  const fixesByProject = new Map<string, number>();
  const mergedFixesByProject = new Map<string, number>();
  for (const f of fixesRes.data ?? []) {
    fixesByProject.set(f.project_id, (fixesByProject.get(f.project_id) ?? 0) + 1);
    if (f.merged_at) {
      mergedFixesByProject.set(
        f.project_id,
        (mergedFixesByProject.get(f.project_id) ?? 0) + 1,
      );
    }
  }

  const enriched = projects.map((p) => {
    const hasKey = keyByProject.has(p.id);
    const settings = settingsByProject.get(p.id);
    const heartbeat = heartbeatByProject.get(p.id) ?? null;
    const hasSdk = Boolean(heartbeat) || sdkReportSignalByProject.has(p.id);
    const reportInfo = reportsByProject.get(p.id) ?? { count: 0, firstAt: null };
    const hasGithub = Boolean(settings?.github_repo_url) || reposByProject.has(p.id);
    const hasSentry = Boolean(settings?.sentry_org_slug);
    const hasByok = Boolean(settings?.byok_anthropic_key_ref);
    const hasSlack = Boolean(settings?.slack_channel_id) || Boolean(settings?.slack_webhook_url);
    const fixCount = fixesByProject.get(p.id) ?? 0;
    const mergedFixCount = mergedFixesByProject.get(p.id) ?? 0;
    const hasQaPassing = qaPassingByProject.has(p.id);

    const steps = [
      {
        id: 'project_created',
        label: 'Create your first project',
        description: 'A project groups all bug reports from one application.',
        complete: true,
        required: true,
        cta_to: '/projects',
        cta_label: 'Manage projects',
      },
      {
        id: 'api_key_generated',
        label: 'Generate an API key',
        description: 'Your SDK uses this key to authenticate report submissions.',
        complete: hasKey,
        required: true,
        cta_to: '/projects',
        cta_label: 'Generate key',
      },
      {
        id: 'sdk_installed',
        label: 'Install the SDK in your app',
        description: 'Drop the Mushi widget into your app so users can submit reports.',
        complete: hasSdk,
        required: true,
        cta_to: '/onboarding',
        cta_label: 'View setup guide',
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
        cta_to: '/onboarding',
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
        description: 'Write a plain-English test that runs on a schedule.',
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

  return {
    admin_endpoint_host: adminHost,
    has_any_project: true,
    projects: enriched,
  };
}
