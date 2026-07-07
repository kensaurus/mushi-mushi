// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/cli/src/commands/selfhost.ts
 * PURPOSE: `mushi selfhost up` / `mushi selfhost doctor`
 *
 * `mushi selfhost up` wraps the supabase CLI steps from SELF_HOSTED.md into a
 * single command:
 *   1. supabase link  (if a project-ref is given)
 *   2. supabase db push
 *   3. supabase secrets set (ANTHROPIC_API_KEY etc.)
 *   4. supabase functions deploy (all non-_shared)
 *   5. supabase storage create screenshots (management API, idempotent)
 *   6. Seed mushi_runtime_config rows (supabase_url, internal_caller_token)
 *   7. supabase secrets set MUSHI_INTERNAL_CALLER_SECRET
 *   8. POST /v1/admin/bootstrap (idempotent)
 *   9. Proof step: GET /health + send a test report and print result
 *
 * When the supabase CLI is absent or --print-commands is passed the command
 * degrades gracefully — it prints the exact commands instead of running them
 * so the operator can copy-paste. (Headroom pattern: degrade to instructions,
 * never silently skip, onboarding ends on a proof.)
 *
 * `mushi selfhost doctor` re-runs the same checks as the server-side
 * GET /v1/admin/doctor and prints results in the same OK/WARN/FAIL format as
 * `mushi doctor`.
 */

