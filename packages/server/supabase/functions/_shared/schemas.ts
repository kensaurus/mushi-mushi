import { z } from 'npm:zod@3'

// ---------------------------------------------------------------------------
// Report submission (from SDK)
// ---------------------------------------------------------------------------
export const reportSubmissionSchema = z.object({
  id: z.string().optional(),
  projectId: z.string(),
  category: z.enum(['bug', 'slow', 'visual', 'confusing', 'other']),
  description: z.string().min(20, 'Description must be at least 20 characters').max(5000),
  userIntent: z.string().optional(),

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
  }),

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

  screenshotDataUrl: z.string().optional(),
  selectedElement: z.any().optional(),
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
