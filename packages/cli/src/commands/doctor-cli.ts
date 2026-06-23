import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { runDoctor, formatDoctorResult, checkOnboardingStatus } from '../doctor.js';
import { runConnect } from '../connect.js';
import { resolveConsoleUrl } from '../console-url.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(
      'Run pre-flight checks: CLI config, endpoint reachability, SDK install, ' +
        'ingest readiness (API key → heartbeat → first report), and dispatch ' +
        'readiness (GitHub, index, BYOK, autofix). Ingest + server checks run ' +
        'by default; pass --no-server or --no-ingest to skip.',
    )
    .option('--cwd <path>', 'Run package detection from a different directory')
    .option('--json', 'Machine-readable output')
    .option('--no-server', 'Skip dispatch-readiness /preflight checks')
    .option('--no-ingest', 'Skip ingest-setup checks (SDK heartbeat, first report)')
    .option(
      '--qa-stories',
      'Check enabled QA stories for common setup issues: missing Firecrawl key, ' +
        'missing target URL, Slack not connected. Requires --server credentials.',
    )
    .option(
      '--host-app',
      'Verify host-app wiring: Mushi env vars, Cursor MCP config, Capacitor hybrid SDK notes.',
    )
    .option(
      '--mcp',
      'Check Cursor MCP config: verify mushi-* server entry, credentials, and probe account-overview connectivity.',
    )
    .option(
      '--fix',
      'Apply safe local fixes when checks fail: write missing .env.local lines and wire Cursor MCP config.',
    )
    .option(
      '--onboarding',
      'Focused onboarding check: prints the single next action you need to take to finish SDK setup, with a console deep link.',
    )
    .option(
      '--full',
      'Run ALL check categories (server, ingest, host-app, mcp, qa-stories) in one shot. Good for first-run diagnostics. Exit 0 only when all checks pass.',
    )
    .action(async (opts: { cwd?: string; json?: boolean; server?: boolean; ingest?: boolean; qaStories?: boolean; hostApp?: boolean; mcp?: boolean; fix?: boolean; onboarding?: boolean; full?: boolean }) => {
      const config = loadConfig()

      if (opts.onboarding) {
        const cwd = opts.cwd ?? process.cwd()
        const consoleBase = await resolveConsoleUrl({ cwd })
        const status = await checkOnboardingStatus(config, consoleBase, cwd)
        const base = consoleBase.replace(/\/$/, '')
        if (status.done) {
          console.log(`OK  Setup complete. ${status.nextAction}`)
          console.log(`    ${base}${status.ctaPath}`)
        } else {
          console.log(`→ Next: ${status.nextAction}`)
          console.log(`    Open: ${base}${status.ctaPath}`)
        }
        if (!status.done) process.exit(1)
        return
      }

      const doctorOpts = {
        cwd: opts.cwd,
        server: opts.server,
        ingest: opts.ingest,
        qaStories: opts.qaStories,
        hostApp: opts.hostApp,
        mcp: opts.mcp,
        full: opts.full,
      }
      let result = await runDoctor(config, doctorOpts)

      if (!result.ready && opts.fix && config.apiKey && config.projectId && config.endpoint) {
        const connectResult = await runConnect({
          apiKey: config.apiKey,
          projectId: config.projectId,
          endpoint: config.endpoint,
          cwd: opts.cwd ?? process.cwd(),
          writeEnv: true,
          wireIde: true,
        }, config)
        for (const msg of connectResult.messages) console.log(msg)
        result = await runDoctor(config, { ...doctorOpts, mcp: opts.mcp })
      }

      const { checks } = result

      if (opts.json) {
        console.log(JSON.stringify({ checks, ready: result.ready }, null, 2))
        if (!result.ready) process.exit(1)
        return
      }

      console.log(formatDoctorResult(result))
      if (!result.ready) process.exit(1)
    })
}
