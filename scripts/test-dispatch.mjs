#!/usr/bin/env node
// Ad-hoc reproducer for the /v1/admin/fixes/dispatch 500.
// Logs in as the e2e test user, submits a fresh report, then tries to
// dispatch a fix — printing the raw status + body so we can see the
// actual error instead of Hono's generic 500 wrapper.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   TEST_EMAIL=... TEST_PASSWORD=... TEST_PROJECT_ID=... \
//   node scripts/test-dispatch.mjs [reportId]
//
// No secrets are embedded: all credentials come from env vars. Put a
// local `.env.test` outside of git if you need to store them.

const SUPABASE_URL = process.env.SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD
const PROJECT_ID = process.env.TEST_PROJECT_ID

const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TEST_EMAIL', 'TEST_PASSWORD', 'TEST_PROJECT_ID']
  .filter((k) => !process.env[k])
if (missing.length > 0) {
  console.error('missing env vars:', missing.join(', '))
  process.exit(1)
}

const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
const authJson = await authRes.json()
if (!authRes.ok || !authJson.access_token) {
  console.error('auth failed', authRes.status, authJson)
  process.exit(1)
}
const jwt = authJson.access_token
console.log('jwt ok, uid=', authJson.user?.id)

const reportId = process.argv[2]
if (!reportId) {
  console.error('usage: node scripts/test-dispatch.mjs <reportId>')
  process.exit(1)
}
console.log('reportId=', reportId)

const res = await fetch(`${SUPABASE_URL}/functions/v1/api/v1/admin/fixes/dispatch`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ reportId, projectId: PROJECT_ID }),
})
const text = await res.text()
console.log('status=', res.status)
console.log('body=', text)
