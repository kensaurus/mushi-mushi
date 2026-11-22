// What the deploy jobs tell Slack (scripts/notify-slack-release.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReleaseMessage } from './notify-slack-release.mjs'

const base = { what: 'Admin console', version: '0.1.680', detail: '', commitSubject: 'feat(admin): CI page shows what is wrong first', runUrl: 'https://github.com/kensaurus/mushi-mushi/actions/runs/1' }

test('a successful deploy goes to #releases, app name first, with the commit and a run link', () => {
  const m = buildReleaseMessage({ ...base, status: 'success' })
  assert.equal(m.channel, 'releases')
  assert.equal(m.payload.text, 'Mushi Mushi · 🚀 Admin console 0.1.680 is live · feat(admin): CI page shows what is wrong first')
  const text = JSON.stringify(m.payload)
  assert.match(text, /Open the run/)
  // One headline: top-level blocks, never a legacy attachment that repeats it.
  assert.equal('attachments' in m.payload, false)
  assert.equal(text.split('CI page shows what is wrong first').length - 1, 2, 'once in text, once in the block')
})

test('a failed deploy goes to #alerts and says the previous version still serves', () => {
  const m = buildReleaseMessage({ ...base, status: 'failure' })
  assert.equal(m.channel, 'alerts')
  assert.equal(m.payload.text, 'Mushi Mushi · 🔴 Admin console deploy to production failed')
  assert.match(JSON.stringify(m.payload), /previous version is still serving/)
})

test('a cancelled run says nothing', () => {
  assert.equal(buildReleaseMessage({ ...base, status: 'cancelled' }), null)
})

test('detail replaces the commit subject (the npm packages published)', () => {
  const m = buildReleaseMessage({ ...base, what: 'npm packages', version: '', status: 'success', detail: '@mushi-mushi/cli 0.40.2' })
  assert.equal(m.payload.text, 'Mushi Mushi · 🚀 npm packages are live · feat(admin): CI page shows what is wrong first')
  assert.match(JSON.stringify(m.payload), /@mushi-mushi\/cli 0.40.2/)
})

test('with an ops key, a good deploy becomes a releases event, threaded per repo and deploy, posted once per run', async () => {
  const { buildOpsEvent } = await import('./notify-slack-release.mjs')
  const e = buildOpsEvent({ ...base, status: 'success', repo: 'kensaurus/mushi-mushi', runId: '42', attempt: '1', sha: '76f5bb1aa0c3' })
  assert.equal(e.category, 'releases')
  assert.equal(e.severity, 'info')
  assert.equal(e.kind, 'deploy.succeeded')
  // No 🚀 in the title: the Ops hub adds the mark itself (it rendered "🚀 🚀 …" before 2026-11-20).
  assert.equal(e.title, 'Admin console 0.1.680 is live · feat(admin): CI page shows what is wrong first')
  assert.equal(e.body, undefined, 'the PR title is in the title, not repeated in the body')
  // The commit lets the hub drop GitHub's own "… is live" post for the same deploy.
  assert.deepEqual(e.facts, [
    { label: 'Environment', value: 'production' },
    { label: 'Where', value: 'GitHub Actions' },
    { label: 'Commit', value: '76f5bb1' },
  ])
  assert.equal(e.thread_key, 'deploy:kensaurus/mushi-mushi:admin_console')
  assert.equal(e.dedupe_key, 'deploy:kensaurus/mushi-mushi:admin_console:42:1:success')
  assert.equal(e.url, base.runUrl)
  assert.doesNotMatch(e.title, /Mushi Mushi/, 'the Ops hub adds the app name from the key')
})

test('a failed deploy becomes an urgent alert; a cancelled one sends nothing', async () => {
  const { buildOpsEvent } = await import('./notify-slack-release.mjs')
  const e = buildOpsEvent({ ...base, status: 'failure', repo: 'r/x', runId: '7' })
  assert.equal(e.category, 'alerts')
  assert.equal(e.severity, 'urgent')
  assert.equal(e.kind, 'deploy.failed')
  assert.match(e.body, /previous version is still serving\..*\nCommit: feat\(admin\)/s)
  assert.equal(buildOpsEvent({ ...base, status: 'cancelled' }), null)
})

test('the events URL takes the api base, pins a valid region, and refuses plain http', async () => {
  const { opsEventsUrl } = await import('./notify-slack-release.mjs')
  assert.equal(opsEventsUrl('https://p.supabase.co/functions/v1/api/', 'ap-northeast-1'), 'https://p.supabase.co/functions/v1/api/v1/ops/events?forceFunctionRegion=ap-northeast-1')
  assert.equal(opsEventsUrl('https://p.supabase.co/functions/v1/api', ''), 'https://p.supabase.co/functions/v1/api/v1/ops/events')
  assert.equal(opsEventsUrl('https://p.supabase.co/functions/v1/api', 'tokyo; rm -rf'), 'https://p.supabase.co/functions/v1/api/v1/ops/events')
  assert.equal(opsEventsUrl('http://p.supabase.co/functions/v1/api', 'ap-northeast-1'), null)
})

test('plural deploys say "are", a squash subject loses its (#N), a merge subject adds nothing', async () => {
  const { liveVerb, shippedTitle, buildOpsEvent } = await import('./notify-slack-release.mjs')
  assert.equal(liveVerb('Edge functions'), 'are')
  assert.equal(liveVerb('Docs site'), 'is')
  assert.equal(shippedTitle('feat(ops): one Slack format (#1189)'), 'feat(ops): one Slack format')
  assert.equal(shippedTitle('Merge pull request #12 from kensaurus/x'), '')
  const e = buildOpsEvent({ ...base, what: 'Edge functions', version: '', status: 'success', commitSubject: 'Merge pull request #12 from kensaurus/x' })
  assert.equal(e.title, 'Edge functions are live')
})

test('the environment comes from the ref, never typed in', async () => {
  const { deployEnvironment, buildOpsEvent } = await import('./notify-slack-release.mjs')
  assert.equal(deployEnvironment('master'), 'production')
  assert.equal(deployEnvironment('main'), 'production')
  assert.equal(deployEnvironment('release/next'), 'release/next')
  const e = buildOpsEvent({ ...base, status: 'failure', environment: 'release/next' })
  assert.equal(e.title, 'Admin console deploy to release/next failed')
  assert.deepEqual(e.facts[0], { label: 'Environment', value: 'release/next' })
})
