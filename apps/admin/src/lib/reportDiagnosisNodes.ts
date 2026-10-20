/**
 * FILE: apps/admin/src/lib/reportDiagnosisNodes.ts
 * PURPOSE: One builder per lane of the diagnosis graph. Every field is read
 *          defensively: the report row is model output and may be partial.
 */

import { reportDiagnosisView } from './reportDiagnosis'
import { humanizeFixError } from './humanizeFixError'
import { DIAGNOSIS_ANCHORS, NEEDS_LOOK_BELOW, headline, type DiagnosisNode } from './reportDiagnosisModel'
import type { ReportDetail, ReportFixAttempt } from '../components/report-detail/types'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function pathOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname || '/'
  } catch {
    return null
  }
}

/** `grok-4.7?reasoning_effort=xhigh` → `grok-4.7`. */
function modelName(model: string | null | undefined): string | null {
  const m = text(model)
  return m ? m.split('?')[0] : null
}

function reportSource(report: ReportDetail): { title: string; detail: string } {
  const src = text((report as { source?: unknown }).source)
  const ua = text(report.environment?.userAgent)
  if (src === 'site_watch' || ua === 'site-watch') return { title: 'Found by the live-site watch', detail: 'no user reported it' }
  if (src === 'sentry' || report.sentry_event_id) return { title: 'Imported from Sentry', detail: 'production error' }
  if (src === 'store_review') return { title: 'From an app store review', detail: 'low-star review' }
  if (src === 'voice') return { title: 'Filed by voice', detail: 'transcribed request' }
  if (src === 'ux_loop') return { title: 'Found by a UX run', detail: 'screen check' }
  const who = text(report.reporter_display_name)
  return { title: who ? `Reported by ${who}` : 'Reported by a user', detail: 'bug widget' }
}

export function evidenceNodes(report: ReportDetail): DiagnosisNode[] {
  const nodes: DiagnosisNode[] = []
  const src = reportSource(report)
  const page = pathOf(report.environment?.url)
  const description = text(report.description) ?? 'No description.'
  nodes.push({
    id: 'report',
    lane: 'evidence',
    title: src.title,
    detail: [page, src.detail, report.created_at?.slice(0, 10)].filter(Boolean).join(' · '),
    state: 'observed',
    confidence: null,
    needsLook: false,
    why: description.length > 400 ? `${description.slice(0, 400)}…` : description,
    source: 'reports.description',
    anchor: DIAGNOSIS_ANCHORS.userReport,
  })

  const consoleLogs = Array.isArray(report.console_logs) ? report.console_logs : null
  const network = Array.isArray(report.network_logs) ? report.network_logs : null
  const perf = isObject(report.performance_metrics) ? report.performance_metrics : null
  const perfKeys = perf ? ['lcp', 'inp', 'cls', 'fcp', 'ttfb'].filter((k) => num(perf[k]) != null || num(perf[k.toUpperCase()]) != null) : []

  if (!consoleLogs && !network && perfKeys.length === 0) {
    nodes.push({
      id: 'browser',
      lane: 'evidence',
      title: 'No browser evidence captured',
      detail: 'no console, network or web vitals',
      state: 'observed',
      confidence: null,
      needsLook: false,
      why: 'The report arrived without console logs, network requests or web vitals, so the diagnosis rests on the description and the code. A report from the bug widget in your app carries this evidence.',
      source: 'console_logs · network_logs · performance_metrics',
    })
  } else {
    if (consoleLogs) {
      const errors = consoleLogs.filter((l) => l.level === 'error').length
      const warns = consoleLogs.filter((l) => l.level === 'warn' || l.level === 'warning').length
      const firstError = consoleLogs.find((l) => l.level === 'error')
      nodes.push({
        id: 'console',
        lane: 'evidence',
        title: errors > 0 ? plural(errors, 'console error', 'console errors') : 'No console errors',
        detail: `${plural(consoleLogs.length, 'log line', 'log lines')}${warns ? ` · ${plural(warns, 'warning', 'warnings')}` : ''}`,
        state: 'observed',
        confidence: null,
        needsLook: false,
        why: firstError ? `First error: ${headline(firstError.message, 240)}` : 'The browser logged no errors around the report.',
        source: 'console_logs',
        anchor: DIAGNOSIS_ANCHORS.console,
      })
    }
    if (network) {
      const failed = network.filter((r) => r.status >= 400 || r.status === 0 || Boolean(r.error))
      nodes.push({
        id: 'network',
        lane: 'evidence',
        title: failed.length > 0 ? plural(failed.length, 'failed request', 'failed requests') : 'No failed requests',
        detail: plural(network.length, 'request', 'requests'),
        state: 'observed',
        confidence: null,
        needsLook: false,
        why: failed[0] ? `First failure: ${failed[0].method} ${pathOf(failed[0].url) ?? failed[0].url} → ${failed[0].status || failed[0].error}` : 'Every captured request succeeded.',
        source: 'network_logs',
        anchor: DIAGNOSIS_ANCHORS.network,
      })
    }
    if (perf && perfKeys.length > 0) {
      const parts = perfKeys.slice(0, 3).map((k) => {
        const v = num(perf[k]) ?? num(perf[k.toUpperCase()]) ?? 0
        return `${k.toUpperCase()} ${k === 'cls' ? v.toFixed(2) : `${Math.round(v)} ms`}`
      })
      nodes.push({
        id: 'perf',
        lane: 'evidence',
        title: 'Web vitals captured',
        detail: parts.join(' · '),
        state: 'observed',
        confidence: null,
        needsLook: false,
        why: `Measured on the page when the report was sent: ${parts.join(', ')}.`,
        source: 'performance_metrics',
        anchor: DIAGNOSIS_ANCHORS.performance,
      })
    }
  }
  if (report.screenshot_url) {
    nodes.push({
      id: 'screenshot',
      lane: 'evidence',
      title: 'Screenshot attached',
      detail: 'what the user saw',
      state: 'observed',
      confidence: null,
      needsLook: false,
      why: 'The reporter sent a screenshot; the vision pass reads it alongside the description.',
      source: 'screenshot_url',
    })
  }
  const sentryLinks = Array.isArray(report.sentry_links) ? report.sentry_links.length : 0
  if (report.sentry_issue_url || sentryLinks > 0) {
    nodes.push({
      id: 'sentry',
      lane: 'evidence',
      title: sentryLinks > 1 ? plural(sentryLinks, 'linked Sentry issue', 'linked Sentry issues') : 'Linked Sentry issue',
      detail: text(report.sentry_release) ?? 'production error',
      state: 'observed',
      confidence: null,
      needsLook: false,
      why: 'Sentry captured this error in production; its stack and breadcrumbs feed the diagnosis.',
      source: 'sentry_links · sentry_issue_url',
      href: report.sentry_issue_url ?? undefined,
    })
  }
  return nodes
}

