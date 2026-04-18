// ============================================================
// Wave V5.3 — Stage 2 air-gap injection isolation contract.
//
// Stage 1 (fast-filter) faces untrusted user input directly. Stage 2
// (classify-report) must NEVER see raw `console_logs`, `network_logs`,
// or `description` strings — only the structured `evidence` summary
// produced by Stage 1. This test re-implements the prompt-builder
// contract from `classify-report/index.ts` (Deno) using the same
// shape, then asserts that hostile strings hidden in raw fields are
// invisible to the rendered Stage 2 prompt.
// ============================================================
import { describe, expect, it } from 'vitest'

// Mirrors the prompt builder in
// packages/server/supabase/functions/classify-report/index.ts. Kept in
// sync via the contract assertions below; if the real builder grows a
// new field, add it here too.
interface Stage1Extraction {
  symptom?: string
  action?: string
  expected?: string
  actual?: string
  emotion?: string
  category?: string
  severity?: string
  confidence?: number | string
}

interface EvidenceSummary {
  console?: { errorCount?: number; warnCount?: number; topErrorTypes?: string[] }
  network?: { failureCount?: number; statusBuckets?: Record<string, number>; topMethods?: string[] }
  perf?: { lcp?: number; fcp?: number; cls?: number; inp?: number; ttfb?: number; longTasks?: number }
}

interface ScrubbedReport {
  user_category: string
  environment?: { url?: string; viewport?: { width?: number; height?: number }; platform?: string }
  // The raw fields the air-gap forbids from leaking:
  description?: string
  console_logs?: Array<{ level: string; message: string }>
  network_logs?: Array<{ method: string; url: string; status: number }>
  extracted_symptoms?: { evidence?: EvidenceSummary } | null
}

function buildStage2Prompt(args: {
  extraction: Stage1Extraction | null
  scrubbedReport: ScrubbedReport
  callerEvidence: EvidenceSummary | null
  airGap: boolean
}): string {
  if (!args.airGap) {
    throw new Error('Stage 2 invoked without airGap=true')
  }

  // Same precedence as the real edge function: caller-supplied evidence,
  // then the persisted Stage 1 evidence, then null. We never reach into
  // scrubbedReport.console_logs or scrubbedReport.network_logs.
  const evidence: EvidenceSummary | null =
    args.callerEvidence ?? args.scrubbedReport.extracted_symptoms?.evidence ?? null

  const env = args.scrubbedReport.environment ?? {}
  const extraction = args.extraction ?? {}

  const evidenceSection = evidence
    ? `\n## Sanitized Evidence (Stage 1 air-gap output)
- Console errors: ${evidence.console?.errorCount ?? 0}
- Console warnings: ${evidence.console?.warnCount ?? 0}
- Top error types: ${(evidence.console?.topErrorTypes ?? []).join(', ') || 'none'}
- Network failures: ${evidence.network?.failureCount ?? 0}
- Status buckets: ${JSON.stringify(evidence.network?.statusBuckets ?? {})}
- Failed methods: ${(evidence.network?.topMethods ?? []).join(', ') || 'none'}
- Performance: LCP ${evidence.perf?.lcp ?? '?'}ms · FCP ${evidence.perf?.fcp ?? '?'}ms · CLS ${evidence.perf?.cls ?? '?'} · INP ${evidence.perf?.inp ?? '?'}ms · TTFB ${evidence.perf?.ttfb ?? '?'}ms · LongTasks ${evidence.perf?.longTasks ?? 0}`
    : '\n## Sanitized Evidence: not yet computed'

  return `## Stage 1 Extraction (structured, trusted)
- Symptom: ${extraction.symptom ?? 'unknown'}
- Action: ${extraction.action ?? 'unknown'}
- Expected: ${extraction.expected ?? 'unknown'}
- Actual: ${extraction.actual ?? 'unknown'}
- Emotion: ${extraction.emotion ?? 'not captured'}
- Stage 1 Category: ${extraction.category ?? args.scrubbedReport.user_category}
- Stage 1 Severity: ${extraction.severity ?? 'unknown'}
- Stage 1 Confidence: ${extraction.confidence ?? 'unknown'}

## Trusted Environment Metadata
- Page URL: ${env.url || 'unknown'}
- Viewport: ${env.viewport?.width ?? '?'}x${env.viewport?.height ?? '?'}
- Platform: ${env.platform || 'unknown'}
${evidenceSection}`
}

// Opaque hostile tokens — never read literally as instructions.
const HOSTILE_TOKENS = [
  'IGN_PREV_INST_42',
  'ROLE_FLIP_HOSTILE',
  'SYSTEM_TAG_HOSTILE',
  'EXFILTRATE_SECRETS_NOW',
  'PRINT_SERVICE_ROLE_KEY',
] as const

