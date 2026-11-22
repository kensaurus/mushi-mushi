// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/mcp/src/stdio-args.ts
 * PURPOSE: The few command-line flags the stdio bin answers itself.
 *
 * `npx @mushi-mushi/mcp --help` used to start the server and wait on stdin,
 * which looks like a hang to anyone trying the package by hand. --help and
 * --version now print and exit 0 before the server starts. Any other
 * argument is ignored, as before. Kept pure so it can be tested without
 * running index.ts (which starts the server at import time).
 */

export type StdioArgsAction = 'help' | 'version' | 'serve'

/** What the bin should do with its argv (`process.argv.slice(2)`). */
export function stdioArgsAction(argv: readonly string[]): StdioArgsAction {
  if (argv.includes('-h') || argv.includes('--help')) return 'help'
  if (argv.includes('-v') || argv.includes('--version')) return 'version'
  return 'serve'
}

/** Printed by `--help`. */
export function stdioUsage(version: string): string {
  return `@mushi-mushi/mcp ${version} — Mushi Mushi MCP server (stdio)

Your editor starts this server; you normally do not run it by hand.

Set it up:
  npx mushi-mushi setup --ide cursor    or --ide claude, continue, zed

Run it yourself (for an MCP client that takes a command):
  npx -y @mushi-mushi/mcp

Environment:
  MUSHI_API_KEY        an MCP key (mcp:read or mcp:write). Not the SDK key (report:write).
                       Unset: the key saved by \`npx mushi-mushi login\` is used.
  MUSHI_PROJECT_ID     the project UUID. Unset: the saved project, or account mode.
  MUSHI_API_ENDPOINT   only for self-hosting, e.g. https://xyz.supabase.co/functions/v1/api
  MUSHI_FEATURES       tool groups to show, e.g. triage,qa,codebase, or all
  MUSHI_SCOPES         limit the tools to these scopes, e.g. mcp:read

Flags:
  -h, --help           show this help and exit
  -v, --version        print the version and exit

Docs: https://kensaur.us/mushi-mushi/docs/sdks/mcp
`
}
