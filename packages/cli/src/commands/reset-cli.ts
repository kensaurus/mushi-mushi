import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { apiCall } from '../cli-shared.js';

export function registerResetCommand(program: Command): void {
  program
    .command('reset [projectId]')
    .description(
      'Archive a project and wipe its test data (codebase_files, fix_attempts, reports). ' +
        'Speeds up re-running the full onboarding flow from scratch. ' +
        'Requires `--confirm` to prevent accidents.',
    )
    .option('--confirm', 'Required safety flag — must pass to proceed')
    .option('--json', 'Machine-readable output')
    .action(async (projectId: string | undefined, opts: { confirm?: boolean; json?: boolean }) => {
      const config = loadConfig()
      const resolvedId = projectId ?? config.projectId
      if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
      if (!resolvedId) { console.error('Provide a projectId or set one via `mushi config projectId <uuid>`'); process.exit(1) }
      if (!opts.confirm) {
        console.error(
          `This will archive project ${resolvedId} and delete all its reports, fix_attempts, and codebase_files.\n` +
            'Re-run with --confirm to proceed.',
        )
        process.exit(1)
      }
      const data = await apiCall(
        `/v1/admin/projects/${resolvedId}/reset`,
        config,
        { method: 'POST' },
      ) as unknown as Record<string, unknown>
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2))
      } else if ((data as Record<string, unknown>).ok) {
        console.log(`Project ${resolvedId} archived and test data wiped.`)
      } else {
        console.error('Reset failed:', JSON.stringify(data, null, 2))
        process.exit(1)
      }
    })
}
