import type { Command } from 'commander';
import { evaluateUpgradeCheckExit, runUpgrade } from '../upgrade.js';
import { runSelfUpgrade } from '../self-upgrade.js';

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Bump installed @mushi-mushi/* packages to the latest stable npm release')
    .option('--cwd <path>', 'Target repo (default: cwd)')
    .option('--self', 'Upgrade the globally-installed `mushi` CLI itself (not the project SDK deps)')
    .option('--dry-run', 'Print the install command without running it')
    .option('--check', 'Plan only: exit 0 current, 1 outdated, 2 registry unreachable')
    .option('--json', 'Machine-readable plan + result')
    .addHelpText('after', `
Examples:
  mushi upgrade
  mushi upgrade --dry-run
  mushi upgrade --check         # CI freshness (no install)
  mushi upgrade --self          # upgrade the CLI binary itself
  mushi upgrade --self --dry-run
  mushi upgrade --cwd ../glot.it`)
    .action(async (opts: { cwd?: string; self?: boolean; dryRun?: boolean; json?: boolean; check?: boolean }) => {
      // ─── Self-upgrade path: bump the CLI binary, not the project's SDK deps ───
      if (opts.self) {
        const selfResult = await runSelfUpgrade({ dryRun: opts.dryRun || opts.check })
        if (opts.json) {
          console.log(JSON.stringify(selfResult, null, 2))
        } else {
          console.log(selfResult.message)
        }
        // Exit 1 when an upgrade was available but not applied (so CI/scripts
        // can detect "you're on an old CLI"), except in dry-run / --check mode.
        if (!selfResult.upgraded && selfResult.command && !opts.dryRun && !opts.check) {
          process.exit(1)
        }
        return
      }

      const result = await runUpgrade({
        cwd: opts.cwd,
        dryRun: opts.dryRun,
        json: opts.json,
        check: opts.check,
      })
      if (opts.json) {
        console.log(JSON.stringify({
          ...result,
          ...(opts.check ? { exit: evaluateUpgradeCheckExit(result.plan) } : {}),
        }, null, 2))
      } else {
        console.log(result.message)
        for (const e of result.plan.entries) {
          const tag = e.willUpgrade && e.latest ? `→ v${e.latest}` : '(current)'
          console.log(`  ${e.name}@${e.current} ${tag}`)
        }
      }
      if (opts.check) {
        process.exit(evaluateUpgradeCheckExit(result.plan))
      }
      if (!result.upgraded && result.plan.entries.some((e) => e.willUpgrade) && !opts.dryRun) {
        process.exit(1)
      }
      if (result.plan.entries.length === 0) process.exit(1)
    })
}
