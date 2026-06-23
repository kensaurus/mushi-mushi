import type { Command } from 'commander';
import { runUpgrade } from '../upgrade.js';

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Bump installed @mushi-mushi/* packages to the latest stable npm release')
    .option('--cwd <path>', 'Target repo (default: cwd)')
    .option('--dry-run', 'Print the install command without running it')
    .option('--json', 'Machine-readable plan + result')
    .addHelpText('after', `
Examples:
  mushi upgrade
  mushi upgrade --dry-run
  mushi upgrade --cwd ../glot.it`)
    .action(async (opts: { cwd?: string; dryRun?: boolean; json?: boolean }) => {
      const result = await runUpgrade({ cwd: opts.cwd, dryRun: opts.dryRun, json: opts.json })
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(result.message)
        for (const e of result.plan.entries) {
          const tag = e.willUpgrade && e.latest ? `→ v${e.latest}` : '(current)'
          console.log(`  ${e.name}@${e.current} ${tag}`)
        }
      }
      if (!result.upgraded && result.plan.entries.some((e) => e.willUpgrade) && !opts.dryRun) {
        process.exit(1)
      }
      if (result.plan.entries.length === 0) process.exit(1)
    })
}
