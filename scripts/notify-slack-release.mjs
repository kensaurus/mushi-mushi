#!/usr/bin/env node
/**
 * FILE: scripts/notify-slack-release.mjs
 * PURPOSE: Tell the Kensaurus Slack what shipped (2026-11-17). The last step of each production
 *          deploy job runs it:
 *            - job succeeded → #releases: "Mushi Mushi · 🚀 Admin console 0.1.680 is live" + the
 *              commit subject + a button to the run
 *            - job failed    → #alerts:   "Mushi Mushi · 🔴 Admin console deploy failed" + what that
 *              means + a button to the run
 *
 * Route (2026-11-18): with MUSHI_OPS_KEY and MUSHI_API_URL set, the result goes to the Mushi
 * Mushi Ops hub (POST /v1/ops/events), which posts it with the team's Slack bot: threads,
 * buttons, and the record on the console's Ops page. The event names its commit, so the hub
 * drops the GitHub deployment's duplicate "… is live" post for it. Without them, or when the hub does not
 * answer 2xx, it falls back to the channel's incoming webhook as before.
 *
 * Env (from repo secrets; a missing one skips quietly):
 *   MUSHI_OPS_KEY, MUSHI_API_URL  the app's ops:write key and the api base (…/functions/v1/api)
 *   MUSHI_FUNCTION_REGION         optional: the database region, pins the function there
 *   SLACK_RELEASES_WEBHOOK_URL, SLACK_ALERTS_WEBHOOK_URL
 *   JOB_STATUS   ${{ job.status }}: success | failure | cancelled
 *   WHAT         what was deployed: "Admin console", "Edge functions", "Docs site", "npm packages"
 *   VERSION      optional version shown after WHAT
 *   DETAIL       optional line that replaces the commit subject (e.g. the packages published)
 * Never prints the webhook URL. Never fails the job: every error exits 0 with a warning.
 */
import { execFileSync } from 'node:child_process'

const APP = 'Mushi Mushi'

/** @internal "is" or "are": "Edge functions are live", "Docs site 0.1.705 is live" (2026-11-20). */
export function liveVerb(what) {
  return /s$/i.test(String(what).trim()) ? 'are' : 'is'
}

/**
 * @internal The PR title a squash merge leaves as the subject: "feat(x): y (#12)" → "feat(x): y".
 * A "Merge pull request #N from …" subject carries no title, so it gives "".
 */
