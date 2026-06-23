import type { Command } from 'commander';
import { renderNudgeSnippet, renderNudgeExplainer } from '../nudge.js';
import type { NudgePhase } from '../nudge.js';

export function registerNudgeCommand(program: Command): void {
  program
    .command('nudge')
    .description(
      'Generate a Mushi.init() snippet tuned for your release phase ' +
        '(alpha, beta, ga). Customises proactive triggers, cooldowns, ' +
        'feature-request card, and beta-mode UI.',
    )
    .option('--phase <phase>', 'Release phase: alpha | beta | ga', 'beta')
    .option('--explain', 'Print a human-readable summary of what the preset does')
    .option('--max <n>', 'Override maxProactivePerSession')
    .option('--cooldown <hours>', 'Override dismissCooldownHours')
    .option('--dwell <minutes>', 'Override page-dwell threshold (0 disables)')
    .option('--welcome <seconds>', 'Override first-session welcome delay (0 disables)')
    .action((opts: {
      phase: string
      explain?: boolean
      max?: string
      cooldown?: string
      dwell?: string
      welcome?: string
    }) => {
      const validPhases: NudgePhase[] = ['alpha', 'beta', 'ga']
      if (!validPhases.includes(opts.phase as NudgePhase)) {
        console.error(`Unknown phase "${opts.phase}". Use one of: ${validPhases.join(', ')}`)
        process.exit(1)
      }
      const phase = opts.phase as NudgePhase
      const overrides: Record<string, number> = {}
      const parseNumericFlag = (flag: string, raw: string, min: number): number => {
        const n = Number(raw)
        if (!Number.isFinite(n) || n < min) {
          console.error(
            `error: --${flag} must be a finite number >= ${min} (got "${raw}")`,
          )
          process.exit(1)
        }
        return n
      }
      if (opts.max !== undefined) overrides.maxProactivePerSession = parseNumericFlag('max', opts.max, 1)
      if (opts.cooldown !== undefined) overrides.dismissCooldownHours = parseNumericFlag('cooldown', opts.cooldown, 0)
      if (opts.dwell !== undefined) overrides.pageDwellMinutes = parseNumericFlag('dwell', opts.dwell, 0)
      if (opts.welcome !== undefined) overrides.firstSessionSeconds = parseNumericFlag('welcome', opts.welcome, 0)
      if (opts.explain) {
        console.log(renderNudgeExplainer(phase))
      }
      console.log(renderNudgeSnippet({ phase, overrides }))
    })
}
