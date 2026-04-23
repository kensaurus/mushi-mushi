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
export const SetupStepIdSchema = z.enum([
  'project_created',
  'api_key_generated',
  'sdk_installed',
  'first_report_received',
  'github_connected',
  'sentry_connected',
  'byok_anthropic',
  'first_fix_dispatched',
])
export const SetupStepSchema = z
  .object({
    id: SetupStepIdSchema,
    label: z.string(),
    description: z.string(),
    complete: z.boolean(),
    required: z.boolean(),
    cta_to: z.string(),
    cta_label: z.string(),
  })
  .passthrough()
export const SetupProjectSchema = z
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
  })
  .passthrough()
export const SetupResponseSchema = z
  .object({
    has_any_project: z.boolean(),
    projects: z.array(SetupProjectSchema),
  })
  .passthrough()
export type SetupResponse = z.infer<typeof SetupResponseSchema>

// ─── /v1/admin/dashboard ────────────────────────────────────────────────────
export const DashboardSummarySchema = z
  .object({
    total_reports: z.number().int().nonnegative(),
    reports_this_week: z.number().int().nonnegative(),
    pending_reports: z.number().int().nonnegative(),
    classified_reports: z.number().int().nonnegative(),
    avg_judge_score: z.number().nullable().optional(),
    recent: z
      .array(
        z
          .object({
            id: z.string(),
            summary: z.string().nullable().optional(),
            status: z.string(),
            created_at: z.string(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough()
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>

// ─── /v1/admin/projects ─────────────────────────────────────────────────────
export const ProjectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    created_at: z.string(),
    // Optional free-text or null — backend writes null for unset, old backends
    // sometimes omit the key entirely.
    description: z.string().nullable().optional(),
    reporter_count: z.number().int().nonnegative().optional(),
    report_count: z.number().int().nonnegative().optional(),
  })
  .passthrough()
export const ProjectListSchema = z.object({ projects: z.array(ProjectSchema) }).passthrough()
export type Project = z.infer<typeof ProjectSchema>

// ─── /v1/admin/reports (list) ───────────────────────────────────────────────
export const ReportListItemSchema = z
  .object({
    id: z.string().uuid(),
    project_id: z.string().uuid(),
    status: z.string(),
    category: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    created_at: z.string(),
    judge_score: z.number().nullable().optional(),
  })
  .passthrough()
export const ReportListSchema = z
  .object({
    reports: z.array(ReportListItemSchema),
    total: z.number().int().nonnegative().optional(),
    cursor: z.string().nullable().optional(),
  })
  .passthrough()

// ─── /v1/admin/reports/:id ──────────────────────────────────────────────────
export const ReportDetailSchema = ReportListItemSchema.and(
  z
    .object({
      reproduction_steps: z.array(z.any()).nullable().optional(),
      stage1_classification: z.any().optional(),
      stage2_analysis: z.any().optional(),
      llm_invocations: z.array(z.any()).optional(),
      fix_attempts: z.array(z.any()).optional(),
    })
    .passthrough(),
)

// ─── /v1/admin/queue ────────────────────────────────────────────────────────
export const QueueSnapshotSchema = z
  .object({
    pending: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    dlq: z.number().int().nonnegative(),
    items: z.array(z.any()).default([]),
  })
  .passthrough()

// ─── /v1/admin/health ───────────────────────────────────────────────────────
export const HealthSnapshotSchema = z
  .object({
    sdk: z.object({ status: z.string() }).passthrough().optional(),
    api: z.object({ status: z.string() }).passthrough().optional(),
    db: z.object({ status: z.string() }).passthrough().optional(),
    llm: z
      .object({
        status: z.string(),
        total_cost_usd_7d: z.number().optional(),
      })
      .passthrough()
      .optional(),
    updated_at: z.string().optional(),
  })
  .passthrough()

// ─── /v1/admin/billing ──────────────────────────────────────────────────────
export const BillingSummarySchema = z
  .object({
    month_cost_usd: z.number(),
    report_count: z.number().int().nonnegative(),
    per_project: z
      .array(
        z
          .object({
            project_id: z.string().uuid(),
            project_name: z.string(),
            cost_usd: z.number(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough()

// ─── /v1/admin/judge ────────────────────────────────────────────────────────
export const JudgeSummarySchema = z
  .object({
    avg_score: z.number().nullable().optional(),
    disagreement_rate: z.number().nullable().optional(),
    primary_failure_rate: z.number().nullable().optional(),
    evaluations_7d: z.number().int().nonnegative().optional(),
  })
  .passthrough()

// ─── /v1/admin/settings ─────────────────────────────────────────────────────
export const SettingsSchema = z
  .object({
    project_id: z.string().uuid(),
    stage2_model: z.string().optional(),
    judge_model: z.string().optional(),
    judge_enabled: z.boolean().optional(),
    stage1_confidence_threshold: z.number().min(0).max(1).optional(),
  })
  .passthrough()

// ─── /v1/admin/notifications ────────────────────────────────────────────────
export const NotificationListSchema = z
  .object({
    notifications: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          body: z.string().optional(),
          created_at: z.string(),
          read: z.boolean().optional(),
        })
        .passthrough(),
    ),
    unread_count: z.number().int().nonnegative().optional(),
  })
  .passthrough()

// ─── /v1/admin/chart-events ──────────────────────────────────────────────────
// Wave T.5.8a chart-annotation feed. Three event kinds unioned into one
// shape so the overlay can render dots regardless of source. The UI
// treats any unknown kind as a no-op decoration; schema passthrough keeps
// the server free to extend later (e.g. `incident`, `runbook`).
export const ChartEventKindSchema = z.enum(['deploy', 'cron', 'byok'])

export const ChartEventSchema = z
  .object({
    occurred_at: z.string(),
    kind: ChartEventKindSchema,
    label: z.string(),
    href: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
  })
  .passthrough()

export const ChartEventsResponseSchema = z
  .object({
    events: z.array(ChartEventSchema),
  })
  .passthrough()

export type ChartEvent = z.infer<typeof ChartEventSchema>
export type ChartEventKind = z.infer<typeof ChartEventKindSchema>
