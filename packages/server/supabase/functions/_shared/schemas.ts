import { z } from 'npm:zod@3'

// ---------------------------------------------------------------------------
// Reporter identity (data contract)
//
// The host app supplies the signed-in user via `Mushi.identify()`. Two wire
// shapes exist in the wild and BOTH must resolve to the same end_user so a
// real user never shows as an anonymous token hash on the report detail page:
//   - Nested (web SDK, RN >= 0.17): metadata.user = { id, email, name, provider }
//   - Flat   (RN <= 0.16):          metadata.userId / userEmail / userName / userProvider
// This schema documents the canonical nested shape; `resolveReporterIdentity()`
// in api/helpers.ts reads either shape (plus Sentry scope) defensively.
// `metadata` itself stays a loose record so unknown keys pass through to the
// jsonb column intact — this is documentation + a reusable validator, not a
// gate that would reject extra metadata.
// ---------------------------------------------------------------------------
export const reporterIdentitySchema = z.object({
  id: z.string().max(512),
  email: z.string().max(320).optional(),
  name: z.string().max(120).optional(),
  provider: z.string().max(40).optional(),
})

export type ReporterIdentity = z.infer<typeof reporterIdentitySchema>

// ---------------------------------------------------------------------------
// Report submission (from SDK)
// ---------------------------------------------------------------------------
export const reportSubmissionSchema = z.object({
  id: z.string().optional(),
  projectId: z.string(),
  category: z.enum(['bug', 'slow', 'visual', 'confusing', 'other']),
  /**
   * Custom category id set by the host app when `widget.categories` is
   * configured. Stored as `reports.user_category` so the console can
   * filter by it independently of the LLM-assigned `category`.
   */
  userCategory: z.string().max(128).optional(),
  description: z.string().min(20, 'Description must be at least 20 characters').max(5000),
  // Lenient: numbers/booleans coerce to text, but null means "not given";
  // z.coerce alone would store the literal string 'null'.
  userIntent: z.preprocess((v) => (v == null ? undefined : v), z.coerce.string().optional()),

  // `passthrough()` lets the SDK ship richer environment fields (the
  // 2026-05-07 boost added screen / userAgentData / prefersColorScheme /
  // pageLoadTiming etc.) without us having to ship matching server
  // schema bumps in lockstep — the columns are jsonb so extra keys land
  // intact in `reports.environment`. The required fields below stay
  // strictly typed; only *unknown* keys pass through.
  environment: z.object({
    userAgent: z.string(),
    platform: z.string(),
    language: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
    url: z.string(),
    referrer: z.string(),
    timestamp: z.string(),
    timezone: z.string(),
    connection: z.object({
      effectiveType: z.string().optional(),
      downlink: z.number().optional(),
      rtt: z.number().optional(),
    }).optional(),
    deviceMemory: z.number().optional(),
    hardwareConcurrency: z.number().optional(),
    // v2 inventory hints (whitepaper §4.7) — both optional for back-compat
    // with older SDKs. The Triage LLM v2 prompt grounds against these to
    // map a freeform report to an Action node in the bidirectional graph.
    route: z.string().max(500).optional(),
    nearestTestid: z.string().max(120).optional(),
  }).passthrough(),

  consoleLogs: z.array(z.object({
    level: z.enum(['log', 'warn', 'error', 'info', 'debug']),
    message: z.string(),
    timestamp: z.number(),
    stack: z.string().optional(),
  })).optional(),

  networkLogs: z.array(z.object({
    method: z.string(),
    url: z.string(),
    status: z.number(),
    duration: z.number(),
    timestamp: z.number(),
    error: z.string().optional(),
  })).optional(),

  performanceMetrics: z.object({
    fcp: z.number().optional(),
    lcp: z.number().optional(),
    cls: z.number().optional(),
    fid: z.number().optional(),
    inp: z.number().optional(),
    ttfb: z.number().optional(),
    longTasks: z.number().optional(),
  }).optional(),
  timeline: z.array(z.object({
    ts: z.number(),
    kind: z.enum(['route', 'click', 'request', 'log', 'screen']),
    payload: z.record(z.unknown()),
  })).optional(),

  screenshotDataUrl: z
    .string()
    .max(2_100_000, 'Screenshot data URL exceeds maximum size (~1.5 MB decoded)')
    .optional(),
  selectedElement: z.any().optional(),
  /** rrweb / lite rolling-buffer events (compressed server-side). */
  replayEvents: z.array(z.record(z.unknown())).max(500).optional(),
  /**
   * Free-form host metadata. Reporter identity rides here under either
   * `user` (nested — see {@link reporterIdentitySchema}) or the flat
   * `userId`/`userEmail`/`userName`/`userProvider` keys; both are read by
   * `resolveReporterIdentity()`. Kept loose so other host keys pass through.
   */
  metadata: z.record(z.unknown()).optional(),

  sessionId: z.string().optional(),
  reporterToken: z.string(),
  /**
   * §3c: SDK-supplied SHA-256 hex of stable device characteristics.
   * Optional for back-compat with older SDK versions; when present we feed
   * it into the anti-gaming cross-account check.
   */
  fingerprintHash: z.string().regex(/^[a-f0-9]{64}$|^fbk_[a-f0-9]{8}$/).optional(),
  appVersion: z.string().optional(),
  sdkPackage: z.string().max(120).optional(),
  sdkVersion: z.string().max(40).optional(),
  proactiveTrigger: z.string().optional(),

  /**
   * Mushi-side breadcrumb ring buffer (max 50 entries on the SDK side).
   * Server caps to 100 to bound jsonb size in the unlikely event a
   * forked SDK ships with a larger buffer. We deliberately keep this
   * loose-typed (`record(unknown)` for `data`) — the field is read by
   * the admin /reports drawer and the Triage LLM, both of which
   * tolerate arbitrary structured data.
   */
  breadcrumbs: z.array(z.object({
    timestamp: z.number(),
    category: z.enum([
      'navigation',
      'ui.click',
      'ui.tap',
      'console',
      'xhr',
      'fetch',
      'network',
      'lifecycle',
      'custom',
    ]),
    level: z.enum(['debug', 'info', 'warning', 'error']),
    message: z.string().max(2000),
    data: z.record(z.unknown()).optional(),
  })).max(100).optional(),

  /**
   * Sticky tags from `Mushi.setTag()` / `Mushi.setTags()`. Hard-cap on
   * count + value length so a runaway host can't blow up our jsonb
   * column with a megabyte of tag debris.
   */
  tags: z.record(z.union([z.string().max(500), z.number(), z.boolean()]))
    .refine((t) => Object.keys(t).length <= 64, {
      message: 'tags: at most 64 keys allowed',
    })
    .optional(),

  /**
   * Rich Sentry context — parallel to `sentryEventId`/`sentryReplayId`
   * which we keep for back-compat with older SDKs. Every nested field
   * is optional so a partial Sentry capture (different point releases
   * of the host's Sentry SDK can expose different APIs) lands cleanly.
   */
  sentryContext: z.object({
    sdk: z.enum(['v7', 'v8', 'v9', 'unknown']).optional(),
    eventId: z.string().max(80).optional(),
    replayId: z.string().max(80).optional(),
    traceId: z.string().max(80).optional(),
    spanId: z.string().max(40).optional(),
    transactionName: z.string().max(500).optional(),
    release: z.string().max(200).optional(),
    environment: z.string().max(80).optional(),
    sessionId: z.string().max(80).optional(),
    user: z.object({
      id: z.string().max(200).optional(),
      email: z.string().max(320).optional(),
      username: z.string().max(200).optional(),
      ip_address: z.string().max(80).optional(),
    }).optional(),
    tags: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    breadcrumbs: z.array(z.object({
      timestamp: z.number().optional(),
      category: z.string().optional(),
      level: z.string().optional(),
      message: z.string().optional(),
      type: z.string().optional(),
      data: z.record(z.unknown()).optional(),
    })).max(100).optional(),
    issueUrl: z.string().max(2000).optional(),
  }).optional(),

  /** @deprecated — covered by `sentryContext.eventId`. Kept for back-compat. */
  sentryEventId: z.string().max(80).optional(),
  /** @deprecated — covered by `sentryContext.replayId`. Kept for back-compat. */
  sentryReplayId: z.string().max(80).optional(),

  queuedAt: z.string().optional(),
  createdAt: z.string(),
})