export function signalNodes(report: ReportDetail): DiagnosisNode[] {
  const nodes: DiagnosisNode[] = []
  const s1 = isObject(report.stage1_classification) ? report.stage1_classification : null
  if (s1) {
    const symptom = text(s1.symptom) ?? text(s1.actual) ?? text(report.summary) ?? 'Symptom not stated'
    const confidence = num(s1.confidence)
    const expected = text(s1.expected)
    const actual = text(s1.actual)
    nodes.push({
      id: 'symptom',
      lane: 'signal',
      title: `Symptom: ${headline(symptom, 90)}`,
      detail: [text(s1.category) ?? report.category, text(s1.severity) ?? report.severity, modelName(report.stage1_model) ?? 'fast filter'].filter(Boolean).join(' · '),
      state: confidence != null && confidence < NEEDS_LOOK_BELOW ? 'weak' : 'ok',
      confidence,
      needsLook: confidence != null && confidence < NEEDS_LOOK_BELOW,
      why: [expected && `Expected: ${expected}.`, actual && `Actual: ${actual}.`].filter(Boolean).join(' ') || symptom,
      source: 'stage1_classification',
      anchor: DIAGNOSIS_ANCHORS.classification,
    })
  }

  const s2 = isObject(report.stage2_analysis) ? report.stage2_analysis : null
  const calls = s2 && Array.isArray(s2.mcp_tool_calls) ? (s2.mcp_tool_calls as Array<Record<string, unknown>>) : []
  const similar = calls.find((c) => c.toolName === 'get_similar_bugs')
  if (similar) {
    const n = num(similar.resultCount) ?? 0
    nodes.push({
      id: 'similar',
      lane: 'signal',
      title: n === 0 ? 'No similar bug on file' : `${plural(n, 'similar bug', 'similar bugs')} found`,
      detail: 'searched past reports',
      state: 'observed',
      confidence: null,
      needsLook: false,
      why: n === 0
        ? 'Mushi looked for look-alike reports and found none, so the diagnosis rests on this report alone.'
        : `Mushi found ${plural(n, 'earlier report', 'earlier reports')} with the same shape and used them as context.`,
      source: 'stage2_analysis.mcp_tool_calls',
    })
  }
  const ctx = s2 && isObject(s2.code_context) ? s2.code_context : null
  if (ctx) {
    const files = num(ctx.fileCount) ?? 0
    const grounded = ctx.status === 'ok' && files > 0
    nodes.push({
      id: 'code',
      lane: 'signal',
      title: grounded ? `Read ${plural(files, 'file', 'files')} of your code` : 'Code not searched',
      detail: grounded ? 'indexed repository' : String(ctx.status ?? 'no index').replace(/_/g, ' '),
      state: grounded ? 'ok' : 'weak',
      confidence: null,
      needsLook: !grounded,
      why: grounded
        ? 'The diagnosis was grounded in the files your repository index returned for this symptom.'
        : 'The diagnosis was written without reading your code. Index the repository (Connect › GitHub) so the next diagnosis can name a file.',
      source: 'stage2_analysis.code_context',
    })
  }
  return nodes
}

