/**
 * FILE: report-shapes.ts
 * PURPOSE: What the report tools hand an agent, shared by both MCP
 *          transports: the documented projections of a report list row and a
 *          report detail row, the evidence packet, the fix-context slice, and
 *          triage's recommended next actions.
 *
 *          The report routes return every column the console needs, including
 *          ones that identify an end user of the customer's app. Those are
 *          never handed to an agent, with or without includeRaw.
 *
 *          packages/mcp/src/report-shapes.ts and
 *          packages/server/supabase/functions/mcp/report-shapes.ts are
 *          byte-identical — check-catalog-sync.mjs fails if they drift.
 */

type Row = Record<string, unknown>

/** The fields get_recent_reports documents; the list route returns ~30 columns. */
const REPORT_LIST_FIELDS = [
  'id',
  'status',
  'category',
  'severity',
  'summary',
  'component',
  'created_at',
  'processing_error',
] as const

/**
 * Columns (and detail-route joins) that identify the person who filed a
 * report: the host app's user id, the SDK's reporter token and session, a
 * display name, and the end_users / tester rows joined onto the detail.
 */
const REPORTER_IDENTITY_FIELDS = [
  'end_user_id',
  'reporter_token_hash',
  'session_id',
  'reporter_display_name',
  'reporter_user_id',
  'reporter_identity',
  'tester_id',
] as const

/**
 * The fields get_report_detail documents. includeRaw returns every column the
 * detail route has instead (internal telemetry such as llm_invocations,
 * storage paths and custom_metadata), minus the reporter identity fields.
 */
const REPORT_DETAIL_FIELDS = [
  'id',
  'project_id',
  'title',
  'summary',
  'description',
  'status',
  'category',
  'severity',
  'component',
  'area_tag',
  'source',
  'confidence',
  'user_category',
  'user_intent',
  'voice_transcript',
  'created_at',
  'updated_at',
  'fixed_at',
  'verified_at',
  'reopened_at',
  'regressed_at',
  'regression_count',
  'screenshot_url',
  'environment',
  'console_logs',
  'network_logs',
  'performance_metrics',
  'breadcrumbs',
  'repro_timeline',
  'selected_element',
  'tags',
  'app_version',
  'sdk_package',
  'sdk_version',
  'stage1_classification',
  'stage2_analysis',
  'reproduction_steps',
  'bug_ontology_tags',
  'extracted_symptoms',
  'vision_analysis',
  'judge_score',
  'judge_eval',
  'processing_error',
  'fix_branch',
  'fix_pr_url',
  'fix_commit_sha',
  'fix_attempts',
  'fix_packet',
  'inventory_action',
  'sentry_event_id',
  'sentry_trace_id',
  'sentry_replay_id',
  'sentry_issue_url',
  'sentry_release',
  'report_group_id',
  'parent_report_id',
  'child_report_ids',
  'backend_spans',
  'anomalies',
] as const

const IDENTITY: ReadonlySet<string> = new Set(REPORTER_IDENTITY_FIELDS)

/** Backend spans carry the SDK session id of the reporter; keep the span, drop that. */
function spansWithoutSession(spans: unknown): unknown {
  if (!Array.isArray(spans)) return spans
  return spans.map((span) => {
    if (!span || typeof span !== 'object' || Array.isArray(span)) return span
    const { session_id: _session, ...rest } = span as Row
    return rest
  })
}

export function projectReportListRow(row: Row, includeRaw: boolean): Row {
  if (includeRaw) return Object.fromEntries(Object.entries(row).filter(([k]) => !IDENTITY.has(k)))
  const out: Row = {}
  for (const field of REPORT_LIST_FIELDS) {
    if (row[field] !== undefined) out[field] = row[field]
  }
  return out
}

/** A report detail row as an agent sees it: documented fields, or every non-identity column with includeRaw. */
export function projectReportDetail(row: Row, includeRaw: boolean): Row {
  const out: Row = {}
  if (includeRaw) {
    for (const [k, v] of Object.entries(row)) if (!IDENTITY.has(k)) out[k] = v
  } else {
    for (const field of REPORT_DETAIL_FIELDS) if (row[field] !== undefined) out[field] = row[field]
  }
  if (out.backend_spans !== undefined) out.backend_spans = spansWithoutSession(out.backend_spans)
  return out
}

/**
 * The evidence packet get_report_evidence returns: what the reporter saw and
 * what the SDK captured (logs, traces, metrics), without classification or
 * fix history and without reporter identifiers.
 */
export function reportEvidenceOf(report: Row, reportId: string): Row {
  return {
    report_id: reportId,
    title: report.title ?? null,
    summary: report.summary ?? null,
    description: report.description ?? null,
    status: report.status ?? null,
    severity: report.severity ?? null,
    category: report.category ?? null,
    screenshot_url: report.screenshot_url ?? null,
    environment: report.environment ?? null,
    // LOGS
    console_logs: report.console_logs ?? null,
    breadcrumbs: report.breadcrumbs ?? null,
    repro_timeline: report.repro_timeline ?? null,
    // TRACES
    network_requests: report.network_logs ?? null,
    backend_spans: spansWithoutSession(report.backend_spans ?? null),
    sentry_replay_id: report.sentry_replay_id ?? null,
    sentry_trace_id: report.sentry_trace_id ?? null,
    sentry_event_id: report.sentry_event_id ?? null,
    sentry_release: report.sentry_release ?? null,
    // METRICS
    performance_metrics: report.performance_metrics ?? null,
    anomalies: report.anomalies ?? null,
    // context
    tags: report.tags ?? null,
    created_at: report.created_at ?? null,
  }
}

