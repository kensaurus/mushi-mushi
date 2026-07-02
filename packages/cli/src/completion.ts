/**
 * FILE: packages/cli/src/completion.ts
 * PURPOSE: Generate bash/zsh/fish shell-completion scripts from the live
 *          Commander command tree (`mushi completion <shell>` — see
 *          commands/completion-cli.ts for the wiring). Pure/testable: takes
 *          a plain data structure, not a live `Command`, so tests don't need
 *          to construct a real Commander program.
 *
 * clig.dev flags shell completion as a cheap, high-payoff DX win most CLIs
 * skip. Commander itself ships none (confirmed: no built-in generator as of
 * v15), and third-party completion libraries (@bomb.sh/tab,
 * @gutenye/commander-completion-carapace) would add a new runtime dependency
 * to a widely-installed package just for this. Hand-rolled static scripts
 * (the same approach git/npm/gh/docker use) avoid that supply-chain surface
 * entirely and are derived from the real command tree so they can't drift.
 */

export const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish'] as const
export type SupportedShell = (typeof SUPPORTED_SHELLS)[number]

export function isSupportedShell(value: string): value is SupportedShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value)
}

export interface CommandTreeNode {
  name: string
  subcommands: string[]
}

/** Minimal shape we need from a Commander `Command` — avoids importing commander into tests. */
export interface CommandLike {
  name(): string
  readonly commands: readonly CommandLike[]
}

/**
 * Walk the live program's command tree into a plain, serializable structure.
 * Filters out Commander's auto-added `help` command (not a real subcommand
 * a user would tab-complete into) and sorts alphabetically for a stable,
 * readable script across regenerations.
 */
export function buildCommandTree(program: CommandLike): CommandTreeNode[] {
  return program.commands
    .filter((cmd) => cmd.name() !== 'help')
    .map((cmd) => ({
      name: cmd.name(),
      subcommands: cmd.commands
        .filter((sub) => sub.name() !== 'help')
        .map((sub) => sub.name())
        .sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// `completion <shell>` itself takes a positional shell name, not a
// subcommand — special-cased here so `mushi completion <TAB>` still offers
// something useful instead of nothing.
const COMPLETION_ARG_VALUES = [...SUPPORTED_SHELLS]

function subcommandsFor(tree: CommandTreeNode[], name: string): string[] {
  if (name === 'completion') return COMPLETION_ARG_VALUES
  return tree.find((n) => n.name === name)?.subcommands ?? []
}

function generateBash(tree: CommandTreeNode[]): string {
  const topLevel = tree.map((n) => n.name).join(' ')
  const cases = tree
    .map((n) => {
      const subs = subcommandsFor(tree, n.name)
      if (subs.length === 0) return null
      return `    ${n.name})\n      COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") )\n      ;;`
    })
    .filter((line): line is string => line !== null)
    .join('\n')

  return `###-begin-mushi-completion-###
# mushi(1) completion — https://github.com/kensaurus/mushi-mushi
# Install: mushi completion bash >> ~/.bashrc   (then restart your shell)
_mushi_completion() {
  local cur
  cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=()

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${topLevel}" -- "$cur") )
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
${cases}
    *)
      ;;
  esac
}
complete -F _mushi_completion mushi
###-end-mushi-completion-###
`
}

function generateZsh(tree: CommandTreeNode[]): string {
  const topLevel = tree.map((n) => n.name).join(' ')
  const cases = tree
    .map((n) => {
      const subs = subcommandsFor(tree, n.name)
      if (subs.length === 0) return null
      return `    ${n.name})\n      local -a subcmds; subcmds=(${subs.join(' ')})\n      _describe '${n.name} subcommand' subcmds\n      ;;`
    })
    .filter((line): line is string => line !== null)
    .join('\n')

  return `#compdef mushi
# mushi(1) completion — https://github.com/kensaurus/mushi-mushi
# Install: mushi completion zsh > "\${fpath[1]}/_mushi"   (then restart your shell)
_mushi() {
  local -a top_level
  top_level=(${topLevel})

  if (( CURRENT == 2 )); then
    _describe 'command' top_level
    return
  fi

  case "\${words[2]}" in
${cases}
    *)
      ;;
  esac
}

_mushi
`
}

function generateFish(tree: CommandTreeNode[]): string {
  const topLevel = tree.map((n) => n.name).join(' ')
  const lines = [
    '# mushi(1) completion — https://github.com/kensaurus/mushi-mushi',
    '# Install: mushi completion fish > ~/.config/fish/completions/mushi.fish',
    `complete -c mushi -f -n "__fish_use_subcommand" -a "${topLevel}"`,
  ]
  for (const n of tree) {
    const subs = subcommandsFor(tree, n.name)
    if (subs.length === 0) continue
    lines.push(`complete -c mushi -f -n "__fish_seen_subcommand_from ${n.name}" -a "${subs.join(' ')}"`)
  }
  return lines.join('\n') + '\n'
}

export function generateCompletionScript(shell: SupportedShell, tree: CommandTreeNode[]): string {
  switch (shell) {
    case 'bash': return generateBash(tree)
    case 'zsh': return generateZsh(tree)
    case 'fish': return generateFish(tree)
  }
}