export function diagnosisNodes(report: ReportDetail): DiagnosisNode[] {
  const view = reportDiagnosisView(report)
  if (view.kind === 'full' || view.kind === 'streaming') {
    const d = view.diagnosis
    const pending = view.kind === 'streaming'
    const weak = d.confidence != null && d.confidence < NEEDS_LOOK_BELOW
    const nodes: DiagnosisNode[] = []
    nodes.push({
      id: 'cause',
      lane: 'diagnosis',
      title: d.rootCause ? `Root cause: ${headline(d.rootCause, 100)}` : 'Root cause not stated',
      detail: [d.confidence != null ? `confidence ${Math.round(d.confidence * 100)}%` : null, modelName(d.model)].filter(Boolean).join(' · ') || 'deep diagnosis',
      state: pending ? 'pending' : weak || !d.rootCause ? 'weak' : 'ok',
      confidence: d.confidence,
      needsLook: !pending && (weak || !d.rootCause),
      why: d.rootCause ?? 'The deep diagnosis did not state a root cause.',
      source: 'stage2_analysis.rootCause',
      anchor: DIAGNOSIS_ANCHORS.diagnosis,
    })
    if (d.component) {
      const pointsAtCode = /[/.]/.test(d.component)
      nodes.push({
        id: 'component',
        lane: 'diagnosis',
        title: `Where: ${headline(d.component, 80)}`,
        detail: pointsAtCode ? 'file or function' : 'area of the app',
        state: pending ? 'pending' : weak || !pointsAtCode ? 'weak' : 'ok',
        confidence: d.confidence,
        needsLook: !pending && (weak || !pointsAtCode),
        why: pointsAtCode
          ? `The fix most likely goes in ${d.component}.`
          : `"${d.component}" names an area, not a file, so a fix agent may not find the code to change.`,
        source: 'stage2_analysis.component',
        anchor: DIAGNOSIS_ANCHORS.diagnosis,
      })
    }
    if (d.suggestedFix) {
      nodes.push({
        id: 'fixdir',
        lane: 'diagnosis',
        title: `Suggested fix: ${headline(d.suggestedFix, 90)}`,
        detail: 'in the fix prompt',
        state: pending ? 'pending' : 'ok',
        confidence: null,
        needsLook: false,
        why: d.suggestedFix,
        source: 'stage2_analysis.suggestedFix',
        anchor: DIAGNOSIS_ANCHORS.diagnosis,
      })
    }
    return nodes
  }
  const base = { id: 'cause', lane: 'diagnosis' as const, confidence: report.confidence ?? null, source: 'stage2_analysis', anchor: DIAGNOSIS_ANCHORS.diagnosis }
  if (view.kind === 'failed') {
    return [{ ...base, title: 'Diagnosis failed', detail: 'deep diagnosis did not finish', state: 'failed', needsLook: true, why: view.message }]
  }
  if (view.kind === 'stage1_only') {
    return [{ ...base, title: 'Fast filter was confident; no deep diagnosis', detail: 'stage 1 only', state: 'ok', needsLook: false, why: 'The fast filter classified this report with enough confidence that the deep diagnosis was skipped. Run it from the classification card if you want a root cause.' }]
  }
  return [{ ...base, title: 'Diagnosis in progress', detail: 'usually under a minute', state: 'pending', needsLook: false, why: 'Mushi is still reading this report.' }]
}

export function checkNodes(report: ReportDetail): DiagnosisNode[] {
  const nodes: DiagnosisNode[] = []
  const judge = report.judge_eval
  if (judge) {
    const score = num(judge.judge_score)
    const agreed = judge.classification_agreed !== false
    nodes.push({
      id: 'judge',
      lane: 'check',
      title: agreed ? 'Judge agrees with the triage' : 'Judge disagrees with the triage',
      detail: score != null ? `score ${Math.round(score * 100)}%` : 'second model',
      state: agreed && (score == null || score >= NEEDS_LOOK_BELOW) ? 'ok' : 'weak',
      confidence: score,
      needsLook: !agreed || (score != null && score < NEEDS_LOOK_BELOW),
      why: text(judge.judge_reasoning) ?? 'A second model graded the category, severity, component and repro steps.',
      source: 'judge_eval',
    })
  } else {
    nodes.push({
      id: 'judge',
      lane: 'check',
      title: 'Not graded yet',
      detail: 'judge runs on a sample',
      state: 'pending',
      confidence: null,
      needsLook: false,
      why: 'A second model grades a sample of triaged reports (category, severity, component, repro). This one has not been graded yet.',
      source: 'judge_eval',
    })
  }
  const view = reportDiagnosisView(report)
  const steps = view.kind === 'full' || view.kind === 'streaming' ? view.diagnosis.reproductionSteps : []
  if (view.kind === 'full' || view.kind === 'streaming') {
    nodes.push({
      id: 'repro',
      lane: 'check',
      title: steps.length > 0 ? plural(steps.length, 'reproduction step', 'reproduction steps') : 'No reproduction steps',
      detail: steps.length > 0 ? 'how to see it happen' : 'a fix cannot be proven by replay',
      state: steps.length > 0 ? 'ok' : 'weak',
      confidence: null,
      needsLook: steps.length === 0,
      why: steps.length > 0 ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'Without steps, nobody can confirm the fix by replaying the bug.',
      source: 'stage2_analysis.reproductionSteps',
      anchor: DIAGNOSIS_ANCHORS.diagnosis,
    })
  }
  return nodes
}

