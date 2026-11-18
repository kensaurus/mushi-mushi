// What the deploy jobs tell Slack (scripts/notify-slack-release.mjs), through the Mushi Mushi Ops hub first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReleaseMessage, notifyRelease, opsEndpoint, toOpsEvent } from './notify-slack-release.mjs'

const base = { what: 'Admin console', version: '0.1.680', detail: '', commitSubject: 'feat(admin): CI page shows what is wrong first', runUrl: 'https://github.com/kensaurus/mushi-mushi/actions/runs/1' }

test('a successful deploy goes to #releases, app name first, with the commit and a run link', () => {
  const m = buildReleaseMessage({ ...base, status: 'success' })
  assert.equal(m.channel, 'releases')
  assert.equal(m.payload.text, 'Mushi Mushi · 🚀 Admin console 0.1.680 is live')
  const text = JSON.stringify(m.payload)
  assert.match(text, /CI page shows what is wrong first/)
  assert.match(text, /Open the run/)
})

test('a failed deploy goes to #alerts and says the previous version still serves', () => {
  const m = buildReleaseMessage({ ...base, status: 'failure' })
  assert.equal(m.channel, 'alerts')
  assert.equal(m.payload.text, 'Mushi Mushi · 🔴 Admin console deploy failed')
  assert.match(JSON.stringify(m.payload), /previous version is still serving/)
})

test('a cancelled run says nothing', () => {
  assert.equal(buildReleaseMessage({ ...base, status: 'cancelled' }), null)
})

test('detail replaces the commit subject (the npm packages published)', () => {
  const m = buildReleaseMessage({ ...base, what: 'npm packages', version: '', status: 'success', detail: '@mushi-mushi/cli 0.40.2' })
  assert.equal(m.payload.text, 'Mushi Mushi · 🚀 npm packages is live')
  assert.match(JSON.stringify(m.payload), /@mushi-mushi\/cli 0.40.2/)
  assert.doesNotMatch(JSON.stringify(m.payload), /CI page shows/)
})

// ── Mushi Mushi Ops hub ─────────────────────────────────────────────────────

const ci = { repo: 'kensaurus/mushi-mushi', runId: '42', runAttempt: '1', job: 'deploy', workflow: 'Deploy Admin', shortSha: 'abc1234' }
const ALLOWED = new Set(['category', 'severity', 'kind', 'title', 'body', 'facts', 'url', 'thread_key', 'dedupe_key'])
const KIND_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$/

test('a good deploy is a release event with no thread and no app name in the title', () => {
  const ev = toOpsEvent({ ...base, ...ci, status: 'success' })
  assert.deepEqual(ev, {
    category: 'releases',
    severity: 'info',
    kind: 'deploy.succeeded',
    title: 'Admin console 0.1.680 is live',
    body: 'feat(admin): CI page shows what is wrong first',
    facts: [
      { label: 'Environment', value: 'production' },
      { label: 'Workflow', value: 'Deploy Admin' },
      { label: 'Commit', value: 'abc1234' },
    ],
    url: base.runUrl,
    dedupe_key: 'gh-run:kensaurus/mushi-mushi:42:1:deploy',
  })
})

test('a failed deploy is an urgent alert threaded per repo, never resolved', () => {
  const ev = toOpsEvent({ ...base, ...ci, status: 'failure' })
  assert.equal(ev.category, 'alerts')
  assert.equal(ev.severity, 'urgent')
  assert.equal(ev.kind, 'deploy.failed')
  assert.equal(ev.title, 'Admin console deploy failed')
  assert.equal(ev.thread_key, 'deploy:kensaurus/mushi-mushi:production')
  assert.match(ev.body, /previous version is still serving/)
})

test('a cancelled run sends no Ops event; every event uses only the strict schema keys', () => {
  assert.equal(toOpsEvent({ ...base, ...ci, status: 'cancelled' }), null)
  for (const status of ['success', 'failure']) {
    const ev = toOpsEvent({ ...base, ...ci, status, workflow: '', runUrl: 'http://x', commitSubject: '', detail: '' })
    for (const k of Object.keys(ev)) assert.ok(ALLOWED.has(k), k)
    assert.match(ev.kind, KIND_RE)
    assert.ok(ev.title.length <= 150 && !ev.title.includes('Mushi Mushi'))
    assert.equal(ev.url, undefined)
    assert.ok(!ev.facts.some((f) => f.label === 'Workflow'))
    if (status === 'success') assert.equal(ev.body, undefined)
  }
})

