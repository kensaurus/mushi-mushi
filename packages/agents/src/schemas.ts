/**
 * FILE: packages/agents/src/schemas.ts
 *
 * Hand-authored JSON Schema (draft-07) companions for the public TS
 * contracts in this package: FixContext, FixResult, SandboxProvider.
 *
 * Why hand-authored
 * ─────────────────
 * Same posture as `@mushi-mushi/inventory-schema/json-schema.ts` — the
 * runtime SoT is the TS interface, this companion exists so non-TS
 * orchestrators (Python LangGraph nodes, Go agents wrapping `dispatch_fix`,
 * A2A skill cards, OpenAI Agents SDK adapters) can validate / generate
 * code without depending on the TS toolchain.
 *
 * The `agents` package round-trip test (`schemas.test.ts`) keeps these
 * in sync with the TS types by feeding a real value through and
 * asserting the JSON Schema accepts it.
 *
 * Served at runtime by the api function under `/v1/schemas/*` — see
 * `packages/server/supabase/functions/api/routes/schemas.ts`.
 */

export const EXPECTED_OUTCOME_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://mushimushi.dev/schemas/expected-outcome-2.0.json',
  title: 'Mushi Mushi Expected Outcome (whitepaper §2.10)',
  type: 'object',
  description:
    'Machine-readable success contract for an inventory Action. Threaded into the fix-worker LLM prompt and asserted by the synthetic monitor after every probe.',
  properties: {
    summary: { type: 'string', maxLength: 400 },
    response: {
      type: 'object',
      properties: {
        status_in: { type: 'array', items: { type: 'integer', minimum: 100, maximum: 599 } },
        json_path: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'op'],
            properties: {
              path: { type: 'string', maxLength: 200 },
              op: {
                type: 'string',
                enum: ['exists', 'equals', 'not_equals', 'contains', 'gt', 'gte', 'lt', 'lte', 'matches'],
              },
              value: {},
            },
          },
        },
      },
    },
    database: {
      type: 'object',
      required: ['table'],
      properties: {
        table: { type: 'string', maxLength: 120 },
        schema: { type: 'string', maxLength: 80 },
        where: { type: 'object' },
        expect: { type: 'string', enum: ['row_exists', 'row_absent', 'row_count_at_least'] },
        min_count: { type: 'integer', minimum: 1 },
      },
    },
    ui: {
      type: 'object',
      properties: {
        visible_text: { type: 'string', maxLength: 400 },
        route_change_to: { type: 'string', maxLength: 200 },
      },
    },
    extensions: { type: 'object' },
  },
} as const

export const FIX_CONTEXT_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://mushimushi.dev/schemas/fix-context-2.0.json',
  title: 'Mushi Mushi FixContext',
  type: 'object',
  required: ['reportId', 'projectId', 'report', 'reproductionSteps', 'relevantCode', 'config'],
  properties: {
    reportId: { type: 'string', format: 'uuid' },
    projectId: { type: 'string', format: 'uuid' },
    report: {
      type: 'object',
      required: ['description', 'category', 'severity'],
      properties: {
        description: { type: 'string' },
        category: { type: 'string' },
        severity: { type: 'string' },
        summary: { type: 'string' },
        component: { type: 'string' },
        rootCause: { type: 'string' },
        bugOntologyTags: { type: 'array', items: { type: 'string' } },
      },
    },
    reproductionSteps: { type: 'array', items: { type: 'string' } },
    relevantCode: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          componentTag: { type: 'string' },
        },
      },
    },
    sentryAnalysis: {
      type: 'object',
      properties: {
        issueUrl: { type: 'string', format: 'uri' },
        rootCause: { type: 'string' },
      },
    },
    graphContext: {
      type: 'object',
      properties: {
        relatedBugs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'summary', 'status'],
            properties: {
              id: { type: 'string' },
              summary: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
        blastRadius: {
          type: 'array',
          items: {
            type: 'object',
            required: ['nodeType', 'label'],
            properties: {
              nodeType: { type: 'string' },
              label: { type: 'string' },
            },
          },
        },
      },
    },
    inventoryAction: {
      type: 'object',
      description:
        'Spec-traceability anchor recovered from the reports_against graph edge. Whitepaper §2.10.',
      required: ['actionNodeId', 'actionLabel'],
      properties: {
        actionNodeId: { type: 'string', format: 'uuid' },
        actionLabel: { type: 'string' },
        actionDescription: { type: 'string' },
        pagePath: { type: 'string' },
        pageId: { type: 'string' },
        storyId: { type: 'string' },
        storyTitle: { type: 'string' },
        expectedOutcome: { $ref: 'https://mushimushi.dev/schemas/expected-outcome-2.0.json' },
      },
    },
    config: {
      type: 'object',
      required: ['maxLines', 'scopeRestriction', 'repoUrl'],
      properties: {
        maxLines: { type: 'integer', minimum: 1 },
        scopeRestriction: { type: 'string', enum: ['component', 'directory', 'none'] },
        repoUrl: { type: 'string' },
      },
    },
  },
} as const

export const FIX_RESULT_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://mushimushi.dev/schemas/fix-result-2.0.json',
  title: 'Mushi Mushi FixResult',
  type: 'object',
  required: ['success', 'branch', 'filesChanged', 'linesChanged', 'summary'],
  properties: {
    success: { type: 'boolean' },
    branch: { type: 'string' },
    prUrl: { type: 'string', format: 'uri' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    linesChanged: { type: 'integer', minimum: 0 },
    summary: { type: 'string' },
    error: { type: 'string' },
  },
} as const

export const SANDBOX_PROVIDER_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://mushimushi.dev/schemas/sandbox-provider-2.0.json',
  title: 'Mushi Mushi SandboxProvider contract',
  description:
    'A pluggable sandbox provider — first-party Mushi ships e2b / modal / cloudflare / local-noop; third parties may register any string id via @mushi-mushi/agents#registerSandboxProvider.',
  type: 'object',
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      // First-party providers + open-ended for third-party. We intentionally
      // do NOT pin an `enum` here — that's the whole point of the
      // 2026-05-09 audit.
      examples: ['e2b', 'modal', 'cloudflare', 'local-noop'],
    },
  },
} as const

/**
 * Convenience map for the /v1/schemas/* endpoint to serve all three
 * schemas under a single route file. Keys MUST match the URL slug
 * (`fix-context.json`, `fix-result.json`, `sandbox-provider.json`,
 * `expected-outcome.json`).
 */
export const AGENT_JSON_SCHEMAS = {
  'fix-context.json': FIX_CONTEXT_JSON_SCHEMA,
  'fix-result.json': FIX_RESULT_JSON_SCHEMA,
  'sandbox-provider.json': SANDBOX_PROVIDER_JSON_SCHEMA,
  'expected-outcome.json': EXPECTED_OUTCOME_JSON_SCHEMA,
} as const
