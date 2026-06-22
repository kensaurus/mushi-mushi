// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/cli/src/index.ts
 * PURPOSE: @mushi-mushi/cli entry point — wires the shared Commander program,
 *          registers every command group, and dispatches via parseAsync.
 *
 * OVERVIEW:
 * - This file is intentionally thin: the actual command definitions live in
 *   src/commands/*.ts (one module per group), the HTTP client + helpers live in
 *   src/cli-shared.ts, and the response types in src/cli-types.ts. The former
 *   monolithic ~2.9k-LOC index.ts was decomposed here without behaviour change.
 *
 * AUTH MODEL
 * ----------
 * All network commands use the project's SDK API key (MUSHI_API_KEY), validated
 * server-side via `apiKeyAuth` middleware. The CLI never needs an interactive
 * Supabase JWT — the API key alone is sufficient for every operation here.
 *
 * Auth precedence (highest wins):
 *   1. Explicit flags (--api-key, --endpoint, --project-id)
 *   2. Environment variables (MUSHI_API_KEY, MUSHI_API_ENDPOINT, MUSHI_PROJECT_ID)
 *   3. ~/.config/mushi/config.json config file (written by `mushi login`)
 *
 * EXIT CODES
 * ----------
 *   0  — success
 *   1  — API or runtime error
 *   2  — configuration error (missing credentials / bad endpoint)
 *   3  — not found (report/lesson ID does not exist)
 *
 * DEPENDENCIES:
 * - commander — argument parser.
 * - ./signals.js — process-wide SIGINT/SIGTERM AbortController.
 * - ./version.js — MUSHI_CLI_VERSION.
 * - ./commands/*.js — per-group command registrars.
 *
 * NOTES:
 * - Command registration order is preserved exactly so `mushi --help` lists
 *   commands in the same order as before the refactor.
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
import { registerTddCommands } from './commands/tdd.js'
import { registerKeysCommands } from './commands/keys.js'
import { registerIntegrationsCommands } from './commands/integrations.js'
import { registerQaCommands } from './commands/qa.js'
import { registerAuditCommands } from './commands/audit.js'
import { registerSkillsCommands } from './commands/skills.js'
import { registerBillingCommands } from './commands/billing.js'

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
  .description('Mushi Mushi CLI — set up the SDK, manage bug reports, monitor pipeline')
  .version(MUSHI_CLI_VERSION)
  .addHelpText('after', `
Environment variables:
  MUSHI_API_KEY        SDK ingest key (report:write scope — from Onboarding → Verify in the console)
  MUSHI_PROJECT_ID     Project UUID   (from the Projects page in the console)
  MUSHI_API_ENDPOINT   Supabase edge function URL
                       e.g. https://<ref>.supabase.co/functions/v1/api

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
registerFixCommands(program)
registerTddCommands(program)
registerKeysCommands(program)
registerIntegrationsCommands(program)
registerQaCommands(program)
registerAuditCommands(program)
registerSkillsCommands(program)
registerBillingCommands(program)

// parseAsync so rejections from async command actions surface as clean
// one-line errors (plain `parse()` leaves them as unhandled rejections).
program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
