// SPDX-License-Identifier: MIT
/**
 * What a fresh-eyes run leaves behind (ADR 0051): a timeline a person can
 * read (timeline.md next to the screenshots), the run mirrored to the console
 * (`--sync`), its findings filed as `fresh_eyes` reports (`--file`), and a
 * synthetic account minted for Mushi itself (`--mint-account`).
 *
 * Everything that leaves the machine was redacted by runFreshEyes: identity
 * values are placeholders by now. The model's prompts and answers stay in the
 * run folder (ask/).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FreshEyesFinding, FreshEyesResult, FreshEyesSession, Identity, StallReason } from './fresh-eyes.js'
import type { SyncConfig } from './sync.js'

const STALL_TEXT: Record<StallReason, string> = {
  signup_wall: 'stopped at a sign-in wall it could not pass',
  captcha: 'stopped at a captcha (never solved)',
  external: 'stopped at a step that needs something outside the app',
  dead_end: 'stopped at a dead end',
  blocked: 'stopped at a refused request',
  error: 'stopped on an error',
  model_gave_up: 'gave up (the model did not know what to do)',
  model_unavailable: 'stopped because the model did not answer (not the app)',
  out_of_steps: 'ran out of steps',
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Pure: one session as a readable timeline. */
function sessionMarkdown(s: FreshEyesSession): string[] {
  const head =
    s.outcome === 'reached'
      ? `### Session ${s.index}: reached the goal in ${s.steps.length - 1} steps, ${s.ttfvSeconds} s to first value`
      : `### Session ${s.index}: ${STALL_TEXT[s.stall?.reason ?? 'out_of_steps']} at ${s.stall?.screen ?? '?'} (step ${s.stall?.step ?? '?'})`
  const lines = [
    head,
    '',
    `App time ${s.appSeconds} s, reading ${s.readSeconds} s, model think time ${s.modelSeconds} s (not counted), ${s.backtracks} backtrack(s).`,
    s.stall ? `Why it stopped: ${s.stall.detail}` : '',
    '',
    '| # | Step | Screen | App wait | Reading | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const st of s.steps) {
    const notes = [
      st.outcome !== 'ok' ? st.outcome : '',
      st.note ?? '',
      st.backtrack ? 'backtrack' : '',
      st.deadEnd ? 'dead end' : '',
      st.requirements?.length ? `needs: ${st.requirements.join(', ')}` : '',
      st.signals?.length ? `signals: ${st.signals.join(', ')}` : '',
      st.opinion ? `felt ${st.opinion.category}: ${st.opinion.why}` : '',
      st.shot ? `[shot](shots/${st.shot})` : '',
    ]
      .filter(Boolean)
      .join('; ')
      .replace(/\|/g, '/')
    lines.push(`| ${st.n} | ${st.action.replace(/\|/g, '/')} | ${st.screen} | ${secs(st.appMs)} | ${secs(st.readMs)} | ${notes} |`)
  }
  return lines
}

/** @internal Exported for tests only. Pure: the run's timeline.md. */
export function timelineMarkdown(r: FreshEyesResult): string {
  const lines = [
    `# Fresh-eyes run ${r.runId}`,
    '',
    `Goal: "${r.goal}" from ${r.startUrl}. Model ${r.model}. ${r.sessions.length} session(s), ${r.hasAccount ? 'with a synthetic account' : 'no account'}${r.dryRun ? ', dry run (read-only, nothing filed)' : ''}.`,
    '',
    `- Reached the goal: ${r.reached} of ${r.sessions.length}`,
    `- Time to first value (median of sessions that reached it): ${r.ttfvSeconds == null ? 'not reached' : `${r.ttfvSeconds} s`}`,
    `- Steps (median): ${r.steps}`,
    r.stalledAt ? `- Most sessions stalled at ${r.stalledAt.screen}: ${STALL_TEXT[r.stalledAt.reason]} (${r.stalledAt.sessions} session(s))` : '- No session stalled',
    `- Requests refused by the guard: ${r.blocked}; clicks refused: ${r.refused.length}`,
    ...r.warnings.map((w) => `- Note: ${w}`),
    '',
    '## Findings',
    '',
    ...(r.findings.length ? r.findings.map((f) => `- **${f.severity}** (${f.basis}, sessions ${f.sessions.join(', ')}) ${f.summary}`) : ['None.']),
    '',
    '## Timelines',
    '',
  ]
  for (const s of r.sessions) lines.push(...sessionMarkdown(s), '')
  return lines.join('\n')
}

