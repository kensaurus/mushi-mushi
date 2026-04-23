#!/usr/bin/env node
// Deploy a Supabase Edge Function via the Management API multipart endpoint.
//
// Mirrors the supabase CLI's `pkg/function/deploy.go` behaviour
// (`POST /v1/projects/{ref}/functions/deploy?slug={slug}`) so deployment
// works on machines where the npm-shipped CLI binary is blocked by Device
// Guard / EDR. Reads token from $SUPABASE_ACCESS_TOKEN, project ref from
// $SUPABASE_PROJECT_REF (falls back to dxptnwrhwsqckaftyymj), and the slug
// from argv[2].
//
// Usage:
//   node scripts/deploy-edge-function.mjs <slug> [--no-verify-jwt] [--verify-jwt]
//
// The script bundles `packages/server/supabase/functions/<slug>/**` plus
// `packages/server/supabase/functions/_shared/**` (the function tree-shakes
// unused imports server-side, so over-uploading is safe).

import { readFileSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const SUPABASE_API = 'https://api.supabase.com'
const FUNCTIONS_ROOT_REL = 'supabase/functions'
const SERVER_PKG_ABS = new URL('../packages/server/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function loadDotenv() {
  for (const f of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(f, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith('#')) continue
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (!m) continue
        let [, k, v] = m
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        if (!(k in process.env)) process.env[k] = v
      }
    } catch {
      // file is optional
    }
  }
}

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return out
    throw err
  }
  for (const ent of entries) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await walk(p)))
    } else if (ent.isFile()) {
      out.push(p)
    }
  }
  return out
}

function toForwardSlash(p) {
  return p.split(sep).join('/')
}

function flag(name) {
  return process.argv.includes(name)
}

async function main() {
  loadDotenv()
  const slug = process.argv[2]
  if (!slug || slug.startsWith('-')) {
    console.error('Usage: node scripts/deploy-edge-function.mjs <slug> [--no-verify-jwt|--verify-jwt]')
    process.exit(2)
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    console.error('error: SUPABASE_ACCESS_TOKEN is not set (export it or add to .env). Generate at https://supabase.com/dashboard/account/tokens')
    process.exit(2)
  }
  const projectRef = process.env.SUPABASE_PROJECT_REF || 'dxptnwrhwsqckaftyymj'
  const verifyJwt = flag('--verify-jwt') ? true : flag('--no-verify-jwt') ? false : false

  const fnRootAbs = join(SERVER_PKG_ABS, FUNCTIONS_ROOT_REL)
  const fnDirAbs = join(fnRootAbs, slug)
  if (!statSync(fnDirAbs, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`error: function directory not found: ${fnDirAbs}`)
    process.exit(2)
  }

  const sharedDirAbs = join(fnRootAbs, '_shared')

  const fnFiles = await walk(fnDirAbs)
  const sharedFiles = await walk(sharedDirAbs)
  const allFiles = [...fnFiles, ...sharedFiles]
  if (allFiles.length === 0) {
    console.error('error: no source files discovered')
    process.exit(1)
  }

  const entrypointRel = `${FUNCTIONS_ROOT_REL}/${slug}/index.ts`
  const staticPatterns = []
  // Treat anything inside .well-known as a static asset so it's served as-is.
  if (statSync(join(fnDirAbs, '.well-known'), { throwIfNoEntry: false })?.isDirectory()) {
    staticPatterns.push(`${FUNCTIONS_ROOT_REL}/${slug}/.well-known/*`)
  }

  const metadata = {
    name: slug,
    entrypoint_path: entrypointRel,
    verify_jwt: verifyJwt,
    static_patterns: staticPatterns,
  }

  const form = new FormData()
  form.append('metadata', JSON.stringify(metadata))

  let totalBytes = 0
  for (const abs of allFiles) {
    const rel = toForwardSlash(`${FUNCTIONS_ROOT_REL}/${relative(fnRootAbs, abs)}`)
    const buf = readFileSync(abs)
    totalBytes += buf.byteLength
    form.append('file', new Blob([buf]), rel)
  }

  const url = `${SUPABASE_API}/v1/projects/${projectRef}/functions/deploy?slug=${encodeURIComponent(slug)}`
  console.error(`> POST ${url}`)
  console.error(`> ${allFiles.length} files, ${(totalBytes / 1024).toFixed(1)} KiB total, verify_jwt=${verifyJwt}`)
  console.error(`> entrypoint=${entrypointRel}`)

  const started = Date.now()
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
  } catch (err) {
    console.error(`network error after ${Date.now() - started}ms:`, err.message)
    process.exit(1)
  }

  const text = await resp.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }

  if (resp.status === 200 || resp.status === 201) {
    console.error(`deploy ok in ${Date.now() - started}ms — version=${body?.version} sha256=${body?.ezbr_sha256?.slice(0, 12)}`)
    console.log(JSON.stringify(body, null, 2))
    process.exit(0)
  }
  console.error(`deploy failed (HTTP ${resp.status}) after ${Date.now() - started}ms`)
  console.error(typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  process.exit(1)
}

main().catch((err) => {
  console.error('unexpected:', err)
  process.exit(1)
})
