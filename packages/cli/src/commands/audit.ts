import type { Command } from 'commander';
import { sanitizeApiKey, sanitizeEndpoint, sanitizeProjectId } from '../sanitize-config.js';
import { requireConfig } from '../cli-shared.js';

export function registerAuditCommands(program: Command): void {
// ─── audit ────────────────────────────────────────────────────────────────────

program
  .command('audit')
  .description('Run a full-stack health audit for the current project')
  .option('--json', 'Machine-readable JSON output')
  .option('--project-id <id>', 'Project ID to audit (defaults to MUSHI_PROJECT_ID from config)')
  .addHelpText('after', `
Description:
  Fans out to the Mushi backend to run a full-stack health audit:
    • DB schema + Supabase advisors (requires Supabase PAT in API Keys)
    • Recent backend error logs
    • Tables without RLS enabled
    • Gate results: API contract (G3), spec drift (G6), orphan endpoints (G7),
      unknown frontend calls (G8), schema drift, status claim (G5)

  Returns a human-readable summary with severity-ranked findings.

  Prerequisites:
    1. Add your Supabase PAT in Admin → Settings → API Keys
    2. Set supabase_project_ref in Admin → Settings → Project.

Examples:
  mushi audit
  mushi audit --json
  mushi audit --project-id abc123`)
  .action(async (opts: { json?: boolean; projectId?: string }) => {
    const config = requireConfig()
    const rawProjectId = opts.projectId ?? config.projectId
    if (!rawProjectId) {
      process.stderr.write('error: project ID required. Run `mushi login` or pass --project-id\n')
      process.exit(1)
    }

    let endpoint: string
    let projectId: string
    try {
      endpoint = sanitizeEndpoint(config.endpoint)
      projectId = sanitizeProjectId(rawProjectId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`error: ${msg}\n`)
      process.exit(2)
    }

    // Admin audit uses API key auth (same as other sync/admin MCP tools).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Mushi-Project-Id': projectId,
    }
    const apiKey = config.apiKey ?? null
    if (apiKey) {
      headers['X-Mushi-Api-Key'] = sanitizeApiKey(apiKey)
    } else {
      process.stderr.write('error: no API key found. Run `mushi login` or set MUSHI_API_KEY.\n')
      process.exit(1)
    }

    if (!opts.json) process.stdout.write('Running full-stack audit… ')

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      const res = await fetch(
        `${endpoint}/v1/admin/projects/${projectId}/audit`,
        { method: 'POST', headers, body: '{}', signal: controller.signal },
      )
      clearTimeout(timer)
      const body = await res.json() as { ok: boolean; data?: Record<string, unknown>; error?: { message: string } }
      if (!res.ok || !body.ok) {
        if (opts.json) { console.log(JSON.stringify(body)); process.exit(1) }
        process.stdout.write('FAIL\n')
        process.stderr.write(`error: ${body.error?.message ?? `HTTP ${res.status}`}\n`)
        process.exit(1)
      }

      if (opts.json) { console.log(JSON.stringify(body.data, null, 2)); return }

      const data = body.data as {
        summary: { overall: string; error_count: number; warn_count: number }
        findings: Array<{ severity: string; title: string; detail: string }>
        gate_runs: Array<{ gate: string; status: string; findings_count: number }>
        backend_linked: boolean
        audit_at: string
      }

      const overallLabel = data.summary.overall === 'fail' ? 'FAIL' : data.summary.overall === 'warn' ? 'WARN' : 'OK'
      process.stdout.write(`${overallLabel}\n\n`)

      console.log(`Full-Stack Audit — ${new Date(data.audit_at).toLocaleString()}`)
      console.log(`Backend linked: ${data.backend_linked ? 'yes' : 'no (configure Supabase PAT + project ref)'}`)
      console.log(`Summary: ${data.summary.error_count} error(s) · ${data.summary.warn_count} warning(s)\n`)

      if (data.findings.length === 0) {
        console.log('  OK  No findings. Your project looks healthy.')
      } else {
        for (const f of data.findings) {
          const icon = f.severity === 'error' ? 'FAIL' : f.severity === 'warn' ? 'WARN' : 'INFO'
          console.log(`  ${icon}  ${f.title}`)
          console.log(`     ${f.detail.slice(0, 120)}${f.detail.length > 120 ? '…' : ''}`)
        }
      }

      if (data.gate_runs.length > 0) {
        console.log('\nGate Results:')
        for (const run of data.gate_runs) {
          const g = run.status === 'pass' ? 'OK' : run.status === 'fail' ? 'FAIL' : 'SKIP'
          console.log(`  ${g} ${run.gate.padEnd(22)} ${run.status}  (${run.findings_count} finding${run.findings_count !== 1 ? 's' : ''})`)
        }
      }

      if (data.summary.overall === 'fail') process.exit(1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg }))
      } else {
        process.stdout.write('ERROR\n')
        process.stderr.write(`error: ${msg}\n`)
      }
      process.exit(1)
    }
  })

}