/**
 * The fix-context slice of a report detail row. The report route composes
 * `fix_packet` server-side, so get_fix_context and triage_issue both read it
 * from the report instead of a separate route.
 */
export function fixContextOf(report: Row): Row {
  return {
    // Paste-ready fix prompt composed server-side by composeFixPacket()
    // (diagnosis + repro + suggested fix + relevant code + blast radius).
    fixPrompt: report.fix_packet ?? null,
    reproductionSteps: report.reproduction_steps ?? [],
    component: report.component ?? null,
    rootCause: (report.stage2_analysis as Row | null | undefined)?.rootCause ?? null,
    bugOntologyTags: report.bug_ontology_tags ?? null,
  }
}

/** Free text the similarity route can embed for a report, or null when it has none. */
export function similarityQueryOf(report: Row): string | null {
  for (const field of ['summary', 'description'] as const) {
    const value = report[field]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 2000)
  }
  return null
}

/**
 * Graph node id of the inventory action a report is filed against, as
 * resolved by the report route's get_report_inventory_action RPC.
 */
export function inventoryActionNodeIdOf(report: Row): string | null {
  const anchor = report.inventory_action as { actionNodeId?: unknown } | null | undefined
  return typeof anchor?.actionNodeId === 'string' && anchor.actionNodeId ? anchor.actionNodeId : null
}

export interface TriageAction {
  action: string
  reason: string
  tool?: string
  args?: Row
}

/**
 * triage_issue's recommended next actions, from the report's state. Every
 * `args` object uses the tool's canonical (camelCase) parameter names.
 */
export function triageRecommendedActions(report: Row | null, reportId: string): TriageAction[] {
  if (!report) return []
  const actions: TriageAction[] = []
  const status = typeof report.status === 'string' ? report.status : ''
  // A dispatched-then-skipped/failed fix used to leave the report in
  // 'classified' with no trace, so triage recommended dispatch_fix forever
  // (2026-08-16 audit P0-2). fix-worker stamps processing_error
  // ('autofix_blocked: …') and closes the attempt — surface the blocker.
  const processingError = typeof report.processing_error === 'string' ? report.processing_error : null
  const attempts = Array.isArray(report.fix_attempts) ? (report.fix_attempts as Row[]) : []
  // The detail route orders fix_attempts newest first.
  const latest = attempts[0] ?? null
  const latestStatus = latest ? String(latest.status ?? '') : ''
  const blocked =
    (processingError?.startsWith('autofix_blocked:') ?? false) ||
    latestStatus.startsWith('skipped') ||
    latestStatus === 'failed'

  if (blocked && status !== 'fixing' && status !== 'fixed') {
    const why = processingError || String(latest?.error ?? 'the previous fix attempt was skipped or failed')
    actions.push({
      action: 'unblock_autofix',
      reason: `Auto-fix is blocked: ${why}. Resolve the blocker (settings/integration/budget), then re-dispatch.`,
      tool: 'diagnose_setup',
      args: { mode: 'dispatch' },
    })
    actions.push({
      action: 'redispatch_after_unblock',
      reason: 'Once the blocker above is resolved, dispatch a fresh fix attempt.',
      tool: 'dispatch_fix',
      args: { reportId },
    })
  } else if (status === 'new' || status === 'classified' || status === 'triaged' || status === 'reopened') {
    actions.push({
      action: 'dispatch_fix',
      reason: 'The report is classified and has no fix in flight.',
      tool: 'dispatch_fix',
      args: { reportId },
    })
  } else if (status === 'fixing') {
    actions.push(
      typeof latest?.id === 'string'
        ? {
            action: 'check_fix_progress',
            reason: 'A fix is in progress — check its timeline.',
            tool: 'get_fix_timeline',
            args: { fixId: latest.id },
          }
        : {
            action: 'check_fix_progress',
            reason: 'A fix is in progress — check the report timeline.',
            tool: 'get_report_timeline',
            args: { reportId },
          },
    )
  } else if (status === 'fixed') {
    actions.push({
      action: 'verify_fix',
      reason: 'A fix was applied — verify it resolved the issue, then mark the report verified (or reopen it).',
      tool: 'get_fix_context',
      args: { reportId },
    })
  }

  const actionNodeId = inventoryActionNodeIdOf(report)
  if ((report.severity === 'critical' || report.severity === 'high') && actionNodeId) {
    actions.push({
      action: 'check_blast_radius',
      reason: 'High severity — check what else the affected inventory action touches.',
      tool: 'get_blast_radius',
      args: { nodeId: actionNodeId },
    })
  }
  return actions
}

/** triage_issue's one-line summary. */
export function triageSummaryOf(report: Row | null, actions: readonly TriageAction[]): string {
  if (!report) return 'Could not fetch the report — see partial_errors.'
  const severity = typeof report.severity === 'string' ? report.severity : 'unknown'
  const category = typeof report.category === 'string' ? report.category : 'unknown'
  const status = typeof report.status === 'string' ? report.status : 'unknown'
  const next = actions[0] ? `Recommended: ${actions[0].action}.` : 'No action required.'
  return `[${severity}] ${category} — status: ${status}. ${next}`
}
