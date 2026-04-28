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
