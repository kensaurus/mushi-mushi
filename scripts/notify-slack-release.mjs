#!/usr/bin/env node
/**
 * FILE: scripts/notify-slack-release.mjs
 * PURPOSE: Tell the Kensaurus Slack what shipped (2026-11-17), through the Mushi Mushi
 *          Ops hub first (2026-11-18). The last step of each production deploy job runs it:
 *            - job succeeded → #releases: "Mushi Mushi · 🚀 Admin console 0.1.680 is live" + the
 *              commit subject + a button to the run
 *            - job failed    → #alerts:   "Mushi Mushi · 🔴 Admin console deploy failed" + what that
 *              means + a button to the run
 *
 *          1. MUSHI_OPS_KEY + an https MUSHI_API_URL set → an Ops event to Mushi Mushi's own
 *             project (releases/deploy.succeeded, no thread; or alerts/urgent/deploy.failed
 *             threaded on `deploy:<repo>:production`), posted by the team bot. 200/202 → done.
 *             422 (the free text read as personal data) → sent once more without the body,
 *             never to Slack. Anything else → step 2.
 *          2. The Slack incoming webhook exactly as before.
 *
 * Env (from repo secrets; a missing one skips quietly):
 *   MUSHI_OPS_KEY, MUSHI_API_URL   Ops hub (optional)
 *   SLACK_RELEASES_WEBHOOK_URL, SLACK_ALERTS_WEBHOOK_URL
 *   JOB_STATUS   ${{ job.status }}: success | failure | cancelled
 *   WHAT         what was deployed: "Admin console", "Edge functions", "Docs site", "npm packages"
 *   VERSION      optional version shown after WHAT
 *   DETAIL       optional line that replaces the commit subject (e.g. the packages published)
 * Never prints the key or the webhook URL. Never fails the job: every error exits 0 with a warning.
 */
import { execFileSync } from 'node:child_process'

const APP = 'Mushi Mushi'
const FAILED_BODY = 'Nothing new went live from this run; the previous version is still serving. Open the run to see which step failed.'

/** @internal Exported for tests. The Slack payload for one deploy result, or null when there is nothing to say. */
export function buildReleaseMessage({ status, what, version, detail, commitSubject, runUrl }) {
  const label = `${what}${version ? ` ${version}` : ''}`
  if (status === 'success') {
    const headline = `${APP} · 🚀 ${label} is live`
    return {
      channel: 'releases',
      payload: payload(headline, (detail || commitSubject || '').slice(0, 300), '#22c55e', runUrl),
    }
  }
  if (status === 'failure') {
    const headline = `${APP} · 🔴 ${what} deploy failed`
    const body = `${FAILED_BODY}${commitSubject ? `\nCommit: ${commitSubject.slice(0, 200)}` : ''}`
    return { channel: 'alerts', payload: payload(headline, body, '#ef4444', runUrl) }
  }
  return null
}

/**
 * @internal Exported for tests. The Ops event (POST /v1/ops/events body) for one deploy
 * result, or null when there is nothing to say. Only keys the strict server schema knows;
 * no app name in the title (the key names the app); never `resolved` (the public route
 * cannot resolve only an open thread, so CI would post a stray "fixed" after every deploy).
 */
export function toOpsEvent({ status, what, version, detail, commitSubject, runUrl, repo, runId, runAttempt, job, workflow, shortSha }) {
  if (status !== 'success' && status !== 'failure') return null
  const ok = status === 'success'
  const npm = /\bnpm\b/i.test(what)
  const label = `${what}${version ? ` ${version}` : ''}`
  const ev = ok
    ? { category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: npm ? 'New packages reached npm' : `${label} is live` }
    : { category: 'alerts', severity: 'urgent', kind: 'deploy.failed', title: `${what} deploy failed`, thread_key: `deploy:${repo}:production` }
  ev.title = ev.title.slice(0, 150)
  const body = ok ? detail || commitSubject || '' : FAILED_BODY
  if (body) ev.body = body.slice(0, 600)
  const facts = [
    [npm ? 'Registry' : 'Environment', npm ? 'npm' : 'production'],
    ['Workflow', workflow],
    ['Commit', shortSha],
  ]
    .filter(([, v]) => v)
    .map(([label, v]) => ({ label, value: String(v).slice(0, 200) }))
  if (facts.length > 0) ev.facts = facts
  if (typeof runUrl === 'string' && runUrl.startsWith('https://')) ev.url = runUrl
  ev.dedupe_key = `gh-run:${repo}:${runId}:${runAttempt}:${job}`.slice(0, 200)
  return ev
}

