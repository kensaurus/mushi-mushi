/**
 * FILE: packages/server/supabase/functions/api/routes/schemas.ts
 *
 * GET /v1/schemas/:name — serve hand-authored JSON Schemas for the
 * public agent contracts (FixContext, FixResult, SandboxProvider,
 * ExpectedOutcome).
 *
 * Why this file exists
 * ────────────────────
 * The 2026-05-09 spec-traceability audit flagged that non-TS
 * orchestrators (Python LangGraph, Go agents, A2A skill cards)
 * cannot consume the FixContext / FixResult contracts because
 * they only exist as TS interfaces. The `@mushi-mushi/agents`
 * package now publishes draft-07 JSON Schemas via
 * `AGENT_JSON_SCHEMAS`; this route serves them under a stable
 * URL family (`/v1/schemas/*.json`) so they can be referenced
 * from the agent card and the OpenAPI spec.
 *
 * Why we mirror the schemas inline instead of importing
 * `@mushi-mushi/agents`
 * ─────────────────────────────────────────────────────
 * Edge functions ship a Deno-friendly bundle and we deliberately
 * keep the per-function dependency tree small. Mirroring the
 * three small schemas here costs ~150 lines and zero new bundle
 * weight; importing `@mushi-mushi/agents` would pull in every
 * agent adapter (claude-code, MCP fix agent, sandbox providers)
 * because the package barrel re-exports them all.
 *
 * The mirror is verified by the test in
 * `packages/agents/src/schemas.test.ts` which deep-compares the
 * served payload to `AGENT_JSON_SCHEMAS`.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/schema+json; charset=utf-8',
  'Cache-Control': 'public, max-age=300, s-maxage=300',
  'Access-Control-Allow-Origin': '*',
}

const EXPECTED_OUTCOME_JSON_SCHEMA = {
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
}

const FIX_CONTEXT_JSON_SCHEMA = {
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
}

const FIX_RESULT_JSON_SCHEMA = {
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
}

const SANDBOX_PROVIDER_JSON_SCHEMA = {
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
      examples: ['e2b', 'modal', 'cloudflare', 'local-noop'],
    },
  },
}

const SCHEMAS: Record<string, unknown> = {
  'fix-context.json': FIX_CONTEXT_JSON_SCHEMA,
  'fix-result.json': FIX_RESULT_JSON_SCHEMA,
  'sandbox-provider.json': SANDBOX_PROVIDER_JSON_SCHEMA,
  'expected-outcome.json': EXPECTED_OUTCOME_JSON_SCHEMA,
}

export function registerSchemaRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/schemas', (c) => {
    const url = new URL(c.req.raw.url)
    const base = `${url.protocol}//${url.host}/functions/v1/api/v1/schemas`
    return c.json(
      {
        schemas: Object.keys(SCHEMAS).map((name) => ({
          name,
          url: `${base}/${name}`,
          $id: (SCHEMAS[name] as { $id?: string }).$id,
        })),
      },
      200,
      { 'Access-Control-Allow-Origin': '*' },
    )
  })

  app.get('/v1/schemas/:name', (c) => {
    const name = c.req.param('name')
    const schema = SCHEMAS[name]
    if (!schema) {
      return c.json(
        {
          error: {
            code: 'SCHEMA_NOT_FOUND',
            message: `No schema named "${name}". Known: ${Object.keys(SCHEMAS).join(', ')}`,
          },
        },
        404,
      )
    }
    return new Response(JSON.stringify(schema, null, 2), { status: 200, headers: HEADERS })
  })
}
