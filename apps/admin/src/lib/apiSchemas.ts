/**
 * FILE: apps/admin/src/lib/apiSchemas.ts
 * PURPOSE: Zod schemas for validating the top-10 API response shapes the
 *          admin console depends on. Pass these to apiFetch's optional
 *          `schema` parameter and any drift (field rename, nullable flip,
 *          shape regression) surfaces at the fetch boundary with a
 *          fingerprinted Sentry event rather than an opaque
 *          `Cannot read properties of undefined` deep in a render.
 *
 * SCOPE: intentionally lenient — .passthrough() on every object so that
 * backend additions NEVER break the frontend. We only assert the fields the
 * UI actively reads. New optional fields land on old deploys silently; only
 * a rename / type change (which the UI *will* stumble on) is a hard fail.
 *
 * Naming convention: SchemaName matches the API path slug, so grep is easy.
 */

import { z } from 'zod'

// ─── /v1/admin/setup ────────────────────────────────────────────────────────
// The DashboardPage + FirstRunTour + several cards all read setup status.
// Every field here is surfaced in the UI; a missing one flips to the empty
// state or a gate, so validation has real leverage. Matches SetupResponse
// in useSetupStatus.ts exactly — keep in sync when that type changes.
// SetupStepIdSchema accepts any string so new steps added on the backend
// never cause Zod validation to fail and break the ProjectSwitcher (the
// "Loading project…" forever bug). Known values are documented here for
// grep-ability; TypeScript callers use the SetupStepId union in
// useSetupStatus.ts for type-safe keying (REQUIRED_STEP_SHORT_LABEL, etc.).
// If you need to gate UI on a NEW step, add it to SetupStepId in
// useSetupStatus.ts — but DO NOT add it back to a z.enum() here.
const SetupStepIdSchema = z.string()

// Legacy named values (for reference only — no longer used as a Zod enum):
// 'project_created' | 'api_key_generated' | 'sdk_installed' |
// 'first_report_received' | 'github_connected' | 'sentry_connected' |
// 'byok_anthropic' | 'codebase_indexed' | 'autofix_enabled' |
// 'first_fix_dispatched' | 'slack_connected' | 'first_qa_story_passing'
/**
 * Optional diagnostic emitted alongside the `sdk_installed` step. The
 * fields come from `project_api_keys.last_seen_*`, set by the API-key
 * heartbeat in functions/_shared/auth.ts. Older deploys won't emit the
 * envelope, hence the optional shape — the FE falls back to the legacy
 * "did a non-admin report ever land" heuristic in that case.
 */
const SetupStepDiagnosticSchema = z
  .object({
    last_sdk_seen_at: z.string().nullable(),
    last_sdk_origin: z.string().nullable(),
    last_sdk_user_agent: z.string().nullable(),
    last_sdk_endpoint_host: z.string().nullable(),
  })
  .passthrough()
const SetupStepSchema = z
  .object({
    id: SetupStepIdSchema,
    label: z.string(),
    description: z.string(),
    complete: z.boolean(),
    required: z.boolean(),
    cta_to: z.string(),
    cta_label: z.string(),
    diagnostic: SetupStepDiagnosticSchema.optional(),
  })
  .passthrough()
const SetupProjectSchema = z
  .object({
    project_id: z.string(),
    project_name: z.string(),
    project_slug: z.string(),
    created_at: z.string(),
    steps: z.array(SetupStepSchema),
    required_total: z.number().int().nonnegative(),
    required_complete: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    complete: z.number().int().nonnegative(),
    done: z.boolean(),
    report_count: z.number().int().nonnegative(),
    fix_count: z.number().int().nonnegative(),
    merged_fix_count: z.number().int().nonnegative(),
    indexed_file_count: z.number().int().nonnegative().optional(),
  })
  .passthrough()
export const SetupResponseSchema = z
  .object({
    has_any_project: z.boolean(),
    projects: z.array(SetupProjectSchema),
    /**
     * Hostname of the edge function this admin is currently reading from.
     * Compared against each project's `diagnostic.last_sdk_endpoint_host`
     * to surface "your SDK is talking to a different backend" warnings on
     * the setup checklist. Optional for backward compat with pre-heartbeat
     * deploys.
     */
    admin_endpoint_host: z.string().nullable().optional(),
  })
  .passthrough()

// ─── /v1/admin/activation ───────────────────────────────────────────────────
const ActivationTopPrioritySchema = z
  .object({
    label: z.string(),
    to: z.string(),
    tone: z.enum(['plan', 'do', 'idle']),
  })
  .passthrough()

