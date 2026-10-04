/**
 * FILE: packages/server/supabase/functions/api/routes/activation-setup-builder.ts
 * PURPOSE: Setup response builder shared by `/v1/admin/setup` and activation.
 */

import type { getServiceClient } from '../../_shared/db.ts';
import { ownedProjectIds } from '../shared.ts';
import { loadProjectSetupSignals } from '../../_shared/setup-signals.ts';

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

  const signalsByProject = await loadProjectSetupSignals(db, projectIds);

  const enriched = projects.map((p) => {
    const sig = signalsByProject.get(p.id);
    const hasKey = sig?.hasKey ?? false;
    const heartbeat = sig?.heartbeat ?? null;
    const hasSdk = sig?.hasSdk ?? false;
    const reportCount = sig?.reportCount ?? 0;
    const hasGithub = sig?.hasGithub ?? false;
    const hasSentry = sig?.hasSentry ?? false;
    const hasByok = sig?.hasByok ?? false;
    const hasSlack = sig?.hasSlack ?? false;
    const fixCount = sig?.fixCount ?? 0;
    const mergedFixCount = sig?.mergedFixCount ?? 0;
    const hasQaPassing = sig?.hasQaPassing ?? false;

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
      // Recommended, not required: the activation event is the first
      // diagnosis, which the one-click test report reaches without an SDK
      // install (docs/plan-gtm.md → Workstream B §2b). Required steps are
      // exactly project_created, api_key_generated, first_report_received.
      {
        id: 'sdk_installed',
        label: 'Install the SDK in your app',
        description: 'Drop the Mushi widget into your app so users can submit reports.',
        complete: hasSdk,
        required: false,
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
        description: 'Send a test report now, or install the SDK and wait for a real one.',
        complete: reportCount > 0,
        required: true,
        cta_to: '/onboarding',
        cta_label: 'See your first diagnosis',
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
      report_count: reportCount,
      fix_count: fixCount,
      merged_fix_count: mergedFixCount,
      indexed_file_count: sig?.indexedFileCount ?? 0,
    };
  });

  return {
    admin_endpoint_host: adminHost,
    has_any_project: true,
    projects: enriched,
  };
}
