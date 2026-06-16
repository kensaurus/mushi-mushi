#!/usr/bin/env node
/**
 * Dev-only smoke: POST sdk-upgrade for GitHub-connected projects and poll to terminal.
 * Reads SUPABASE_SERVICE_ROLE_KEY from packages/server/.env or repo root .env.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadEnvKey(name) {
  for (const rel of ['.env', 'packages/server/.env']) {
    try {
      const text = readFileSync(resolve(ROOT, rel), 'utf8')
      const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'))
      if (m) return m[1].replace(/^["']|["']$/g, '')
    } catch { /* missing */ }
  }
  return process.env[name] ?? ''
}

const PROJECT_REF = 'dxptnwrhwsqckaftyymj'
const API = `https://${PROJECT_REF}.supabase.co/functions/v1/api`
const SRK = loadEnvKey('SUPABASE_SERVICE_ROLE_KEY')

if (!SRK) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const PROJECTS = [
  { id: '542b34e0-019e-41fe-b900-7b637717bb86', name: 'glot.it' },
  { id: '67a6453c-375d-41d7-833a-b33471159442', name: 'mushi-mushi' },
  { id: '6e7e0c3a-a777-4f1e-a699-6515993cf3bd', name: 'yen-yen' },
]

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SRK}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function pollJob(projectId, jobId, label) {
  const start = Date.now()
  while (Date.now() - start < 120_000) {
    const { status, body } = await api(`/v1/admin/projects/${projectId}/sdk-upgrade/${jobId}`)
    const row = body?.data
    const st = row?.status
    process.stdout.write(`  [${label}] ${st}…\r`)
    if (['completed', 'completed_no_pr', 'failed', 'cancelled'].includes(st)) {
      console.log(`  [${label}] ${st} in ${((Date.now() - start) / 1000).toFixed(1)}s`)
      return row
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`${label}: poll timeout`)
}

async function testProject({ id, name }) {
  console.log(`\n=== ${name} (${id.slice(0, 8)}…) ===`)

  const inflight = await api(`/v1/admin/projects/${id}/sdk-upgrade/in-flight`)
  console.log(`  in-flight GET: ${inflight.status}`, inflight.body?.data?.status ?? 'null')

  const post = await api(`/v1/admin/projects/${id}/sdk-upgrade`, { method: 'POST', body: '{}' })
  if (post.status === 409 && post.body?.error?.code === 'ALREADY_IN_PROGRESS') {
    const jobId = post.body.error.jobId
    console.log(`  POST dedupe → resume job ${jobId}`)
    const row = await pollJob(id, jobId, name)
    return { name, ok: row.status === 'completed' || row.status === 'completed_no_pr', row }
  }
  if (!post.body?.ok || !post.body?.data?.jobId) {
    console.log(`  POST failed: ${post.status}`, JSON.stringify(post.body))
    return { name, ok: false, row: post.body }
  }
  const jobId = post.body.data.jobId
  console.log(`  POST ok → job ${jobId}`)
  const row = await pollJob(id, jobId, name)
  return {
    name,
    ok: row.status === 'completed' || row.status === 'completed_no_pr',
    row,
  }
}

// Sync catalog first
console.log('Syncing sdk_versions via sdk-versions-cron…')
const cronRes = await fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/sdk-versions-cron`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' },
})
const cronBody = await cronRes.json().catch(() => ({}))
console.log(`  cron: ${cronRes.status}`, cronBody?.data?.upserted ?? cronBody?.error ?? 'done')

const results = []
for (const p of PROJECTS) {
  try {
    results.push(await testProject(p))
  } catch (err) {
    results.push({ name: p.name, ok: false, error: String(err) })
  }
}

console.log('\n=== SUMMARY ===')
for (const r of results) {
  const pr = r.row?.pr_url ?? r.row?.prUrl ?? '—'
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} → ${r.row?.status ?? r.error} ${pr !== '—' ? pr : ''}`)
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