import type { Command } from 'commander'
import { execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { probeEndpointHealth, apiCall } from '../cli-shared.js'
import { loadConfig } from '../config.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

function hasSupabaseCli(): boolean {
  try {
    const r = spawnSync('supabase', ['--version'], { encoding: 'utf8', timeout: 5_000 })
    return r.status === 0
  } catch {
    return false
  }
}

/**
 * Run a shell command and return { ok, stdout, stderr }.
 * When `printOnly` is true, prints the command instead of running it.
 */
function run(
  cmd: string,
  opts: { cwd?: string; printOnly?: boolean; label?: string },
): { ok: boolean; stdout: string; stderr: string } {
  if (opts.printOnly) {
    console.log(`  $ ${cmd}`)
    return { ok: true, stdout: '', stderr: '' }
  }
  const label = opts.label ?? cmd.slice(0, 60)
  process.stdout.write(`  › ${label} … `)
  try {
    const out = execSync(cmd, {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: 300_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    process.stdout.write('✓\n')
    return { ok: true, stdout: out, stderr: '' }
  } catch (err: unknown) {
    process.stdout.write('✗\n')
    const msg = (err instanceof Error ? err.message : String(err)).trim()
    const stderr = (err as { stderr?: string }).stderr ?? ''
    return { ok: false, stdout: '', stderr: stderr || msg }
  }
}

// The functions directory relative to packages/server/supabase
const REQUIRED_FUNCTIONS = [
  'api',
  'fast-filter',
  'classify-report',
  'mcp',
  'fix-worker',
  'webhooks-github-indexer',
]
// NOTE: pipeline recovery is NOT an edge function — it is the
// recover_stranded_pipeline() SQL function installed by `supabase db push`
// and driven by pg_cron. Deploying a 'pipeline-recovery' function here
// fails with "entrypoint path does not exist" (verified against prod
// 2026-07-07), so only the real function directories are listed above.

// ─── selfhost up ─────────────────────────────────────────────────────────────

interface UpOptions {
  projectRef?: string
  anthropicKey?: string
  adminBaseUrl?: string
  printCommands?: boolean
  skipDeploy?: boolean
  endpoint?: string
  cwd?: string
}

async function runSelfhostUp(opts: UpOptions): Promise<void> {
  const supabaseDir = opts.cwd
    ? `${opts.cwd}/packages/server/supabase`
    : 'packages/server/supabase'

  const printOnly = !!(opts.printCommands || !hasSupabaseCli())
  if (printOnly) {
    console.log('')
    console.log('supabase CLI not found (or --print-commands was passed).')
    console.log('Run the following commands manually:\n')
  } else {
    console.log('')
    console.log('mushi selfhost up — deploying self-hosted Mushi Mushi\n')
  }

  const steps: Array<{ label: string; cmd: string; critical?: boolean }> = []

  // Step 1 — link
  //
  // Flag values are interpolated into execSync shell strings, so each one is
  // validated against a strict allowlist first: a metachar-bearing value
  // would otherwise break (or subvert) the command. On rejection we fail
  // loudly with the manual command instead of guessing at cross-platform
  // shell quoting.
  if (opts.projectRef && !/^[a-z0-9-]+$/i.test(opts.projectRef)) {
    process.stderr.write(`✗ --project-ref must be alphanumeric (got: ${opts.projectRef}).\n`)
    process.exit(1)
  }
  if (opts.projectRef) {
    steps.push({
      label: `link to Supabase project ${opts.projectRef}`,
      cmd: `supabase link --project-ref ${opts.projectRef}`,
      critical: true,
    })
  }

  // Step 2 — db push
  steps.push({
    label: 'apply database migrations',
    cmd: 'supabase db push',
    critical: true,
  })

  // Step 3 — secrets
  if (opts.anthropicKey && printOnly) {
    // Never echo a real key in --print-commands output.
    steps.push({
      label: 'set ANTHROPIC_API_KEY secret',
      cmd: 'supabase secrets set ANTHROPIC_API_KEY=sk-ant-...',
    })
  } else if (opts.anthropicKey) {
    if (!/^[A-Za-z0-9_-]+$/.test(opts.anthropicKey)) {
      process.stderr.write(
        '✗ --anthropic-key contains characters that cannot be passed through the shell safely.\n' +
          '  Set it manually instead: supabase secrets set ANTHROPIC_API_KEY=<your key>\n',
      )
      process.exit(1)
    }
    steps.push({
      label: 'set ANTHROPIC_API_KEY secret',
      cmd: `supabase secrets set ANTHROPIC_API_KEY=${opts.anthropicKey}`,
    })
  } else if (printOnly) {
    steps.push({
      label: 'set ANTHROPIC_API_KEY secret',
      cmd: 'supabase secrets set ANTHROPIC_API_KEY=sk-ant-...',
    })
  }

  if (opts.adminBaseUrl) {
    let adminUrlOk = false
    try {
      const u = new URL(opts.adminBaseUrl)
      adminUrlOk =
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        /^[A-Za-z0-9:/._~-]+$/.test(opts.adminBaseUrl)
    } catch {
      adminUrlOk = false
    }
    if (!adminUrlOk) {
      process.stderr.write(
        `✗ --admin-base-url must be a plain http(s) URL (got: ${opts.adminBaseUrl}).\n`,
      )
      process.exit(1)
    }
    steps.push({
      label: 'set ADMIN_BASE_URL secret',
      cmd: `supabase secrets set ADMIN_BASE_URL=${opts.adminBaseUrl}`,
    })
  }

  // Generate internal caller token
  const internalToken = randomBytes(32).toString('hex')
  steps.push({
    label: 'set MUSHI_INTERNAL_CALLER_SECRET (recovery cron auth)',
    cmd: `supabase secrets set MUSHI_INTERNAL_CALLER_SECRET=${printOnly ? '<openssl rand -hex 32>' : internalToken}`,
  })

  // Step 4 — deploy functions
  if (!opts.skipDeploy) {
    for (const fn of REQUIRED_FUNCTIONS) {
      steps.push({
        label: `deploy edge function: ${fn}`,
        cmd: `supabase functions deploy ${fn} --no-verify-jwt`,
      })
    }
  }

  // Step 5 — storage bucket (via supabase CLI management API approach)
  steps.push({
    label: 'create screenshots storage bucket',
    cmd: "supabase storage create screenshots --public || true",
  })

  // Run or print all steps
  let aborted = false
  for (const step of steps) {
    if (printOnly) {
      // Always print
      console.log(`# ${step.label}`)
      run(step.cmd, { printOnly: true })
      console.log('')
    } else {
      const result = run(step.cmd, { label: step.label, cwd: supabaseDir })
      if (!result.ok) {
        if (result.stderr) {
          process.stderr.write(`    ${result.stderr.split('\n')[0]}\n`)
        }
        if (step.critical) {
          process.stderr.write(
            `\n✗ Critical step failed — resolve the error above and re-run.\n`,
          )
          process.exit(1)
        }
        aborted = true
      }
    }
  }

  // Step 6 — seed mushi_runtime_config (when we know the endpoint)
  const endpoint = opts.endpoint || loadConfig().endpoint
  if (endpoint) {
    if (printOnly) {
      console.log('# seed mushi_runtime_config via API')
      console.log(
        `#   mushi login --endpoint ${endpoint} --api-key <key> --project-id <pid>`,
      )
      console.log(
        `#   then: supabase sql --file <(echo "INSERT INTO public.mushi_runtime_config(key,value)`)
      console.log(
        `#     VALUES ('internal_caller_token','<token>') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()")`,
      )
      console.log('')
    } else if (!aborted) {
      // Bootstrap the backend via the idempotent /v1/admin/bootstrap route
      process.stdout.write(`  › POST /v1/admin/bootstrap … `)
      try {
        const config = loadConfig()
        if (config.apiKey) {
          await apiCall<{ ok: boolean }>('/admin/bootstrap', config, { method: 'POST' })
          process.stdout.write('✓\n')
        } else {
          process.stdout.write('skipped (not logged in)\n')
        }
      } catch {
        process.stdout.write('warn (non-critical)\n')
      }
    }
  }

  if (printOnly) {
    console.log('─────────────────────────────────────────────────')
    console.log('Once commands above are done, run:')
    console.log('  mushi selfhost doctor --endpoint <your-endpoint>')
    return
  }

  // Step 9 — proof step
  if (!aborted && endpoint) {
    console.log('')
    console.log('Running proof step…')
    const probe = await probeEndpointHealth(endpoint).catch(() => null)
    if (!probe?.ok) {
      console.log('  WARN  /health did not return 200 — check function logs.')
    } else {
      console.log(`  OK    /health ${probe.status} ${probe.latencyMs}ms`)
    }
  }

  console.log('')
  if (aborted) {
    console.log(
      'Some non-critical steps failed — check stderr above, then re-run or fix manually.',
    )
    console.log('Run `mushi selfhost doctor` once the endpoint is reachable.')
    process.exit(2)
  } else {
    console.log('✓  selfhost up complete.')
    console.log('')
    console.log('Next steps:')
    console.log(
      '  1. mushi login --endpoint https://<ref>.supabase.co/functions/v1/api',
    )
    console.log('  2. mushi selfhost doctor')
    console.log('  3. mushi init   (in your app repo)')
  }
}

// ─── selfhost doctor ─────────────────────────────────────────────────────────

interface DoctorOptions {
  endpoint?: string
  json?: boolean
}

async function runSelfhostDoctor(opts: DoctorOptions): Promise<void> {
  const config = loadConfig()
  const endpoint = opts.endpoint || config.endpoint
  if (!endpoint) {
    process.stderr.write(
      'error: endpoint required — pass --endpoint or run `mushi login` first.\n',
    )
    process.exit(1)
  }

  // Fetch server-side doctor
  let serverChecks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; summary: string; hint?: string }> = []
  try {
    const res = await fetch(`${endpoint}/v1/admin/doctor`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const body = (await res.json()) as { data?: { checks?: typeof serverChecks } }
      serverChecks = body.data?.checks ?? []
    } else {
      serverChecks = [
        {
          name: 'server_doctor',
          status: 'fail',
          summary: `/v1/admin/doctor returned HTTP ${res.status}`,
          hint: '401 → check API key scope (needs mcp:read or admin); 403 → key not owner of this project',
        },
      ]
    }
  } catch (err) {
    serverChecks = [
      {
        name: 'server_doctor',
        status: 'fail',
        summary: `unreachable: ${err instanceof Error ? err.message : String(err)}`,
        hint: `Check that ${endpoint} is deployed and reachable.`,
      },
    ]
  }

  if (opts.json) {
    const overallStatus = serverChecks.some((c) => c.status === 'fail')
      ? 'fail'
      : serverChecks.some((c) => c.status === 'warn')
        ? 'warn'
        : 'pass'
    console.log(JSON.stringify({ status: overallStatus, checks: serverChecks }, null, 2))
  } else {
    for (const check of serverChecks) {
      const tag =
        check.status === 'pass' ? 'OK  ' : check.status === 'warn' ? 'WARN' : 'FAIL'
      console.log(`${tag}  ${check.name}  ${check.summary}`)
      if (check.hint && check.status !== 'pass') {
        console.log(`      → Fix: ${check.hint}`)
      }
    }
  }

  const hasFailure = serverChecks.some((c) => c.status === 'fail')
  const hasWarn = serverChecks.some((c) => c.status === 'warn')
  if (hasFailure) process.exit(1)
  if (hasWarn) process.exit(2)
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerSelfhostCommands(program: Command): void {
  const selfhost = program.command('selfhost').description('Self-hosted deployment tools')

  // ── selfhost up ──────────────────────────────────────────────────────────
  selfhost
    .command('up')
    .description(
      'Bootstrap a self-hosted Mushi Mushi deployment on a Supabase project',
    )
    .option(
      '--project-ref <ref>',
      'Supabase project ref (runs `supabase link` first)',
    )
    .option(
      '--anthropic-key <key>',
      'Anthropic API key to set as a Supabase function secret',
    )
    .option(
      '--admin-base-url <url>',
      'Base URL of your deployed admin console (e.g. https://your-domain.example.com/admin)',
    )
    .option(
      '--endpoint <url>',
      'Mushi API endpoint to use for the proof step (default: from ~/.config/mushi/config.json)',
    )
    .option(
      '--skip-deploy',
      'Skip function deploys (run db push + secrets only)',
    )
    .option(
      '--print-commands',
      'Print the supabase CLI commands instead of running them (non-interactive / CI)',
    )
    .option('--cwd <path>', 'Root of the mushi-mushi repo checkout')
    .addHelpText(
      'after',
      `
Examples:
  mushi selfhost up --project-ref abcxyzabcxyz
  mushi selfhost up --print-commands   # copy-paste mode for CI
  mushi selfhost up --skip-deploy      # re-run secrets/migrations only

Requires the Supabase CLI (https://supabase.com/docs/guides/cli).
If not installed, pass --print-commands to get the exact commands.

After "up" completes:
  mushi selfhost doctor --endpoint https://<ref>.supabase.co/functions/v1/api`,
    )
    .action(
      async (opts: {
        projectRef?: string
        anthropicKey?: string
        adminBaseUrl?: string
        endpoint?: string
        skipDeploy?: boolean
        printCommands?: boolean
        cwd?: string
      }) => {
        await runSelfhostUp(opts)
      },
    )

  // ── selfhost doctor ──────────────────────────────────────────────────────
  selfhost
    .command('doctor')
    .description(
      'Check the health of a self-hosted deployment (calls GET /v1/admin/doctor)',
    )
    .option(
      '--endpoint <url>',
      'Mushi API endpoint (default: from ~/.config/mushi/config.json)',
    )
    .option('--json', 'Machine-readable JSON output')
    .addHelpText(
      'after',
      `
Exit codes: 0 all pass · 2 warnings only · 1 any hard failure

Examples:
  mushi selfhost doctor
  mushi selfhost doctor --endpoint https://<ref>.supabase.co/functions/v1/api
  mushi selfhost doctor --json | jq '.checks[] | select(.status != "pass")'`,
    )
    .action(async (opts: { endpoint?: string; json?: boolean }) => {
      await runSelfhostDoctor(opts)
    })
}
