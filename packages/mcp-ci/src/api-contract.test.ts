/**
 * Round 8 B16 — regression tests for the App Router route walker.
 *
 * The audit flagged that `walkNextAppRouter` filters URL-invisible
 * segments (route groups `(marketing)`, parallel slots `@auth`,
 * private dirs `_components`) and converts dynamic segments
 * (`[id]`, `[...slug]`) to OpenAPI-style braces, but ships untested.
 * A future `path.basename` regex tweak or a renamed segment-filter
 * would silently leak phantom routes into the api_contract gate.
 *
 * These tests pin every subtle path-derivation rule to a concrete
 * fixture so changes have to be deliberate.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { walkNextAppRouter, parseOpenApiFile, discoverRoutes } from './api-contract.js'

async function setupAppRouter(
  layout: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mushi-mcp-ci-'))
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, 'utf-8')
  }
  return root
}

describe('walkNextAppRouter', () => {
  let tmpRoot: string | null = null

  beforeEach(() => {
    tmpRoot = null
  })

  afterEach(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
  })

  it('extracts a single GET handler at the app root', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/health/route.ts': `export async function GET() { return Response.json({ ok: true }) }`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/api/health'])
  })

  it('extracts every HTTP method declared in the same file', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/items/route.ts': [
        `export async function GET() {}`,
        `export async function POST() {}`,
        `export function PUT() {}`,
        `export async function DELETE() {}`,
        `export function PATCH() {}`,
      ].join('\n'),
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes.sort()).toEqual([
      'DELETE:/api/items',
      'GET:/api/items',
      'PATCH:/api/items',
      'POST:/api/items',
      'PUT:/api/items',
    ])
  })

  it('strips route groups `(marketing)` from the URL', async () => {
    tmpRoot = await setupAppRouter({
      'app/(marketing)/api/cta/route.ts': `export async function POST() {}`,
      'app/(dashboard)/api/dash/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes.sort()).toEqual(['GET:/api/dash', 'POST:/api/cta'])
  })

  it('strips parallel-route slots `@auth`', async () => {
    tmpRoot = await setupAppRouter({
      'app/@auth/api/login/route.ts': `export async function POST() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['POST:/api/login'])
  })

  it('strips private/co-located segments `_internal`', async () => {
    tmpRoot = await setupAppRouter({
      'app/_internal/api/debug/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/api/debug'])
  })

  it('converts `[id]` dynamic segments to OpenAPI `{id}` braces', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/users/[id]/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/api/users/{id}'])
  })

  it('converts `[...slug]` catch-all segments to `{slug}` braces', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/blog/[...slug]/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/api/blog/{slug}'])
  })

  it('handles a route at the literal `app/route.ts` root with no segments', async () => {
    tmpRoot = await setupAppRouter({
      'app/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/'])
  })

  it('ignores files that are not named `route.{ts,js,tsx,jsx}`', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/skipped/handler.ts': `export async function GET() {}`,
      'app/api/skipped/page.tsx': `export default function Page() { return null }`,
      'app/api/included/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/api/included'])
  })

  it('skips `node_modules`, `.next`, and dotfile directories', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/real/route.ts': `export async function GET() {}`,
      'app/node_modules/should-skip/route.ts': `export async function GET() {}`,
      'app/.next/cached/route.ts': `export async function GET() {}`,
      'app/.git/objects/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/api/real'])
  })

  it('returns an empty array when `app/` does not exist', async () => {
    tmpRoot = await setupAppRouter({
      'pages/api/legacy.ts': `export default function () {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual([])
  })

  it('does not match `function GETSomething` (substring guard)', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/lookalike/route.ts': [
        `export async function GETData() {}`,
        `export async function POSTBody() {}`,
      ].join('\n'),
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual([])
  })

  it('combines multiple URL-invisible segments at once', async () => {
    tmpRoot = await setupAppRouter({
      'app/(marketing)/@hero/_internal/api/banner/route.ts': `export async function GET() {}`,
    })
    const routes = await walkNextAppRouter(tmpRoot)
    expect(routes).toEqual(['GET:/api/banner'])
  })
})

describe('parseOpenApiFile', () => {
  let tmpRoot: string | null = null

  afterEach(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
  })

  it('parses an OpenAPI JSON document into METHOD:path strings', async () => {
    tmpRoot = await setupAppRouter({
      'openapi.json': JSON.stringify({
        paths: {
          '/users': { get: {}, post: {} },
          '/users/{id}': { get: {}, delete: {} },
        },
      }),
    })
    const routes = await parseOpenApiFile(path.join(tmpRoot, 'openapi.json'))
    expect(routes.sort()).toEqual([
      'DELETE:/users/{id}',
      'GET:/users',
      'GET:/users/{id}',
      'POST:/users',
    ])
  })

  it('returns [] when the file is missing', async () => {
    const routes = await parseOpenApiFile('/nonexistent/openapi.json')
    expect(routes).toEqual([])
  })

  it('returns [] when JSON is malformed', async () => {
    tmpRoot = await setupAppRouter({
      'openapi.json': '{ not valid json',
    })
    const routes = await parseOpenApiFile(path.join(tmpRoot, 'openapi.json'))
    expect(routes).toEqual([])
  })
})

describe('discoverRoutes', () => {
  let tmpRoot: string | null = null

  afterEach(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
  })

  it('aggregates Next App Router + OpenAPI deduped & sorted', async () => {
    tmpRoot = await setupAppRouter({
      'app/api/items/route.ts': `export async function GET() {}`,
      'openapi.json': JSON.stringify({
        paths: {
          '/api/items': { get: {} }, // duplicate of Next finding — must dedupe
          '/api/extra': { post: {} },
        },
      }),
    })
    const routes = await discoverRoutes({ repoRoot: tmpRoot })
    expect(routes).toEqual(['GET:/api/items', 'POST:/api/extra'])
  })

  it('uses an explicit `openapiFile` over the convention search', async () => {
    tmpRoot = await setupAppRouter({
      'docs/spec.json': JSON.stringify({
        paths: { '/v1/explicit': { get: {} } },
      }),
      'openapi.json': JSON.stringify({
        paths: { '/v1/conventional': { get: {} } },
      }),
    })
    const routes = await discoverRoutes({
      repoRoot: tmpRoot,
      openapiFile: path.join(tmpRoot, 'docs/spec.json'),
    })
    expect(routes).toEqual(['GET:/v1/explicit'])
  })
})