test('npm publishes name the registry in a fact and keep the package list as the body', () => {
  const ev = toOpsEvent({ ...base, ...ci, what: 'npm packages', version: '', status: 'success', detail: '@mushi-mushi/cli 0.40.2' })
  assert.equal(ev.title, 'New packages reached npm')
  assert.equal(ev.body, '@mushi-mushi/cli 0.40.2')
  assert.deepEqual(ev.facts[0], { label: 'Registry', value: 'npm' })
})

test('opsEndpoint requires https and strips the trailing slash', () => {
  assert.equal(opsEndpoint('https://x.supabase.co/functions/v1/api/'), 'https://x.supabase.co/functions/v1/api/v1/ops/events')
  assert.equal(opsEndpoint('http://x.supabase.co/functions/v1/api'), null)
  assert.equal(opsEndpoint(undefined), null)
})

const FAKE_KEY = 'mushi_FAKE-OPS-KEY-DO-NOT-USE'
const FAKE_RELEASES = 'https://hooks.slack.com/services/T0/B0/FAKE-RELEASES'
const FAKE_ALERTS = 'https://hooks.slack.com/services/T0/B0/FAKE-ALERTS'
const env = {
  JOB_STATUS: 'success',
  WHAT: 'Admin console',
  VERSION: '0.1.680',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'kensaurus/mushi-mushi',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_JOB: 'deploy',
  GITHUB_WORKFLOW: 'Deploy Admin',
  MUSHI_OPS_KEY: FAKE_KEY,
  MUSHI_API_URL: 'https://mushi.example/functions/v1/api',
  SLACK_RELEASES_WEBHOOK_URL: FAKE_RELEASES,
  SLACK_ALERTS_WEBHOOK_URL: FAKE_ALERTS,
}

function fakeFetch(...statuses) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    const next = statuses.shift()
    if (next instanceof Error) throw next
    return { status: next }
  }
  return { fn, calls }
}

test('notifyRelease: Mushi Mushi first with the key header, and no Slack post on 202', async () => {
  const f = fakeFetch(202)
  const logs = []
  assert.equal(await notifyRelease(env, { fetchImpl: f.fn, log: (m) => logs.push(m), commitSubject: 'x', shortSha: 'abc1234' }), 'ops')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, 'https://mushi.example/functions/v1/api/v1/ops/events')
  assert.equal(f.calls[0].init.headers['X-Mushi-Api-Key'], FAKE_KEY)
  assert.ok(!JSON.stringify(logs).includes('FAKE-OPS-KEY'))
})

test('notifyRelease: a 422 resends once without the body and never posts to Slack', async () => {
  const f = fakeFetch(422, 202)
  assert.equal(await notifyRelease(env, { fetchImpl: f.fn, log: () => {}, commitSubject: 'x' }), 'ops-without-body')
  assert.equal(f.calls.length, 2)
  assert.equal(JSON.parse(f.calls[1].init.body).body, undefined)
  assert.ok(f.calls.every((c) => !c.url.includes('hooks.slack.com')))
})

test('notifyRelease: any other answer or a network error falls back to the right webhook', async () => {
  const a = fakeFetch(503, 200)
  assert.equal(await notifyRelease({ ...env, JOB_STATUS: 'failure' }, { fetchImpl: a.fn, log: () => {} }), 'slack')
  assert.equal(a.calls[1].url, FAKE_ALERTS)
  const b = fakeFetch(new Error('down'), 200)
  assert.equal(await notifyRelease(env, { fetchImpl: b.fn, log: () => {} }), 'slack')
  assert.equal(b.calls[1].url, FAKE_RELEASES)
})

test('notifyRelease: without the key it is the Slack path as before; cancelled sends nothing', async () => {
  const a = fakeFetch(200)
  assert.equal(await notifyRelease({ ...env, MUSHI_OPS_KEY: '' }, { fetchImpl: a.fn, log: () => {} }), 'slack')
  assert.equal(a.calls[0].url, FAKE_RELEASES)
  const b = fakeFetch()
  assert.equal(await notifyRelease({ ...env, JOB_STATUS: 'cancelled' }, { fetchImpl: b.fn, log: () => {} }), 'skipped')
  assert.equal(await notifyRelease({ ...env, MUSHI_OPS_KEY: '', SLACK_RELEASES_WEBHOOK_URL: '' }, { fetchImpl: b.fn, log: () => {} }), 'skipped')
  assert.equal(b.calls.length, 0)
})
