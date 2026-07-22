import type { Command } from 'commander';
import { listProfiles, setActiveProfile, loadConfig } from '../config.js';
import { outputIsJson } from '../cli-shared.js';

/**
 * `mushi profile` — manage multiple credential profiles on one machine.
 *
 *   mushi profile list            # show all profiles, mark the active one
 *   mushi profile current         # print the active profile name
 *   mushi profile use <name>      # switch the active profile (creates if new)
 *
 * A profile is a named bundle of {apiKey, endpoint, projectId, …}. Switch with
 * this command, a one-off `--profile <name>` flag, or the `MUSHI_PROFILE` env
 * var. Existing single-profile users are unaffected — their flat config is read
 * as the `default` profile and only upgraded on the first profile-scoped write.
 */
export function registerProfileCommands(program: Command): void {
  const profile = program.command('profile').description('Manage credential profiles (default, staging, per-client)')

  profile
    .command('list')
    .alias('ls')
    .description('List all profiles; the active one is marked with *')
    .option('--json', 'Machine-readable JSON output')
    .action((opts: { json?: boolean }) => {
      const { active, profiles } = listProfiles()
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ active, profiles }, null, 2))
        return
      }
      for (const name of profiles.sort()) {
        const marker = name === active ? '*' : ' '
        // Show whether the profile has credentials without printing them.
        const cfg = loadConfig(undefined, { profile: name })
        const state = cfg.apiKey ? 'configured' : 'empty'
        console.log(`${marker} ${name.padEnd(20)} [${state}]`)
      }
    })

  profile
    .command('current')
    .description('Print the active profile name')
    .action(() => {
      console.log(listProfiles().active)
    })

  profile
    .command('use <name>')
    .description('Switch the active profile (creates an empty one if it does not exist)')
    .action((name: string) => {
      const safe = name.trim()
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(safe)) {
        process.stderr.write('error: profile name must be 1–64 chars of [A-Za-z0-9._-]\n')
        process.exit(2)
      }
      const before = listProfiles()
      setActiveProfile(safe)
      const isNew = !before.profiles.includes(safe)
      console.log(`✓ Active profile: ${safe}${isNew ? ' (new — run `mushi login` to add credentials)' : ''}`)
    })
}
