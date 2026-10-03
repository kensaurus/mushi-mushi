import type { Command } from 'commander';
import { sanitizeApiKey, sanitizeEndpoint, sanitizeProjectId } from '../sanitize-config.js';
import { apiCall, die, fmtDate, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js';
import { oneLine, resolveProjectId } from '../command-helpers.js';
import { MushiCliError } from '../errors.js';

/**
 * gate_runs.gate values known when this CLI was built (the same list as the
 * MCP server). Help text only: `--gate` passes any value to the server, which
 * filters by it, so a gate added server-side works before a CLI release.
 */
const KNOWN_GATES = [
  'dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim', 'spec_drift',
  'orphan_endpoint', 'unknown_call', 'schema_drift', 'code_health', 'design_drift',
  'ci_drift', 'deploy_drift', 'env_drift', 'portfolio_radar', 'portfolio_radar_ci', 'store_review',
] as const;
const SEVERITIES = ['info', 'warn', 'error'] as const;

/** Bare `mushi audit` waits on Supabase advisors and log reads: 30 s, not apiCall's 15 s default. */
const AUDIT_TIMEOUT_MS = 30_000;

interface FullStackAuditData {
  summary: { overall: string; error_count: number; warn_count: number };
  findings: Array<{ severity: string; title: string; detail: string }>;
  gate_runs: Array<{ gate: string; status: string; findings_count: number }>;
  backend_linked: boolean;
  audit_at: string;
}

interface GateFindingRow {
  id: string;
  gate_run_id: string;
  severity: string;
  rule_id: string | null;
  message: string;
  file_path: string | null;
  line: number | null;
  allowlisted: boolean;
  created_at: string;
}

interface GateFindingsData {
  runs: Array<{ id: string; gate: string; status: string; findings_count: number | null; started_at: string; commit_sha: string | null }>;
  findings: GateFindingRow[];
}

interface FindingExplanationData {
  id: string;
  gate: string;
  gateLabel: string;
  gateMeaning: string;
  ruleId: string | null;
  rule: { title: string; prevents: string } | null;
  severity: string;
  reason: string;
  fix: { text: string | null; consolePath: string | null; command: string | null };
  location: { filePath: string | null; line: number | null; target: string | null };
  state: 'open' | 'not_in_latest_run' | 'allowlisted';
  stateReason: string;
  run: { status: string; completedAt: string | null; commitSha: string | null };
}

function renderGateFindings(data: GateFindingsData, includeAllowlisted: boolean): string[] {
  const gateOf = new Map(data.runs.map((r) => [r.id, r.gate]));
  const shown = data.findings.filter((f) => includeAllowlisted || !f.allowlisted);
  if (data.runs.length === 0) return ['No gate runs yet for this project.'];
  if (shown.length === 0) return [`${data.runs.length} recent run(s), no open findings.`];
  const lines: string[] = [];
  for (const f of shown) {
    const where = f.file_path ? `${f.file_path}${f.line ? `:${f.line}` : ''}` : '';
    lines.push(`  ${f.severity.toUpperCase().padEnd(5)} ${(gateOf.get(f.gate_run_id) ?? '?').padEnd(18)} ${f.rule_id ?? ''}  ${where}`);
    lines.push(`        ${oneLine(f.message, 110)}  [${f.id}]${f.allowlisted ? ' (allowlisted)' : ''}`);
  }
  lines.push(`${shown.length} finding(s). Why one fired and how to fix it: mushi audit explain <id>`);
  return lines;
}

function renderExplanation(e: FindingExplanationData): string[] {
  const lines = [
    `${e.severity.toUpperCase()} — ${e.gateLabel}${e.rule ? `: ${e.rule.title}` : e.ruleId ? ` (${e.ruleId})` : ''}`,
    `  What this checks: ${e.gateMeaning}`,
  ];
  if (e.rule) lines.push(`  What it prevents: ${e.rule.prevents}`);
  lines.push(`  Why it fired: ${oneLine(e.reason, 300)}`);
  const where = e.location.filePath ? `${e.location.filePath}${e.location.line ? `:${e.location.line}` : ''}` : e.location.target;
  if (where) lines.push(`  Where: ${where}`);
  if (e.fix.text) lines.push(`  Fix: ${oneLine(e.fix.text, 300)}`);
  if (e.fix.command) lines.push(`  Run: ${e.fix.command}`);
  if (e.fix.consolePath) lines.push(`  In the console: ${e.fix.consolePath}`);
  lines.push(`  State: ${e.state} — ${e.stateReason}`);
  lines.push(`  From run: ${e.run.status} ${fmtDate(e.run.completedAt)}${e.run.commitSha ? ` @ ${e.run.commitSha.slice(0, 7)}` : ''}`);
  return lines;
}

export function registerAuditCommands(program: Command): void {
// ─── audit ────────────────────────────────────────────────────────────────────

const audit = program
  .command('audit')
  .description('Run a full-stack health audit for the current project')
  .option('--json', 'Machine-readable JSON output')
  .option('--project-id <id>', 'Project ID to audit (defaults to MUSHI_PROJECT_ID from config)')
  .addHelpText('after', `
Description:
  Fans out to the Mushi backend to run a full-stack health audit:
    • DB schema + Supabase advisors (requires a linked Supabase project)
    • Recent backend error logs
    • Tables without RLS enabled
    • Gate results: API contract (G3), spec drift (G6), orphan endpoints (G7),
      unknown frontend calls (G8), schema drift, status claim (G5)

  Returns a human-readable summary with severity-ranked findings.

  Prerequisites:
    1. Set the Supabase project ref in Admin → Settings → General → Supabase project.
    2. Add a scoped, read-only Supabase access token (one project; Database,
       Edge Functions, Advisors and Logs at Read) in Admin → Settings → AI keys → Supabase.

Examples:
  mushi audit
  mushi audit --json
  mushi audit --project-id abc123
  mushi audit findings --gate code_health --severity error
  mushi audit explain <finding id>`)
  .action(async (opts: { json?: boolean; projectId?: string }) => {
    const config = requireConfig();
    const rawProjectId = opts.projectId ?? config.projectId;
    if (!rawProjectId) {
      throw new MushiCliError('E_PROJECT_MISSING', 'Project ID not configured.', 'pass --project-id <id> or run `mushi login --project-id <id>`');
    }
    let endpoint: string;
    let projectId: string;
    let apiKey: string;
    try {
      endpoint = sanitizeEndpoint(config.endpoint);
      projectId = sanitizeProjectId(rawProjectId);
      apiKey = sanitizeApiKey(config.apiKey);
    } catch (err) {
      throw new MushiCliError('E_INVALID_INPUT', err instanceof Error ? err.message : String(err));
    }
    const json = outputIsJson(opts.json);

    if (!json) process.stdout.write('Running full-stack audit… ');
    const result = await apiCall<FullStackAuditData>(
      `/v1/admin/projects/${projectId}/audit`,
      { ...config, endpoint, apiKey },
      { method: 'POST', body: '{}', headers: { 'X-Mushi-Project-Id': projectId } },
      { timeoutMs: AUDIT_TIMEOUT_MS },
    );
    if (!result.ok) {
      if (json) {
        console.log(JSON.stringify({ ok: false, error: result.error }));
        process.exit(1);
      }
      process.stdout.write('FAIL\n');
      die(result);
    }
    if (json) {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    const data = result.data;
    const overallLabel = data.summary.overall === 'fail' ? 'FAIL' : data.summary.overall === 'warn' ? 'WARN' : 'OK';
    process.stdout.write(`${overallLabel}\n\n`);

    console.log(`Full-Stack Audit — ${new Date(data.audit_at).toLocaleString()}`);
    console.log(`Backend linked: ${data.backend_linked ? 'yes' : 'no (configure Supabase PAT + project ref)'}`);
    console.log(`Summary: ${data.summary.error_count} error(s) · ${data.summary.warn_count} warning(s)\n`);

    if (data.findings.length === 0) {
      console.log('  OK  No findings. Your project looks healthy.');
    } else {
      for (const f of data.findings) {
        const icon = f.severity === 'error' ? 'FAIL' : f.severity === 'warn' ? 'WARN' : 'INFO';
        console.log(`  ${icon}  ${f.title}`);
        console.log(`     ${f.detail.slice(0, 120)}${f.detail.length > 120 ? '…' : ''}`);
      }
    }

    if (data.gate_runs.length > 0) {
      console.log('\nGate Results:');
      for (const run of data.gate_runs) {
        const g = run.status === 'pass' ? 'OK' : run.status === 'fail' ? 'FAIL' : 'SKIP';
        console.log(`  ${g} ${run.gate.padEnd(22)} ${run.status}  (${run.findings_count} finding${run.findings_count !== 1 ? 's' : ''})`);
      }
    }
    console.log('\nEach gate finding with its file and line: mushi audit findings');

    if (data.summary.overall === 'fail') process.exit(1);
  });

// ─── audit findings / explain ─────────────────────────────────────────────────
// The per-finding list behind every gate (GET /v1/admin/inventory/:id/findings)
// and the plain-English explanation of one finding (GET /v1/admin/findings/:id).
//
// `audit` itself declares --json and --project-id, and Commander lets the
// parent consume its own options wherever they appear, so
// `mushi audit findings --json` sets audit's --json, not findings'. The
// subcommands read optsWithGlobals() to see both.

audit
  .command('findings')
  .description('Every finding from the recent gate runs, with file and line')
  .option('--gate <gate>', `Only this gate (known: ${KNOWN_GATES.join(', ')})`)
  .option('--severity <level>', 'Only this severity: info | warn | error')
  .option('--all', 'Include allowlisted findings')
  // Declared for --help; audit consumes these, optsWithGlobals() reads them.
  .option('--project-id <id>', 'Project ID (defaults to the configured project)')
  .option('--json', 'Machine-readable JSON output')
  .action(async (_local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ gate?: string; severity?: string; all?: boolean; projectId?: string; json?: boolean }>();
    if (opts.gate && !(KNOWN_GATES as readonly string[]).includes(opts.gate)) {
      // The server filters by any gate name; a newer server may have gates this CLI does not list.
      process.stderr.write(`warning: this CLI does not know the gate "${opts.gate}" (known: ${KNOWN_GATES.join(', ')}). Asking the server anyway.\n`);
    }
    if (opts.severity && !(SEVERITIES as readonly string[]).includes(opts.severity)) {
      throw new MushiCliError('E_INVALID_INPUT', '--severity must be info, warn or error');
    }
    const config = requireConfig();
    const projectId = resolveProjectId(opts.projectId, config.projectId);
    const qs = new URLSearchParams();
    if (opts.gate) qs.set('gate', opts.gate);
    if (opts.severity) qs.set('severity', opts.severity);
    const suffix = qs.toString() ? `?${qs}` : '';
    const result = await apiCall<GateFindingsData>(`/v1/admin/inventory/${projectId}/findings${suffix}`, config);
    if (!result.ok) {
      if (result.error.code === 'feature_not_in_plan') {
        process.stderr.write('The per-finding list is not on your plan. `mushi audit` (no subcommand) still runs the summary audit.\n');
      }
      die(result);
    }
    if (outputIsJson(opts.json)) {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }
    for (const line of renderGateFindings(result.data, opts.all === true)) console.log(line);
  });

audit
  .command('explain <findingId>')
  .description('Why one finding fired, what it prevents, and how to fix it')
  .option('--json', 'Machine-readable JSON output')
  .action(async (findingId: string, _local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ json?: boolean }>();
    const id = requireUuid(findingId, 'finding id');
    const config = requireConfig();
    const result = await apiCall<FindingExplanationData>(`/v1/admin/findings/${id}`, config);
    if (!result.ok) die(result);
    if (outputIsJson(opts.json)) {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }
    for (const line of renderExplanation(result.data)) console.log(line);
  });

}
