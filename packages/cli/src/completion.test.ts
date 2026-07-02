import { describe, it, expect } from 'vitest'
import {
  buildCommandTree,
  generateCompletionScript,
  isSupportedShell,
  SUPPORTED_SHELLS,
  type CommandLike,
} from './completion.js'

function fakeCommand(name: string, subcommands: string[] = []): CommandLike {
  return {
    name: () => name,
    commands: subcommands.map((s) => fakeCommand(s)),
  }
}

function fakeProgram(children: CommandLike[]): CommandLike {
  return { name: () => 'mushi', commands: children }
}

describe('isSupportedShell', () => {
  it('accepts bash, zsh, fish', () => {
    for (const shell of SUPPORTED_SHELLS) {
      expect(isSupportedShell(shell)).toBe(true)
    }
  })

  it('rejects unknown shells', () => {
    expect(isSupportedShell('powershell')).toBe(false)
    expect(isSupportedShell('')).toBe(false)
    expect(isSupportedShell('Bash')).toBe(false)
  })
})

describe('buildCommandTree', () => {
  it('maps top-level commands and their subcommands', () => {
    const program = fakeProgram([
      fakeCommand('login'),
      fakeCommand('qa', ['stories', 'runs', 'run']),
    ])
    const tree = buildCommandTree(program)
    expect(tree).toEqual([
      { name: 'login', subcommands: [] },
      { name: 'qa', subcommands: ['run', 'runs', 'stories'] },
    ])
  })

  it('filters out Commander\'s auto-added help command at both levels', () => {
    const program = fakeProgram([
      fakeCommand('help'),
      fakeCommand('qa', ['help', 'stories']),
    ])
    const tree = buildCommandTree(program)
    expect(tree).toEqual([{ name: 'qa', subcommands: ['stories'] }])
  })

  it('sorts top-level commands and subcommands alphabetically for stable output', () => {
    const program = fakeProgram([
      fakeCommand('zeta'),
      fakeCommand('alpha', ['zzz', 'aaa']),
    ])
    const tree = buildCommandTree(program)
    expect(tree.map((n) => n.name)).toEqual(['alpha', 'zeta'])
    expect(tree[0].subcommands).toEqual(['aaa', 'zzz'])
  })

  it('returns an empty subcommands array for leaf commands', () => {
    const program = fakeProgram([fakeCommand('whoami')])
    expect(buildCommandTree(program)[0].subcommands).toEqual([])
  })
})

describe('generateCompletionScript — bash', () => {
  const tree = buildCommandTree(fakeProgram([fakeCommand('login'), fakeCommand('qa', ['stories'])]))
  const treeWithCompletion = buildCommandTree(
    fakeProgram([fakeCommand('login'), fakeCommand('qa', ['stories']), fakeCommand('completion')]),
  )

  it('registers the completion function against the mushi command', () => {
    const script = generateCompletionScript('bash', tree)
    expect(script).toContain('complete -F _mushi_completion mushi')
  })

  it('lists all top-level commands in the COMP_CWORD -eq 1 branch', () => {
    const script = generateCompletionScript('bash', tree)
    expect(script).toContain('compgen -W "login qa"')
  })

  it('emits a case branch for a command with subcommands', () => {
    const script = generateCompletionScript('bash', tree)
    expect(script).toMatch(/qa\)\s*\n\s*COMPREPLY=\( \$\(compgen -W "stories" -- "\$cur"\) \)/)
  })

  it('does not emit a case branch for a leaf command with no subcommands', () => {
    const script = generateCompletionScript('bash', tree)
    expect(script).not.toMatch(/^\s{4}login\)/m)
  })

  it('special-cases the completion command to complete its own shell argument', () => {
    const script = generateCompletionScript('bash', treeWithCompletion)
    expect(script).toContain('compgen -W "bash zsh fish" -- "$cur"')
  })
})

describe('generateCompletionScript — zsh', () => {
  const tree = buildCommandTree(fakeProgram([fakeCommand('login'), fakeCommand('qa', ['stories'])]))

  it('starts with the zsh #compdef pragma', () => {
    expect(generateCompletionScript('zsh', tree).startsWith('#compdef mushi')).toBe(true)
  })

  it('lists top-level commands via _describe', () => {
    const script = generateCompletionScript('zsh', tree)
    expect(script).toContain("top_level=(login qa)")
    expect(script).toContain("_describe 'command' top_level")
  })

  it('emits a subcommand case branch using _describe', () => {
    const script = generateCompletionScript('zsh', tree)
    expect(script).toContain("subcmds=(stories)")
    expect(script).toContain("_describe 'qa subcommand' subcmds")
  })
})

describe('generateCompletionScript — fish', () => {
  const tree = buildCommandTree(fakeProgram([fakeCommand('login'), fakeCommand('qa', ['stories'])]))

  it('registers top-level completion via __fish_use_subcommand', () => {
    const script = generateCompletionScript('fish', tree)
    expect(script).toContain('complete -c mushi -f -n "__fish_use_subcommand" -a "login qa"')
  })

  it('registers a subcommand completion line scoped to the parent command', () => {
    const script = generateCompletionScript('fish', tree)
    expect(script).toContain('complete -c mushi -f -n "__fish_seen_subcommand_from qa" -a "stories"')
  })

  it('does not emit a subcommand line for a leaf command', () => {
    const script = generateCompletionScript('fish', tree)
    expect(script).not.toContain('__fish_seen_subcommand_from login')
  })
})

describe('generateCompletionScript — parity across shells', () => {
  it('every shell script mentions every top-level command name', () => {
    const tree = buildCommandTree(
      fakeProgram([fakeCommand('login'), fakeCommand('qa', ['stories']), fakeCommand('doctor')]),
    )
    for (const shell of SUPPORTED_SHELLS) {
      const script = generateCompletionScript(shell, tree)
      for (const node of tree) {
        expect(script).toContain(node.name)
      }
    }
  })
})
