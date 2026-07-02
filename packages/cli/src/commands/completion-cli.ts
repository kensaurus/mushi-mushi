/**
 * FILE: packages/cli/src/commands/completion-cli.ts
 * PURPOSE: `mushi completion <shell>` — print a bash/zsh/fish completion script.
 */
import { Argument, type Command } from 'commander';
import { buildCommandTree, generateCompletionScript, isSupportedShell, SUPPORTED_SHELLS } from '../completion.js'

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion')
    .description('Print a shell completion script for bash, zsh, or fish')
    .addArgument(new Argument('<shell>', 'Target shell').choices([...SUPPORTED_SHELLS]))
    .addHelpText('after', `
Examples:
  eval "$(mushi completion bash)"                      # try it for the current session
  mushi completion bash >> ~/.bashrc                   # bash: persist across sessions
  mushi completion zsh > "\${fpath[1]}/_mushi"           # zsh: needs a dir already on $fpath
  mushi completion fish > ~/.config/fish/completions/mushi.fish`)
    .action((shell: string) => {
      // Commander's .choices() already rejects anything else before we get
      // here; the guard is just to give TS a real SupportedShell instead of
      // a bare string (and to fail closed, not open, if that ever changes).
      if (!isSupportedShell(shell)) {
        console.error(`Unsupported shell "${shell}". Supported: ${SUPPORTED_SHELLS.join(', ')}`)
        process.exit(2)
      }
      // Built from the live command tree at call time (after every
      // registerXCommands() call above has run), so it can't drift from the
      // real subcommand list the way a hand-maintained array would.
      const tree = buildCommandTree(program)
      console.log(generateCompletionScript(shell, tree))
    })
}
