/**
 * FILE: packages/server/supabase/functions/api/routes/activation-setup-builder.ts
 * PURPOSE: The setup checklist payload, built from the one step list in
 *          _shared/setup-steps.ts. Served as-is by `GET /v1/admin/setup`
 *          (onboarding-setup.ts) and as the `setup` block of
 *          `GET /v1/admin/activation` (activation.ts), so the two can never
 *          disagree on a step, a label or a count.
 */

import type { getServiceClient } from '../../_shared/db.ts';
import { ownedProjectIds } from '../shared.ts';
import { loadProjectSetupSignals, type ProjectSetupSignals } from '../../_shared/setup-signals.ts';
import { evaluateSetupSteps, requiredSetupProgress, type EvaluatedSetupStep } from '../../_shared/setup-steps.ts';

export const SetupResponseSchema = {
  async parseAsync<T>(value: T): Promise<T> {
    return value;
  },
};

/**
 * Shown inline on the `sdk_installed` row so "installed but still red" can be
 * debugged without logs (e.g. the SDK and this console point at different
 * backends: the host this admin reads from sits next to where the SDK was
 * last seen).
 */
interface SdkDiagnostic {
  last_sdk_seen_at: string | null;
  last_sdk_origin: string | null;
  last_sdk_user_agent: string | null;
  last_sdk_endpoint_host: string | null;
  last_sdk_key_label: string | null;
}

/** One project's checklist. Exported for the step-list agreement test. */
export function buildSetupProject(
  p: { id: string; name: string; slug: string; created_at: string; organization_id?: string | null },
  sig: ProjectSetupSignals | undefined,
) {
  const signals = {
    hasKey: sig?.hasKey ?? false,
    hasSdk: sig?.hasSdk ?? false,
    reportCount: sig?.reportCount ?? 0,
    hasGithub: sig?.hasGithub ?? false,
    hasSentry: sig?.hasSentry ?? false,
    hasByok: sig?.hasByok ?? false,
    hasSlack: sig?.hasSlack ?? false,
    fixCount: sig?.fixCount ?? 0,
    hasQaPassing: sig?.hasQaPassing ?? false,
  };
  const heartbeat = sig?.heartbeat ?? null;
  const steps: Array<EvaluatedSetupStep & { diagnostic?: SdkDiagnostic }> = evaluateSetupSteps(signals).map(
    (step) =>
      step.id === 'sdk_installed'
        ? {
            ...step,
            diagnostic: {
              last_sdk_seen_at: heartbeat?.last_seen_at ?? null,
              last_sdk_origin: heartbeat?.last_seen_origin ?? null,
              last_sdk_user_agent: heartbeat?.last_seen_user_agent ?? null,
              last_sdk_endpoint_host: heartbeat?.last_seen_endpoint_host ?? null,
              last_sdk_key_label: heartbeat?.key_label ?? null,
            },
          }
        : step,
  );
  const progress = requiredSetupProgress(signals);

  return {
    project_id: p.id,
    project_name: p.name,
    project_slug: p.slug,
    created_at: p.created_at,
    // The team that owns it, from the row: the console's project→team memory
    // reads only this (audit 2026-11-11: tagging the list with the ACTIVE team
    // filed other teams' apps under an empty team and the switch reverted).
    organization_id: p.organization_id ?? null,
    steps,
    required_total: progress.requiredTotal,
    required_complete: progress.requiredComplete,
    total: steps.length,
    complete: steps.filter((s) => s.complete).length,
    done: progress.setupDone,
    report_count: signals.reportCount,
    fix_count: signals.fixCount,
    merged_fix_count: sig?.mergedFixCount ?? 0,
    indexed_file_count: sig?.indexedFileCount ?? 0,
  };
}

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
        .select('id, name, slug, created_at, organization_id')
        .in('id', accessibleIds)
        .order('created_at', { ascending: true })
    : { data: [] as Array<{ id: string; name: string; slug: string; created_at: string; organization_id: string | null }> };

  if (!projects || projects.length === 0) {
    return {
      admin_endpoint_host: adminHost,
      has_any_project: false,
      projects: [],
    };
  }

  // One shared loader, including each key's SDK heartbeat (`last_seen_*`), so
  // the console can prove the SDK reached THIS backend without waiting for a
  // real report (migration 20260505000000_project_api_keys_last_seen.sql).
  const signalsByProject = await loadProjectSetupSignals(db, projects.map((p) => p.id));

  return {
    // Surfaced so the console can compare each project's last SDK endpoint
    // host with the host it reads from, and say "your SDK is talking to a
    // different backend" instead of leaving a working SDK unticked.
    admin_endpoint_host: adminHost,
    has_any_project: true,
    projects: projects.map((p) => buildSetupProject(p, signalsByProject.get(p.id))),
  };
}
