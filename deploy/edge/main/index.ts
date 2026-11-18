// FILE: deploy/edge/main/index.ts
// PURPOSE: Main service for supabase/edge-runtime in the self-hosted image.
//          Routes /<function>/... to that function's worker, the way the
//          hosted platform does after it strips /functions/v1. Same pattern as
//          supabase/docker volumes/functions/main/index.ts.
//
// Also accepts the unstripped /functions/v1/<function>/... form.
//
// Lives in deploy/, not packages/server/supabase/functions/, so
// `supabase functions deploy` never ships it as a function. Dockerfile.edge
// copies it to /home/deno/functions/main.
//
// JWT checks stay inside each function (requireServiceRoleAuth, apiKeyAuth,
// jwtAuth), matching the production deploy where config.toml sets
// verify_jwt = false for nearly every function.

declare const EdgeRuntime: {
  userWorkers: {
    create(opts: {
      servicePath: string
      memoryLimitMb: number
      workerTimeoutMs: number
      noModuleCache: boolean
      importMapPath: string | null
      envVars: [string, string][]
    }): Promise<{ fetch(req: Request): Promise<Response> }>
  }
}

const FUNCTIONS_DIR = '/home/deno/functions'
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const PLATFORM_PREFIX = '/functions/v1'

Deno.serve(async (incoming: Request) => {
  // A gateway that keeps the platform prefix (the Helm ingress) sends
  // /functions/v1/<fn>/...; the functions expect /<fn>/... (api uses
  // basePath('/api')), so strip it here too.
  const url = new URL(incoming.url)
  if (url.pathname.startsWith(`${PLATFORM_PREFIX}/`)) {
    url.pathname = url.pathname.slice(PLATFORM_PREFIX.length)
  }
  const req = url.href === incoming.url ? incoming : new Request(url, incoming)
  const name = url.pathname.split('/')[1] ?? ''
  if (!NAME_RE.test(name) || name === 'main') {
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown function' } })
  }
  try {
    await Deno.stat(`${FUNCTIONS_DIR}/${name}/index.ts`)
  } catch {
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: `No function named ${name}` } })
  }

  const env = Deno.env.toObject()
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_DIR}/${name}`,
      // The hosted platform allows 256 MB and a 400 s wall clock (Stage 2
      // streams for up to 180 s).
      memoryLimitMb: 256,
      workerTimeoutMs: 400_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(env),
    })
    return await worker.fetch(req)
  } catch (err) {
    console.error(`main: worker for ${name} failed`, err)
    return json(500, { ok: false, error: { code: 'WORKER_FAILED', message: String(err) } })
  }
})