/** @internal Exported for tests. The Ops endpoint for an https MUSHI_API_URL, or null. */
export function opsEndpoint(apiUrl) {
  const base = String(apiUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) return null
  try {
    return new URL(base).protocol === 'https:' ? `${base}/v1/ops/events` : null
  } catch {
    return null
  }
}

function payload(headline, body, color, runUrl) {
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `*${headline}*${body ? `\n${body}` : ''}` } }]
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'production · GitHub Actions' }] })
  if (runUrl) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the run' }, url: runUrl }] })
  return { text: headline, attachments: [{ color, blocks }] }
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function postJson(fetchImpl, url, headers, body) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    return res.status
  } catch {
    return 0
  }
}

/**
 * @internal Exported for tests. Send one deploy result: 'ops' | 'ops-without-body' | 'slack' | 'skipped'.
 * Never throws.
 */
export async function notifyRelease(env, { fetchImpl = fetch, log = console.log, commitSubject = '', shortSha = '' } = {}) {
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : ''
  const input = {
    status: env.JOB_STATUS,
    what: env.WHAT || 'Deploy',
    version: env.VERSION || '',
    detail: env.DETAIL || '',
    commitSubject,
    runUrl,
  }
  const msg = buildReleaseMessage(input)
  if (!msg) return 'skipped'

  const key = String(env.MUSHI_OPS_KEY ?? '').trim()
  const endpoint = opsEndpoint(env.MUSHI_API_URL)
  if (key && endpoint) {
    const ev = toOpsEvent({
      ...input,
      repo: env.GITHUB_REPOSITORY || '',
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      job: env.GITHUB_JOB,
      workflow: env.GITHUB_WORKFLOW,
      shortSha,
    })
    const headers = { 'X-Mushi-Api-Key': key }
    const code = await postJson(fetchImpl, endpoint, headers, ev)
    if (code === 200 || code === 202) {
      log(`notify-slack-release: Mushi Mushi took the event (${code})`)
      return 'ops'
    }
    if (code === 422) {
      delete ev.body
      const again = await postJson(fetchImpl, endpoint, headers, ev)
      log(`notify-slack-release: Mushi Mushi refused the free text as personal data; resent without it (${again})`)
      return 'ops-without-body'
    }
    log(`notify-slack-release: Mushi Mushi answered ${code || 'nothing'}; using the Slack webhook instead`)
  }

  const url = (msg.channel === 'releases' ? env.SLACK_RELEASES_WEBHOOK_URL : env.SLACK_ALERTS_WEBHOOK_URL) || ''
  if (!url) {
    log(`notify-slack-release: no ${msg.channel} webhook set; skipped`)
    return 'skipped'
  }
  let host = ''
  try {
    host = new URL(url).host
  } catch {}
  if (host !== 'hooks.slack.com') {
    log('::warning::notify-slack-release: the webhook is not a hooks.slack.com URL; skipped')
    return 'skipped'
  }
  const status = await postJson(fetchImpl, url, {}, msg.payload)
  log(`notify-slack-release: posted to #${msg.channel} (${status || 'no answer'})`)
  return status >= 200 && status < 300 ? 'slack' : 'skipped'
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('notify-slack-release.mjs')) {
  notifyRelease(process.env, { commitSubject: git(['log', '-1', '--format=%s']), shortSha: git(['rev-parse', '--short=7', 'HEAD']) }).catch((err) =>
    console.log(`::warning::notify-slack-release failed: ${err instanceof Error ? err.message : err}`),
  )
}