export function writeTimeline(r: FreshEyesResult): string {
  const path = join(r.dir, 'timeline.md')
  writeFileSync(path, timelineMarkdown(r))
  return path
}

// ── Console ─────────────────────────────────────────────────────────────────

function headers(cfg: SyncConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.apiKey}`, 'X-Mushi-Api-Key': cfg.apiKey, 'X-Mushi-Project': cfg.projectId, 'Content-Type': 'application/json' }
}

async function call(cfg: SyncConfig, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${cfg.endpoint}${path}`, { method, headers: headers(cfg), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | null
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
  return json.data
}

/** @internal Exported for tests only. Pure: the run as the console stores it (ux_runs, kind fresh_eyes). */
export function runSnapshot(r: FreshEyesResult, status: 'running' | 'done' | 'failed', cliVersion: string | null): Record<string, unknown> {
  return {
    status,
    goal: r.goal.slice(0, 300),
    start_url: r.startUrl.slice(0, 500),
    model: r.model,
    dry_run: r.dryRun,
    has_account: r.hasAccount,
    started_at: r.startedAt,
    finished_at: status === 'running' ? null : r.finishedAt || new Date().toISOString(),
    ttfv_seconds: r.ttfvSeconds,
    steps: r.steps,
    reached: r.reached,
    stalled_at: r.stalledAt ? { ...r.stalledAt, screen: r.stalledAt.screen.slice(0, 300) } : null,
    // The console keeps at most 50 findings and 20 signals a step: a noisy page must not fail the whole sync.
    findings: r.findings.slice(0, 50).map((f) => ({ fingerprint: f.fingerprint, severity: f.severity, basis: f.basis, summary: f.summary.slice(0, 300), sessions: f.sessions })),
    sessions: r.sessions.slice(0, 10).map((s) => ({
      index: s.index,
      outcome: s.outcome,
      stall: s.stall ? { ...s.stall, screen: s.stall.screen.slice(0, 300), detail: s.stall.detail.slice(0, 300) } : null,
      ttfv_seconds: s.ttfvSeconds,
      app_seconds: s.appSeconds,
      read_seconds: s.readSeconds,
      model_seconds: s.modelSeconds,
      backtracks: s.backtracks,
      steps: s.steps.slice(0, 120).map((st) => ({
        n: st.n,
        action: st.action.slice(0, 300),
        path: st.path.slice(0, 500),
        screen: st.screen.slice(0, 300),
        model_ms: st.modelMs,
        app_ms: st.appMs,
        read_ms: st.readMs,
        outcome: st.outcome,
        note: st.note?.slice(0, 300) ?? null,
        opinion: st.opinion ?? null,
        backtrack: !!st.backtrack,
        dead_end: !!st.deadEnd,
        requirements: [...new Set(st.requirements ?? [])].slice(0, 4),
        signals: [...new Set(st.signals ?? [])].slice(0, 20),
        shot: st.shot ?? null,
      })),
    })),
    cli_version: cliVersion,
  }
}

