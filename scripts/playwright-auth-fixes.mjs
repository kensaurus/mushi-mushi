/**
 * One-shot Playwright auth injector for local admin QA.
 * Reads credentials from .env.local + apps/admin/.env silently.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(rel) {
  const out = {}
  try {
    for (const line of readFileSync(resolve(root, rel), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      out[t.slice(0, eq)] = t.slice(eq + 1).replace(/^["']|["']$/g, '')
    }
  } catch { /* optional */ }
  return out
}

const local = loadEnv('.env.local')
const admin = loadEnv('apps/admin/.env')
const email = process.env.TEST_USER_EMAIL ?? local.TEST_USER_EMAIL
const password = process.env.TEST_USER_PASSWORD ?? local.TEST_USER_PASSWORD
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? admin.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? admin.VITE_SUPABASE_ANON_KEY
const projectId = '67a6453c-375d-41d7-833a-b33471159442'

if (!email || !password || !supabaseUrl || !anonKey) {
  console.error('Missing auth env')
  process.exit(1)
}

const ref = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1]
const storageKey = `sb-${ref}-auth-token`

const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
if (!res.ok) {
  console.error('Auth failed', res.status)
  process.exit(1)
}
const session = await res.json()
const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600)

console.log(JSON.stringify({ storageKey, session: { ...session, expires_at: expiresAt }, projectId }))