const ActivationPreflightSchema = z
  .object({
    ready: z.boolean(),
    checks: z.array(
      z
        .object({
          key: z.string(),
          ready: z.boolean(),
          label: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough()

const OnboardingStatsSchema = z
  .object({
    hasAnyProject: z.boolean(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    requiredComplete: z.number().int().nonnegative(),
    requiredTotal: z.number().int().nonnegative(),
    stepsComplete: z.number().int().nonnegative(),
    stepsTotal: z.number().int().nonnegative(),
    optionalComplete: z.number().int().nonnegative().optional(),
    optionalTotal: z.number().int().nonnegative().optional(),
    setupDone: z.boolean(),
    nextStepId: z.string().nullable(),
    nextStepLabel: z.string().nullable(),
    sdkInstalled: z.boolean(),
    sdkHostMismatch: z.boolean(),
    adminEndpointHost: z.string().nullable(),
    sdkEndpointHost: z.string().nullable(),
    hasApiKey: z.boolean(),
    reportCount: z.number().int().nonnegative(),
    fixCount: z.number().int().nonnegative(),
    mergedFixCount: z.number().int().nonnegative(),
    nextStepTo: z.string().nullable().optional(),
    funnelCounts: z.record(z.string(), z.number()).nullable().optional(),
  })
  .passthrough()

export const ActivationResponseSchema = z
  .object({
    setup: SetupResponseSchema,
    stats: OnboardingStatsSchema,
    preflight: ActivationPreflightSchema.nullable(),
    phase: z.enum(['ingest', 'dispatch', 'loop']),
    top_priority: ActivationTopPrioritySchema,
    feature_flags: z
      .object({
        activation_cockpit_v2: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

// ─── /v1/admin/dashboard ────────────────────────────────────────────────────

// ─── /v1/admin/projects ─────────────────────────────────────────────────────

// ─── /v1/admin/reports (list) ───────────────────────────────────────────────

// ─── /v1/admin/reports/:id ──────────────────────────────────────────────────

// ─── /v1/admin/queue ────────────────────────────────────────────────────────

// ─── /v1/admin/health ───────────────────────────────────────────────────────

// ─── /v1/admin/billing ──────────────────────────────────────────────────────

// ─── /v1/admin/judge ────────────────────────────────────────────────────────

// ─── /v1/admin/settings ─────────────────────────────────────────────────────

// ─── /v1/admin/notifications ────────────────────────────────────────────────

// ─── /v1/admin/chart-events ──────────────────────────────────────────────────
// Wave T.5.8a chart-annotation feed. Three event kinds unioned into one
// shape so the overlay can render dots regardless of source. The UI
// treats any unknown kind as a no-op decoration; schema passthrough keeps
// the server free to extend later (e.g. `incident`, `runbook`).
const ChartEventKindSchema = z.enum(['deploy', 'cron', 'byok'])

/** @internal Exported for tests only. */
export const ChartEventSchema = z
  .object({
    occurred_at: z.string(),
    kind: ChartEventKindSchema,
    label: z.string(),
    href: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
  })
  .passthrough()

export type ChartEvent = z.infer<typeof ChartEventSchema>

// ─── /v1/admin/migrations/progress ──────────────────────────────────────────
// Migration Hub Phase 2 — DB-backed checklist progress for the docs hub.
// The card on OnboardingPage / ProjectsPage reads from this; the docs sync
// hook writes to it through the same envelope.
// completed_step_ids and knownGuideSlugs intentionally use plain arrays
// (no `.default([])`) so Zod's input == output types — apiFetch infers the
// generic from the schema and refuses to type-narrow when input differs
// from output. Backend always returns arrays for both (DB column has NOT
// NULL DEFAULT '{}'), so this is safe.
const MigrationProgressRowSchema = z
  .object({
    id: z.string().uuid(),
    guide_slug: z.string().min(1).max(80),
    project_id: z.string().uuid().nullable(),
    completed_step_ids: z.array(z.string()),
    required_step_count: z.number().int().nonnegative().nullable(),
    completed_required_count: z.number().int().nonnegative(),
    source: z.enum(['docs', 'admin', 'cli']),
    client_updated_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    is_self: z.boolean(),
  })
  .passthrough()

export const MigrationProgressListSchema = z
  .object({
    progress: z.array(MigrationProgressRowSchema),
    knownGuideSlugs: z.array(z.string()),
  })
  .passthrough()

export type MigrationProgressRow = z.infer<typeof MigrationProgressRowSchema>