/** Mirror the run to the console: the snapshot, then its screenshots. Returns an error message or null. */
export async function syncFreshEyes(cfg: SyncConfig, r: FreshEyesResult, cliVersion: string | null): Promise<string | null> {
  const base = `/v1/admin/projects/${cfg.projectId}/fresh-eyes/${r.runId}`
  try {
    await call(cfg, 'PUT', base, runSnapshot(r, 'running', cliVersion))
    const shots = r.sessions.flatMap((s) => s.steps.map((st) => st.shot).filter((x): x is string => !!x))
    for (let i = 0; i < shots.length; i += 40) {
      const batch = shots.slice(i, i + 40)
      const data = (await call(cfg, 'POST', `${base}/uploads`, { names: batch })) as { uploads: Array<{ name: string; signedUrl: string }> }
      for (const u of data.uploads) {
        const put = await fetch(u.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png', 'x-upsert': 'true' },
          body: new Uint8Array(readFileSync(join(r.dir, 'shots', u.name))),
          signal: AbortSignal.timeout(60_000),
        })
        if (!put.ok) throw new Error(`screenshot upload failed (HTTP ${put.status})`)
      }
    }
    await call(cfg, 'PUT', base, runSnapshot(r, 'done', cliVersion))
    return null
  } catch (err) {
    return (err as Error).message
  }
}

/** @internal Exported for tests only. Pure: the report a finding files (`reports.source = 'fresh_eyes'`). */
export function findingBody(f: FreshEyesFinding, r: Pick<FreshEyesResult, 'startUrl' | 'runId'>): Record<string, unknown> {
  const description = [
    `Screen: ${f.screen} (start: ${r.startUrl})`,
    `Seen in session(s) ${f.sessions.join(', ')} of fresh-eyes run ${r.runId}.`,
    '',
    `What happens: ${f.summary}.`,
    '',
    'Steps:',
    ...f.evidence.map((e) => `- ${e}`),
    '',
    `Expected: ${f.expected}`,
    `Done when: ${f.doneWhen}`,
    '',
    f.foundBy ?? '',
  ].join('\n')
  return { fingerprint: f.fingerprint, rule: f.rule, basis: f.basis, title: `${f.screen}: ${f.summary}`.slice(0, 200), description: description.slice(0, 10_000), severity: f.severity, component: f.screen.slice(0, 200) }
}

export interface FreshFileOutcome {
  filed: Array<{ fingerprint: string; reportId: string; title: string }>
  skipped: Array<{ fingerprint: string; reason: string }>
  pending: Array<Record<string, unknown>>
}

/** At most this many reports a run. */
const FRESH_EYES_FILE_CAP = 15

/** File findings through the console (deduped there by fingerprint). With no credentials or `dryRun`, return them as pending. */
export async function fileFreshEyesFindings(cfg: SyncConfig | null, r: FreshEyesResult, dryRun: boolean): Promise<FreshFileOutcome> {
  const out: FreshFileOutcome = { filed: [], skipped: [], pending: [] }
  for (const f of r.findings) {
    if (out.filed.length + out.pending.length >= FRESH_EYES_FILE_CAP) {
      out.skipped.push({ fingerprint: f.fingerprint, reason: `cap of ${FRESH_EYES_FILE_CAP} reached` })
      continue
    }
    const body = findingBody(f, r)
    if (dryRun || !cfg) {
      out.pending.push(body)
      continue
    }
    try {
      const data = (await call(cfg, 'POST', `/v1/admin/projects/${cfg.projectId}/fresh-eyes/${r.runId}/findings`, body)) as { reportId: string | null; duplicateOf?: string | null }
      if (data.reportId) out.filed.push({ fingerprint: f.fingerprint, reportId: data.reportId, title: String(body.title) })
      else out.skipped.push({ fingerprint: f.fingerprint, reason: `an open report has it (${data.duplicateOf ?? 'unknown'})` })
    } catch (err) {
      out.skipped.push({ fingerprint: f.fingerprint, reason: (err as Error).message.slice(0, 200) })
    }
  }
  return out
}

/** A synthetic account for Mushi itself (operator only). The password is returned once and never printed. */
export async function mintTestAccount(cfg: SyncConfig): Promise<Identity> {
  const data = (await call(cfg, 'POST', '/v1/admin/fresh-eyes/test-account', { purpose: 'fresh_eyes' })) as { email: string; password: string; name?: string }
  if (!data?.email || !data?.password) throw new Error('The console did not return an account.')
  return { email: data.email, password: data.password, name: data.name }
}
