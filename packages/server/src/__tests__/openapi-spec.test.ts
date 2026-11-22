/**
 * FILE: packages/server/src/__tests__/openapi-spec.test.ts
 * PURPOSE: The public OpenAPI document (/openapi.json) must describe the
 *          SDK-less ingest surface an integrator needs, and its report schema
 *          must stay in step with the two Zod validators POST /v1/reports runs
 *          (ApiReportBodySchema, then reportSubmissionSchema inside
 *          ingestReport). Until 2026-11-18 the spec had 34 paths and no
 *          POST /v1/reports at all.
 *
 *          Behavioural, not regex: the route is mounted on a real Hono app
 *          and the served JSON is inspected.
 */

import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { registerOpenApiRoute, REPORT_REQUEST_EXAMPLE } from '../../supabase/functions/api/routes/openapi.ts'
import { reportSubmissionSchema } from '../../supabase/functions/_shared/schemas.ts'
import { ApiReportBodySchema } from '../../supabase/functions/_shared/validate.ts'
import { normalizeReportCategory, REPORT_CATEGORY_UNION } from '../../supabase/functions/_shared/report-category.ts'

type Json = Record<string, any>

async function fetchSpec(path = '/openapi.json'): Promise<Json> {
  const app = new Hono()
  registerOpenApiRoute(app as never)
  const res = await app.request(path)
  expect(res.status).toBe(200)
  return (await res.json()) as Json
}

/** Keys of a Zod object shape that are not optional. */
function requiredKeys(shape: Record<string, { isOptional(): boolean }>): string[] {
  return Object.entries(shape)
    .filter(([, s]) => !s.isOptional())
    .map(([k]) => k)
    .sort()
}

/** Resolve a local `#/components/...` $ref against the spec. */
function resolveRef(spec: Json, ref: string): Json {
  expect(ref.startsWith('#/')).toBe(true)
  return ref
    .slice(2)
    .split('/')
    .reduce<Json>((node, key) => {
      expect(node[key], `dangling $ref ${ref}`).toBeDefined()
      return node[key]
    }, spec)
}

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v)
      else collectRefs(v, out)
    }
  }
  return out
}

describe('OpenAPI spec: SDK-less ingest', () => {
  it('is OpenAPI 3.1 and serves the same document at /v1/openapi.json', async () => {
    const spec = await fetchSpec()
    expect(spec.openapi).toBe('3.1.0')
    expect(await fetchSpec('/v1/openapi.json')).toEqual(spec)
  })

  it('documents every public ingest and API-key read route an integrator needs', async () => {
    const { paths } = await fetchSpec()
    const expected: Array<[string, string]> = [
      ['/v1/reports', 'post'],
      ['/v1/reports/batch', 'post'],
      ['/v1/reports/{id}/status', 'get'],
      ['/v1/reports/by-trace', 'get'],
      ['/v1/ingest/spans', 'post'],
      ['/v1/ingest/metrics', 'post'],
      ['/v1/ingest/runner', 'post'],
      ['/v1/sdk/config', 'get'],
      ['/v1/health', 'get'],
      ['/v1/sync/whoami', 'get'],
      ['/v1/sync/ingest-setup', 'get'],
      ['/v1/sync/stats', 'get'],
      ['/v1/sync/reports', 'get'],
      ['/v1/sync/reports/{id}', 'get'],
      ['/v1/sync/reports/{id}/timeline', 'get'],
      ['/v1/sync/reports/{id}/reply', 'post'],
      ['/v1/sync/lessons', 'get'],
      ['/v1/sync/lessons/{id}', 'get'],
      ['/v1/sync/two-way-health', 'get'],
    ]
    for (const [path, method] of expected) {
      expect(paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined()
    }
  })

  it('puts ingest and sync routes behind the API key only, with the right scope', async () => {
    const { paths } = await fetchSpec()
    for (const [path, ops] of Object.entries<Json>(paths)) {
      if (!path.startsWith('/v1/reports') && !path.startsWith('/v1/ingest/') && !path.startsWith('/v1/sync/') && path !== '/v1/sdk/config') continue
      for (const op of Object.values<Json>(ops)) {
        expect(op.security, path).toBeDefined()
        expect(op.security.every((s: Json) => 'mushiApiKey' in s), `${path} must not accept a console JWT`).toBe(true)
      }
    }
    expect(paths['/v1/reports'].post.security).toEqual([{ mushiApiKey: ['report:write'] }])
    expect(paths['/v1/sync/reports'].get.security).toEqual([{ mushiApiKey: ['mcp:read'] }])
    expect(paths['/v1/sync/reports/{id}/reply'].post.security).toEqual([{ mushiApiKey: ['mcp:write'] }])
    expect(paths['/v1/health'].get.security).toEqual([])
  })

  it('gives every rate-limited and quota response a Retry-After header', async () => {
    const spec = await fetchSpec()
    for (const [path, ops] of Object.entries<Json>(spec.paths)) {
      if (!path.startsWith('/v1/reports') && !path.startsWith('/v1/ingest/spans') && !path.startsWith('/v1/ingest/metrics')) continue
      for (const op of Object.values<Json>(ops)) {
        for (const code of ['429', '402']) {
          const raw = op.responses?.[code]
          if (!raw) continue
          const res = raw.$ref ? resolveRef(spec, raw.$ref) : raw
          expect(res.headers?.['Retry-After'], `${code} on ${path}`).toBeDefined()
        }
      }
    }
    expect(spec.paths['/v1/reports'].post.responses['429']).toBeDefined()
    expect(spec.paths['/v1/reports/batch'].post.responses['429']).toBeDefined()
  })

  it('has no dangling $ref', async () => {
    const spec = await fetchSpec()
    for (const ref of collectRefs(spec)) resolveRef(spec, ref)
  })
})

describe('OpenAPI spec: the report schema matches the validators', () => {
  it('requires exactly the fields reportSubmissionSchema requires', async () => {
    const { components } = await fetchSpec()
    const shape = reportSubmissionSchema.shape as unknown as Record<string, { isOptional(): boolean }>
    // `id` is optional in the schema; every non-optional key must be listed.
    expect([...components.schemas.ReportSubmission.required].sort()).toEqual(requiredKeys(shape))
  })

  it('requires exactly the environment fields reportSubmissionSchema requires', async () => {
    const { components } = await fetchSpec()
    const env = reportSubmissionSchema.shape.environment as unknown as { _def: { shape(): Record<string, { isOptional(): boolean }> } }
    expect([...components.schemas.ReportEnvironment.required].sort()).toEqual(requiredKeys(env._def.shape()))
  })

  it('lists the full category vocabulary the route accepts', async () => {
    const { components } = await fetchSpec()
    expect(components.schemas.ReportSubmission.properties.category.enum).toEqual([...REPORT_CATEGORY_UNION])
  })

  it('ships an example body that passes both validators', async () => {
    const spec = await fetchSpec()
    const example = spec.paths['/v1/reports'].post.requestBody.content['application/json'].example
    expect(example).toEqual(REPORT_REQUEST_EXAMPLE)
    expect(ApiReportBodySchema.safeParse(example).success).toBe(true)
    const parsed = reportSubmissionSchema.safeParse(normalizeReportCategory({ ...example }))
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true)
  })
})
