// What the deploy jobs tell Slack (scripts/notify-slack-release.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReleaseMessage } from './notify-slack-release.mjs'

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
