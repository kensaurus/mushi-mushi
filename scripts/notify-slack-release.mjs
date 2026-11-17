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
 * Env (from repo secrets; a missing one skips quietly):
 *   SLACK_RELEASES_WEBHOOK_URL, SLACK_ALERTS_WEBHOOK_URL
 *   JOB_STATUS   ${{ job.status }}: success | failure | cancelled
 *   WHAT         what was deployed: "Admin console", "Edge functions", "Docs site", "npm packages"
 *   VERSION      optional version shown after WHAT
 *   DETAIL       optional line that replaces the commit subject (e.g. the packages published)
 * Never prints the webhook URL. Never fails the job: every error exits 0 with a warning.
 */
import { execFileSync } from 'node:child_process'

const APP = 'Mushi Mushi'

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
    const body = `Nothing new went live from this run; the previous version is still serving. Open the run to see which step failed.${commitSubject ? `\nCommit: ${commitSubject.slice(0, 200)}` : ''}`
    return { channel: 'alerts', payload: payload(headline, body, '#ef4444', runUrl) }
  }
  return null
}

function payload(headline, body, color, runUrl) {
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `*${headline}*${body ? `\n${body}` : ''}` } }]
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'production · GitHub Actions' }] })
  if (runUrl) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the run' }, url: runUrl }] })
  return { text: headline, attachments: [{ color, blocks }] }
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
  const msg = buildReleaseMessage({
    status: env.JOB_STATUS,
    what: env.WHAT || 'Deploy',
    version: env.VERSION || '',
    detail: env.DETAIL || '',
    commitSubject: commitSubject(),
    runUrl,
  })
  if (!msg) return
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
