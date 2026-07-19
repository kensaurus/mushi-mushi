// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/cli/src/index.ts
 * PURPOSE: @mushi-mushi/cli entry point — registers command groups and dispatches via parseAsync.
 */

import { Command } from 'commander'
import { installSignalHandlers } from './signals.js'
import { MUSHI_CLI_VERSION } from './version.js'
import { registerAccountCommands } from './commands/account.js'
import { registerDeployCommands } from './commands/deploy.js'
import { registerReportsCommands } from './commands/reports.js'
import { registerFeedbackCommands } from './commands/feedback.js'
import { registerLessonsCommands } from './commands/lessons.js'
import { registerDiagnosticsCommands } from './commands/diagnostics.js'
import { registerProjectCommands } from './commands/project.js'
import { registerSetupCommands } from './commands/setup.js'
import { registerFixCommands } from './commands/fix.js'
import { registerNudgeCommand } from './commands/nudge.js'
import { registerUpgradeCommand } from './commands/upgrade-cli.js'
import { registerConnectCommand } from './commands/connect-cli.js'
import { registerDoctorCommand } from './commands/doctor-cli.js'
import { registerResetCommand } from './commands/reset-cli.js'
import { registerTddCommands } from './commands/tdd.js'
import { registerKeysCommands } from './commands/keys.js'
import { registerIntegrationsCommands } from './commands/integrations.js'
import { registerQaCommands } from './commands/qa.js'
import { registerAuditCommands } from './commands/audit.js'
import { registerSkillsCommands } from './commands/skills.js'
import { registerBillingCommands } from './commands/billing.js'
import { registerCompletionCommand } from './commands/completion-cli.js'
import { registerSelfhostCommands } from './commands/selfhost.js'
import { registerProfileCommands } from './commands/profile.js'
import { setGlobalOutputFormat } from './cli-shared.js'
import { printAndExit } from './errors.js'

// Wire SIGINT/SIGTERM into a process-wide AbortController on first import.
// Long-running commands (`mushi index`, `mushi sourcemaps upload`) can
// then plumb the shared `getAbortSignal()` into their fetch calls and
// inner walks — Ctrl-C aborts the in-flight HTTP request immediately
// instead of waiting for its 15 s timeout, and Docker's SIGTERM kills
// behave the same way for clean container shutdowns.
installSignalHandlers()

// ─── CLI program ─────────────────────────────────────────────────────────────

const program = new Command()
  .name('mushi')
  .description('Mushi CLI — set up the SDK, triage a report, fix from your editor')
  .version(MUSHI_CLI_VERSION)
  // Global credential-profile selector. Setting the env var here (before any
  // command action runs) means every existing `loadConfig()` / `saveConfig()`
  // call resolves the chosen profile with no per-command plumbing.
  .option('--profile <name>', 'Use a named credential profile for this invocation (or set MUSHI_PROFILE)')
  // Global output format. Commands keep their historical `--json` flag; this
  // covers every command uniformly via `outputIsJson()`.
  .option('-o, --output <format>', 'Output format: text | json', 'text')
  .hook('preAction', (_thisCommand, actionCommand) => {
    // optsWithGlobals() merges the leaf command's options with every ancestor's,
    // so root-level `--profile` / `-o` are visible even for nested subcommands
    // like `mushi -o json profile list`.
    const opts = actionCommand.optsWithGlobals()
    const profile = opts['profile'] as string | undefined
    if (profile && profile.trim()) {
      process.env['MUSHI_PROFILE'] = profile.trim()
    }
    setGlobalOutputFormat(opts['output'] as string | undefined)
  })
  .addHelpText('after', `
Environment variables:
  MUSHI_API_KEY        SDK ingest key (report:write scope — from Onboarding → Verify in the console)
  MUSHI_PROJECT_ID     Project UUID   (from the Projects page in the console)
  MUSHI_API_ENDPOINT   Supabase edge function URL
                       e.g. https://<ref>.supabase.co/functions/v1/api
  MUSHI_PROFILE        Credential profile to use (see \`mushi profile\`)

Exit codes:
  0  success
  1  API / runtime error
  2  configuration error (missing credentials or endpoint)
  3  not found (resource does not exist)

Console: https://kensaur.us/mushi-mushi/admin
Docs:    https://github.com/kensaurus/mushi-mushi`)

// Register every command group, in the original declaration order so the
// `--help` listing stays identical to the pre-refactor CLI.
registerAccountCommands(program)
registerDeployCommands(program)
registerReportsCommands(program)
registerFeedbackCommands(program)
registerLessonsCommands(program)
registerDiagnosticsCommands(program)
registerProjectCommands(program)
registerSetupCommands(program)
registerNudgeCommand(program)
registerUpgradeCommand(program)
registerConnectCommand(program)
registerDoctorCommand(program)
registerResetCommand(program)
registerFixCommands(program)
registerTddCommands(program)
registerKeysCommands(program)
registerIntegrationsCommands(program)
registerQaCommands(program)
registerAuditCommands(program)
registerSkillsCommands(program)
registerBillingCommands(program)
registerSelfhostCommands(program)
registerProfileCommands(program)
// Registered last so buildCommandTree() sees every command above when the
// action runs (Commander builds the tree during these synchronous calls;
// the action itself only executes later, at parseAsync() time).
registerCompletionCommand(program)

// parseAsync so rejections from async command actions surface as clean
// one-line errors (plain `parse()` leaves them as unhandled rejections).
program.parseAsync().catch((err: unknown) => {
  printAndExit(err)
})