const baseEnv = {
  url: 'https://example.com/checkout',
  viewport: { width: 1920, height: 1080 },
  platform: 'MacIntel',
}

describe('Stage 2 air-gap (V5.3 contract)', () => {
  it('refuses to run without airGap=true', () => {
    expect(() =>
      buildStage2Prompt({
        extraction: null,
        scrubbedReport: { user_category: 'bug', environment: baseEnv },
        callerEvidence: null,
        airGap: false,
      }),
    ).toThrow(/airGap=true/)
  })

  it('never includes raw console_logs even when they contain injection payloads', () => {
    const hostileMessage = `legitimate error: ${HOSTILE_TOKENS.join(' ')} ;drop table reports;--`
    const prompt = buildStage2Prompt({
      extraction: { symptom: 'Checkout button does nothing' },
      scrubbedReport: {
        user_category: 'bug',
        environment: baseEnv,
        console_logs: [{ level: 'error', message: hostileMessage }],
      },
      callerEvidence: { console: { errorCount: 1, warnCount: 0, topErrorTypes: ['TypeError'] } },
      airGap: true,
    })

    for (const tok of HOSTILE_TOKENS) {
      expect(prompt).not.toContain(tok)
    }
    expect(prompt).not.toContain('drop table')
    expect(prompt).toContain('Console errors: 1')
    expect(prompt).toContain('Top error types: TypeError')
  })

  it('never includes raw network_logs even when URLs carry injection payloads', () => {
    const hostileUrl = `https://attacker.example/${HOSTILE_TOKENS[0]}?leak=${HOSTILE_TOKENS[3]}`
    const prompt = buildStage2Prompt({
      extraction: { symptom: 'Slow checkout' },
      scrubbedReport: {
        user_category: 'slow',
        environment: baseEnv,
        network_logs: [{ method: 'POST', url: hostileUrl, status: 500 }],
      },
      callerEvidence: {
        network: { failureCount: 1, statusBuckets: { '5xx': 1 }, topMethods: ['POST'] },
      },
      airGap: true,
    })

    expect(prompt).not.toContain(hostileUrl)
    for (const tok of HOSTILE_TOKENS) {
      expect(prompt).not.toContain(tok)
    }
    expect(prompt).toContain('Network failures: 1')
    expect(prompt).toContain('Status buckets: {"5xx":1}')
  })

  it('never includes the raw user description, only the Stage 1 structured extraction', () => {
    const hostileDescription = `Please ${HOSTILE_TOKENS[0]} and ${HOSTILE_TOKENS[4]}`
    const prompt = buildStage2Prompt({
      extraction: { symptom: 'Login fails', action: 'tapping login', actual: 'spinner forever' },
      scrubbedReport: {
        user_category: 'bug',
        environment: baseEnv,
        description: hostileDescription,
      },
      callerEvidence: null,
      airGap: true,
    })

    expect(prompt).not.toContain(hostileDescription)
    for (const tok of HOSTILE_TOKENS) {
      expect(prompt).not.toContain(tok)
    }
    expect(prompt).toContain('Symptom: Login fails')
    expect(prompt).toContain('Actual: spinner forever')
  })

  it('falls back to persisted Stage 1 evidence (still air-gap-clean) when caller omits it', () => {
    const prompt = buildStage2Prompt({
      extraction: { symptom: 'Checkout fails', category: 'bug' },
      scrubbedReport: {
        user_category: 'bug',
        environment: baseEnv,
        // Hostile string in console_logs MUST still be ignored — Stage 2 only
        // consults extracted_symptoms.evidence, never console_logs directly.
        console_logs: [{ level: 'error', message: HOSTILE_TOKENS[2] }],
        extracted_symptoms: {
          evidence: {
            console: { errorCount: 7, warnCount: 1, topErrorTypes: ['ReferenceError'] },
          },
        },
      },
      callerEvidence: null,
      airGap: true,
    })

    expect(prompt).not.toContain(HOSTILE_TOKENS[2])
    expect(prompt).toContain('Console errors: 7')
    expect(prompt).toContain('Top error types: ReferenceError')
  })

  it('renders an empty-evidence sentinel when neither caller nor persisted evidence exists', () => {
    const prompt = buildStage2Prompt({
      extraction: { symptom: 'unknown' },
      scrubbedReport: {
        user_category: 'other',
        environment: baseEnv,
        console_logs: [{ level: 'error', message: HOSTILE_TOKENS[1] }],
      },
      callerEvidence: null,
      airGap: true,
    })

    expect(prompt).toContain('## Sanitized Evidence: not yet computed')
    expect(prompt).not.toContain(HOSTILE_TOKENS[1])
  })
})