export type ReportSubmission = z.infer<typeof reportSubmissionSchema>

// ---------------------------------------------------------------------------
// LLM Classification output (structured output from Sonnet)
// ---------------------------------------------------------------------------
export const classificationSchema = z.object({
  category: z.enum(['bug', 'slow', 'visual', 'confusing', 'other'])
    .describe('The primary bug category'),
  severity: z.enum(['critical', 'high', 'medium', 'low'])
    .describe('Impact severity based on user description and technical context'),
  summary: z.string().max(200)
    .describe('Concise one-line summary of the issue for developers'),
  component: z.string().optional()
    .describe('Affected UI component or page area, if identifiable'),
  reproductionHint: z.string().optional()
    .describe('Suggested reproduction steps based on the report context'),
  confidence: z.number().min(0).max(1)
    .describe('Classification confidence score'),
})

export type Classification = z.infer<typeof classificationSchema>

// ---------------------------------------------------------------------------
// Vision analysis (V5.3 air-gap): image-only output schema. The fields
// `visible_text_in_image` and `untrusted_image_instructions_detected` are the
// trust boundary — text seen in screenshots is captured here as DATA and
// never as instruction.
// ---------------------------------------------------------------------------
export const visionAnalysisSchema = z.object({
  visual_issues: z.array(z.string()),
  ui_state: z.string(),
  matches_description: z.boolean(),
  visible_text_in_image: z.array(z.string()),
  untrusted_image_instructions_detected: z.boolean(),
  additional_context: z.string().optional(),
})

