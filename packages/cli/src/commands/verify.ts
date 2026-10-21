/**
 * FILE: packages/cli/src/commands/verify.ts
 * PURPOSE: `mushi verify workflow` (Plan 024, ADR 0035): the mushi-verify
 *          GitHub workflow filled in with the project's runner labels and test
 *          command (GET /v1/admin/projects/:id/verify-workflow). It proves an
 *          agent's fix with a test that fails without it. Prints the YAML, or
 *          writes it with --out. The gates of one fix: `mushi fixes verify`.
 */

import type { Command } from 'commander'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

/** The workflow is a few KB; anything larger is not it. */
const WORKFLOW_MAX_BYTES = 64 * 1024
/** Every version of the template uses Mushi's fix-verify action. */
const WORKFLOW_SHAPE = /uses:\s*kensaurus\/mushi-mushi\/\.github\/actions\/fix-verify@/

const VERIFY_WORKFLOW_PATH = '.github/workflows/mushi-verify.yml'

export function registerVerifyCommands(program: Command): void {
  const verify = program
    .command('verify')
    .description('Verified merge: the workflow that proves an agent fix with a test (see also `mushi fixes verify`)')

  verify
    .command('workflow')
    .description(`Print the mushi-verify workflow for this project, or write it with --out (save as ${VERIFY_WORKFLOW_PATH})`)
    .option('--project <id>', 'Project ID (defaults to the configured project)')
    .option('--out <path>', `Write the YAML to this file, e.g. ${VERIFY_WORKFLOW_PATH}`)
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Examples:
  mushi verify workflow                              # print it
  mushi verify workflow --out ${VERIFY_WORKFLOW_PATH}

The runner labels and test command come from the console: Settings → Fixes →
Verified merge. Docs: https://kensaur.us/mushi-mushi/docs/admin/verified-merge`)
    .action(async (opts: { project?: string; out?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.project, config.projectId)
      const result = await apiCall<{ yaml?: string }>(`/v1/admin/projects/${projectId}/verify-workflow`, config)
      if (!result.ok) die(result)
      const yaml = result.data?.yaml
      if (typeof yaml !== 'string' || !yaml.trim()) {
        throw new MushiCliError('E_API_ERROR', 'The server sent no workflow.', 'Update the CLI (mushi upgrade) or copy it from the console: Settings → Fixes → Verified merge.')
      }
      const text = yaml.endsWith('\n') ? yaml : `${yaml}\n`
      // Write only what is recognisably the Mushi verify workflow: a reply
      // that is not (a proxy page, a broken server) never lands in a repo.
      if (text.length > WORKFLOW_MAX_BYTES || !WORKFLOW_SHAPE.test(text) || text.includes('\0')) {
        throw new MushiCliError('E_API_ERROR', 'The server sent something that is not the Mushi verify workflow.', 'Copy it from the console instead: Settings → Fixes → Verified merge.')
      }
      const out = opts.out ? resolve(opts.out) : null
      if (out && !/\.ya?ml$/i.test(out)) {
        throw new MushiCliError('E_INVALID_INPUT', `--out must be a .yml or .yaml file: ${out}`, 'For example: --out .github/workflows/mushi-verify.yml')
      }
      if (out) {
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, text)
      }
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ ok: true, projectId, yaml: text, ...(out ? { path: out } : {}) }, null, 2))
        return
      }
      if (!out) {
        process.stdout.write(text)
        return
      }
      console.log(`Wrote ${out}.`)
      console.log('Commit it to your default branch. Agent PRs then get a "Mushi verify" check.')
    })
}