export function shippedTitle(subject) {
  const s = String(subject || '').split('\n')[0].trim()
  if (/^Merge pull request #\d+/.test(s)) return ''
  return s.replace(/\s+\(#\d+\)$/, '').slice(0, 100)
}

/** @internal The environment a ref deploys to: main/master is production, anything else names itself. */
export function deployEnvironment(refName) {
  const r = String(refName || '').trim()
  return !r || r === 'main' || r === 'master' ? 'production' : r
}

/** @internal Exported for tests. The Slack payload for one deploy result, or null when there is nothing to say. */
export function buildReleaseMessage({ status, what, version, detail, commitSubject, runUrl, environment = 'production' }) {
  const label = `${what}${version ? ` ${version}` : ''}`
  const shipped = shippedTitle(commitSubject)
  if (status === 'success') {
    const headline = `${APP} · 🚀 ${label} ${liveVerb(what)} live${shipped ? ` · ${shipped}` : ''}`
    return {
      channel: 'releases',
      payload: payload(headline, (detail || '').slice(0, 300), runUrl, environment),
    }
  }
  if (status === 'failure') {
    const headline = `${APP} · 🔴 ${what} deploy to ${environment} failed`
    const body = `Nothing new went live from this run; the previous version is still serving. Open the run to see which step failed.${commitSubject ? `\nCommit: ${commitSubject.slice(0, 200)}` : ''}`
    return { channel: 'alerts', payload: payload(headline, body, runUrl, environment) }
  }
  return null
}

/**
 * @internal Exported for tests. The Ops hub event for one deploy result, or null. The app name
 * comes from the key's project, so the title leaves it out. A retried run posts once.
 */
export function buildOpsEvent({ status, what, version, detail, commitSubject, runUrl, repo, runId, attempt, sha, environment = 'production' }) {
  const label = `${what}${version ? ` ${version}` : ''}`
  const shipped = shippedTitle(commitSubject)
  const slug = String(what).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'deploy'
  const base = {
    url: runUrl && runUrl.startsWith('https://') ? runUrl : undefined,
    thread_key: `deploy:${repo || 'repo'}:${slug}`.slice(0, 200),
    dedupe_key: runId ? `deploy:${repo || 'repo'}:${slug}:${runId}:${attempt || '1'}:${status}`.slice(0, 200) : undefined,
    // Environment and Commit (2026-11-20): the Ops hub shows the verified environment, and the
    // Commit lets it drop the GitHub deployment's own "… is live" post for the same commit.
    facts: [
      { label: 'Environment', value: environment },
      { label: 'Where', value: 'GitHub Actions' },
      ...(/^[0-9a-f]{7,40}$/i.test(sha || '') ? [{ label: 'Commit', value: String(sha).slice(0, 7) }] : []),
    ],
  }
  if (status === 'success') {
    return { ...base, category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: `${label} ${liveVerb(what)} live${shipped ? ` · ${shipped}` : ''}`.slice(0, 150), body: (detail || '').slice(0, 600) || undefined }
  }
  if (status === 'failure') {
    const body = `Nothing new went live from this run; the previous version is still serving. Open the run to see which step failed.${commitSubject ? `\nCommit: ${commitSubject.slice(0, 200)}` : ''}`
    return { ...base, category: 'alerts', severity: 'urgent', kind: 'deploy.failed', title: `${what} deploy to ${environment} failed`.slice(0, 150), body: body.slice(0, 600) }
  }
  return null
}

/** @internal Exported for tests. The events URL, pinned to the database region when one is given. */
export function opsEventsUrl(apiUrl, region) {
  const base = String(apiUrl || '').replace(/\/+$/, '')
  if (!/^https:\/\//.test(base)) return null
  const r = /^[a-z]{2}-[a-z]+-\d$/.test(region || '') ? `?forceFunctionRegion=${region}` : ''
  return `${base}/v1/ops/events${r}`
}

/** True when the Ops hub took the event (202 created, or 200 duplicate on a retry). */
async function sendToOpsHub(env, event) {
  const key = (env.MUSHI_OPS_KEY || '').trim()
  const url = opsEventsUrl(env.MUSHI_API_URL, env.MUSHI_FUNCTION_REGION)
  if (!key || !url || !event) return false
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Mushi-Api-Key': key }, body: JSON.stringify(event), signal: AbortSignal.timeout(10_000) })
    console.log(`notify-slack-release: Ops hub answered ${res.status}`)
    return res.ok
  } catch (err) {
    console.log(`::warning::notify-slack-release: Ops hub unreachable (${err instanceof Error ? err.name : 'error'}); using the webhook`)
    return false
  }
}

// Top-level blocks, no legacy attachment (2026-11-20): with an attachment Slack showed `text` and
// the attachment's bold headline, so every post read twice. `text` stays as the notification fallback.
function payload(headline, body, runUrl, environment) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `*${esc(headline)}*${body ? `\n${esc(body)}` : ''}` } }]
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `${esc(environment)} · GitHub Actions` }] })
  if (runUrl) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the run' }, url: runUrl }] })
  return { text: headline, blocks }
}

function commitSubject() {
  try {
    return execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function main() {
  const env = process.env
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : ''
  const input = {
    status: env.JOB_STATUS,
    what: env.WHAT || 'Deploy',
    version: env.VERSION || '',
    detail: env.DETAIL || '',
    commitSubject: commitSubject(),
    runUrl,
    environment: deployEnvironment(env.GITHUB_REF_NAME),
  }
  const msg = buildReleaseMessage(input)
  if (!msg) return
  const event = buildOpsEvent({ ...input, repo: env.GITHUB_REPOSITORY || '', runId: env.GITHUB_RUN_ID || '', attempt: env.GITHUB_RUN_ATTEMPT || '1', sha: env.GITHUB_SHA || '' })
  if (await sendToOpsHub(env, event)) return
  const url = (msg.channel === 'releases' ? env.SLACK_RELEASES_WEBHOOK_URL : env.SLACK_ALERTS_WEBHOOK_URL) || ''
  if (!url) {
    console.log(`notify-slack-release: no ${msg.channel} webhook set; skipped`)
    return
  }
  let host = ''
  try {
    host = new URL(url).host
  } catch {}
  if (host !== 'hooks.slack.com') {
    console.log('::warning::notify-slack-release: the webhook is not a hooks.slack.com URL; skipped')
    return
  }
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg.payload), signal: AbortSignal.timeout(10_000) })
  console.log(`notify-slack-release: posted to #${msg.channel} (${res.status})`)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('notify-slack-release.mjs')) {
  main().catch((err) => console.log(`::warning::notify-slack-release failed: ${err instanceof Error ? err.message : err}`))
}