export type VisionAnalysis = z.infer<typeof visionAnalysisSchema>

// ---------------------------------------------------------------------------
// SDK passive inventory discovery event (whitepaper §4.7, v2.1+)
//
// Each event is one observation of a route the SDK saw a real user visit.
// The schema is deliberately tight — every field is bounded so a misbehaving
// client can't fill the discovery_events table with kilobytes of payload, and
// the route is normalised on the way in so dynamic-id paths cluster cleanly
// in the proposer's view.
//
// Lifted from inline validation in routes/public.ts so it can be unit-tested
// against malformed inputs without spinning up Hono.
// ---------------------------------------------------------------------------
const SHA256_HEX = /^[0-9a-f]{64}$/

export const discoveryEventSchema = z
  .object({
    route: z
      .string()
      .min(1, 'route required')
      .max(400, 'route ≤ 400 chars')
      .startsWith('/', 'route must start with /'),
    page_title: z.string().max(300).nullish().transform((v) => v ?? null),
    dom_summary: z.string().max(240).nullish().transform((v) => v ?? null),
    testids: z
      .array(z.string().min(1).max(120))
      .max(200)
      .optional()
      .transform((v) => v ?? []),
    network_paths: z
      .array(z.string().min(1).max(200))
      .max(200)
      .optional()
      .transform((v) => v ?? []),
    query_param_keys: z
      .array(z.string().min(1).max(80))
      .max(50)
      .optional()
      .transform((v) => v ?? []),
    // SHA-256 hex of a stable user identifier, computed by the SDK so the
    // server never sees the raw value. Optional — older SDK builds and
    // logged-out flows don't supply one.
    user_id_hash: z
      .string()
      .regex(SHA256_HEX, 'user_id_hash must be a 64-char SHA-256 hex')
      .nullish()
      .transform((v) => v ?? null),
    sdk_version: z.string().max(40).nullish().transform((v) => v ?? null),
  })
  .transform((event) => ({
    ...event,
    // Defence in depth: drop ?query and #fragment even if the client kept
    // them. Done here (after parse) so callers always get a clean route.
    route: event.route.replace(/[?#].*$/, ''),
  }))

export type DiscoveryEventPayload = z.infer<typeof discoveryEventSchema>

// ---------------------------------------------------------------------------
// Code-health CI ingest (POST /v1/ingest/metrics)
// ---------------------------------------------------------------------------

// Allowed metric-name prefixes — any name that doesn't start with one of
// these is rejected to prevent accidentally polluting metric_series with
// arbitrary CI environment variables.
const METRIC_NAME_PREFIXES = ['bundle.', 'code_health.'] as const

const metricPointSchema = z.object({
  /** Dot-namespaced metric name, e.g. "bundle.mobile.gzip_kb" */
  metric_name: z
    .string()
    .min(1)
    .max(120)
    .refine(
      (v) => METRIC_NAME_PREFIXES.some((p) => v.startsWith(p)),
      { message: 'metric_name must start with one of: bundle. code_health.' },
    ),
  /** Optional sub-dimension, e.g. "ios", "android", "combined", "mobile", "web" */
  dimension: z.string().max(60).optional(),
  /** Numeric metric value (gzipped KB, LOC count, file count, …) */
  value: z
    .number()
    .finite()
    .nonnegative(),
  /** ISO-8601 timestamp. Defaults to server time when omitted. */
  ts: z.string().datetime({ offset: true }).optional(),
})

export const codeHealthFindingSchema = z.object({
  /** Rule identifier: 'god_file' | 'bundle_regression' */
  rule_id: z.string().min(1).max(80),
  severity: z.enum(['error', 'warn', 'info']),
  /** Repo-relative file path (for god_file findings) */
  file_path: z.string().max(500).optional(),
  /** Reused as a numeric carrier: LOC count for god_file, delta KB for bundle_regression */
  line: z.number().int().nonnegative().optional(),
  message: z.string().max(500),
  /** JSONB bag: e.g. { hint, budget } for god_file or { delta_kb, budget_kb } */
  suggested_fix: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
})

export const codeHealthIngestSchema = z
  .object({
    metrics: z.array(metricPointSchema).max(50).optional(),
    findings: z.array(codeHealthFindingSchema).max(200).optional(),
  })
  // Reject unknown top-level keys so unexpected CI payload fields are not
  // silently stripped and persisted. Returns 400 with a clear parse error.
  .strict()
  .refine(
    (body) => (body.metrics?.length ?? 0) + (body.findings?.length ?? 0) > 0,
    { message: 'Provide at least one metric or one finding' },
  )

// ---------------------------------------------------------------------------
// POST /v1/ingest/runner (Plan 022 Phase 3): `mushi runner heartbeat` and the
// runner job hooks. Strict: unknown keys are rejected, so nothing beyond
// these numbers (no file contents, environment values or raw machine ids)
// can ride along. host_id is the sha256 of the machine id, hashed on the
// machine: 64 lowercase hex. A raw /etc/machine-id (32 hex) or a hostname
// is refused.
// ---------------------------------------------------------------------------
const runnerHostIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'host_id must be the sha256 (64 lowercase hex) of the machine id, hashed on the machine; never the raw id')
const runnerRepoSchema = z.string().max(200).regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'repo must be owner/name')
const runnerNameSchema = z.string().min(1).max(200)
const megabytes = z.number().int().min(0).max(16_777_216)

