#!/usr/bin/env node
/**
 * sync-host-identity-secret.mjs
 *
 * Operator helper: mint/read identity secret status and print the env block
 * for a host edge function. Never logs the secret unless you redirect stdout
 * locally — do not run in CI logs.
 *
 * Usage:
 *   MUSHI_ADMIN_JWT=eyJ... node scripts/sync-host-identity-secret.mjs --project 6e7e0c3a-...
 *   MUSHI_ADMIN_JWT=eyJ... node scripts/sync-host-identity-secret.mjs --project 6e7e0c3a-... --rotate
 *
 * Requires a JWT from an admin console session (Settings → copy token) or
 * `supabase auth` — not an API key.
 */

const API_BASE =
  process.env.MUSHI_API_ENDPOINT ??
  'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

const HOST_EDGE_FN = {
  '6e7e0c3a-a777-4f1e-a699-6515993cf3bd': {
    slug: 'yen-yen',
    edgeFn: 'mushi-identity-token',
    hostNote: 'Set Supabase edge secrets MUSHI_IDENTITY_SECRET + MUSHI_PROJECT_ID (env overrides private.mushi_identity_config).',
  },
  '542b34e0-019e-41fe-b900-7b637717bb86': {
    slug: 'glot.it',
    edgeFn: 'glot-mushi-identity-token',
    hostNote: 'Deploy glot-mushi-identity-token after setting secrets.',
  },
  '2ac49170-e89a-4d82-a982-bcbda1d3244d': {
    slug: 'the-wanting-mind',
    edgeFn: 'mushi-identity-token',
    hostNote: 'Verify edge function name in host supabase/functions/.',
  },
  'e4523271-f609-465f-8b27-00199b39f050': {
    slug: 'help-her-take-photo',
    edgeFn: 'mushi-identity-token',
    hostNote: 'Verify edge function name in host supabase/functions/.',
  },
}

function parseArgs(argv) {
  const out = { project: null, rotate: false }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) out.project = argv[++i]
    else if (argv[i] === '--rotate') out.rotate = true
  }
  return out
}

async function main() {
  const { project, rotate } = parseArgs(process.argv)
  const jwt = process.env.MUSHI_ADMIN_JWT
  if (!project) {
    console.error('Usage: MUSHI_ADMIN_JWT=... node scripts/sync-host-identity-secret.mjs --project <uuid> [--rotate]')
    process.exit(1)
  }
  if (!jwt) {
    console.error('Missing MUSHI_ADMIN_JWT (admin session JWT, not API key).')
    process.exit(1)
  }

  const meta = HOST_EDGE_FN[project]
  if (!meta) {
    console.warn(`Unknown project ${project} — generic instructions only.`)
  }

  const path = rotate
    ? `/v1/admin/projects/${project}/identity-secret`
    : `/v1/admin/projects/${project}/identity-secret`
  const method = rotate ? 'POST' : 'GET'

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'X-Mushi-Project-Id': project,
    },
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`API ${method} ${path} → ${res.status}`, body?.error?.message ?? body)
    process.exit(1)
  }

  const data = body.data ?? body
  if (rotate && data.secret) {
    console.log('\n# Copy these into your host Supabase edge function secrets:\n')
    console.log(`MUSHI_IDENTITY_SECRET="${data.secret}"`)
    console.log(`MUSHI_PROJECT_ID="${project}"`)
    console.log('\n# Shown once — store in Supabase secrets, not git.\n')
  } else {
    console.log(JSON.stringify({ configured: data.configured, createdAt: data.createdAt ?? null }, null, 2))
    if (!data.configured) {
      console.log('\nRun with --rotate to mint a new secret.\n')
    }
  }

  if (meta) {
    console.log(`\nHost: ${meta.slug}`)
    console.log(`Edge function: ${meta.edgeFn}`)
    console.log(meta.hostNote)
    console.log(`\nDeploy: supabase functions deploy ${meta.edgeFn} --no-verify-jwt\n`)
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