function attemptNode(attempts: ReportFixAttempt[]): DiagnosisNode {
  const latest = attempts[0]
  const who = [latest.agent, modelName(latest.llm_model)].filter(Boolean).join(' · ') || 'fix agent'
  const more = attempts.length > 1 ? ` · ${plural(attempts.length, 'attempt', 'attempts')}` : ''
  const base = { id: 'attempt', lane: 'fix' as const, confidence: null, source: 'fix_attempts', detail: `${who}${more}` }
  if (latest.pr_state === 'merged' || latest.merged_at) {
    return { ...base, title: `Fix merged${latest.pr_number ? ` (PR #${latest.pr_number})` : ''}`, state: 'done', needsLook: false, why: `The fix landed${latest.files_changed?.length ? ` and changed ${plural(latest.files_changed.length, 'file', 'files')}` : ''}.`, href: latest.pr_url ?? undefined }
  }
  if (latest.pr_url) {
    return { ...base, title: `Pull request ${latest.pr_number ? `#${latest.pr_number} ` : ''}opened`, state: 'ok', needsLook: false, why: `The agent opened a draft pull request${latest.files_changed?.length ? ` touching ${plural(latest.files_changed.length, 'file', 'files')}` : ''}. Review it, then merge from the Fixes page.`, href: latest.pr_url }
  }
  if (latest.status === 'failed' || latest.status.startsWith('skipped')) {
    const human = humanizeFixError(latest.error)
    const title = latest.status.startsWith('skipped') ? 'Fix not attempted' : 'Agent stopped without a pull request'
    return { ...base, title, state: 'failed', needsLook: true, why: human ? `${human.title} ${human.hint}`.trim() : latest.error ?? 'The fix attempt ended without a pull request.' }
  }
  return { ...base, title: 'Fix in progress', state: 'pending', needsLook: false, why: 'A coding agent is drafting the fix; this updates when it opens a pull request or stops.' }
}

export function fixNodes(report: ReportDetail, diagnosisReady: boolean): DiagnosisNode[] {
  const attempts = Array.isArray(report.fix_attempts) ? report.fix_attempts : []
  const nodes: DiagnosisNode[] = []
  if (attempts.length > 0) nodes.push(attemptNode(attempts))
  const status = (report.status ?? '').toLowerCase()
  const latest = nodes[0]
  let next: Pick<DiagnosisNode, 'title' | 'detail' | 'why' | 'state'> | null = null
  if (status === 'verified') next = { title: 'Verified in production', detail: 'loop closed', why: 'The fix shipped and the bug did not come back.', state: 'done' }
  else if (status === 'fixed' || latest?.state === 'done') next = { title: 'Check it in production', detail: 'next step', why: 'The fix merged. Watch for the bug to come back; Mushi reopens the report if it does.', state: 'open' }
  else if (latest?.state === 'ok') next = { title: 'Review and merge the pull request', detail: 'next step', why: 'Read the diff and the CI result, then merge from the Fixes page or GitHub.', state: 'open' }
  else if (latest?.state === 'failed') next = { title: 'Check the weak spots, then retry', detail: 'next step', why: 'Look at the marked nodes first: a vague component or missing repro steps usually stop the agent. Fix those in the triage bar, then dispatch again or paste the fix prompt into your editor.', state: 'open' }
  else if (!latest && diagnosisReady && status !== 'dismissed') next = { title: 'Fix it: dispatch or paste the prompt', detail: 'next step', why: 'Copy the fix prompt into your coding agent, or dispatch a cloud agent from "Fix it with your coding agent".', state: 'open' }
  if (next) nodes.push({ id: 'next', lane: 'fix', confidence: null, needsLook: false, source: 'status · fix_attempts', anchor: DIAGNOSIS_ANCHORS.diagnosis, ...next })
  return nodes
}