export const runnerHeartbeatSchema = z
  .object({
    kind: z.literal('heartbeat'),
    host: z
      .object({
        host_id: runnerHostIdSchema,
        hostname: z.string().min(1).max(80),
        platform: z.enum(['linux', 'wsl2', 'macos', 'windows']),
        cpu_count: z.number().int().min(1).max(4096).nullable().optional(),
        mem_total_mb: megabytes.nullable().optional(),
        mushi_version: z.string().max(40).nullable().optional(),
        metrics: z
          .object({
            load1: z.number().min(0).max(100_000).optional(),
            mem_used_mb: megabytes.optional(),
            swap_used_mb: megabytes.optional(),
            swap_total_mb: megabytes.optional(),
            disk_free_gb: z.number().min(0).max(1_000_000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    runners: z
      .array(
        z
          .object({
            name: runnerNameSchema,
            repo: runnerRepoSchema.nullable().optional(),
            service: z.string().max(200).nullable().optional(),
            active: z.boolean(),
            restarts: z.number().int().min(0).max(1_000_000).nullable().optional(),
            mem_current_mb: megabytes.nullable().optional(),
            mem_max_mb: megabytes.nullable().optional(),
            oom_kills: z.number().int().min(0).max(1_000_000).nullable().optional(),
          })
          .strict(),
      )
      .max(40, 'At most 40 runners per host'),
  })
  .strict()

export const runnerJobSampleSchema = z
  .object({
    kind: z.literal('job'),
    host_id: runnerHostIdSchema,
    runner_name: runnerNameSchema,
    repo: runnerRepoSchema,
    run_id: z.number().int().positive(),
    run_attempt: z.number().int().min(1).max(1000),
    job_key: z.string().min(1).max(200),
    phase: z.enum(['started', 'completed']),
    at: z.string().datetime({ offset: true }),
    mem_peak_mb: megabytes.nullable().optional(),
    mem_max_mb: megabytes.nullable().optional(),
    oom_kills: z.number().int().min(0).max(1_000_000).nullable().optional(),
    swap_used_mb: megabytes.nullable().optional(),
    load1: z.number().min(0).max(100_000).nullable().optional(),
  })
  .strict()

export const runnerIngestSchema = z.discriminatedUnion('kind', [runnerHeartbeatSchema, runnerJobSampleSchema])

export type RunnerIngestPayload = z.infer<typeof runnerIngestSchema>

export type CodeHealthIngestPayload = z.infer<typeof codeHealthIngestSchema>
export type MetricPoint = z.infer<typeof metricPointSchema>
export type CodeHealthFinding = z.infer<typeof codeHealthFindingSchema>

