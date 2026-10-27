/**
 * Mushi report 4a84322c: action.yml did not declare the spec-drift inputs
 * or several outputs the CLI sets, so GitHub warned "Unexpected input" and
 * workflows could not read the outputs. action.yml and cli.ts must agree.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const action = readFileSync(new URL('../action.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const cli = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8')

/** Top-level keys of one action.yml section (`inputs:` / `outputs:`), in order. */
function sectionKeys(section: 'inputs' | 'outputs'): string[] {
  const start = action.indexOf(`\n${section}:\n`)
  expect(start, `action.yml has a ${section} section`).toBeGreaterThan(-1)
  const rest = action.slice(start + section.length + 3)
  const end = rest.search(/\n\S/)
  const body = end === -1 ? rest : rest.slice(0, end)
  return [...body.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gm)].map((m) => m[1])
}

function cliNames(fn: 'getInput' | 'setOutput'): string[] {
  return [...new Set([...cli.matchAll(new RegExp(`core\\.${fn}\\(\\s*'([^']+)'`, 'g'))].map((m) => m[1]))].sort()
}

function cliCommands(): string[] {
  const sw = cli.slice(cli.indexOf('switch (command)'))
  return [...sw.matchAll(/^ {4}case '([a-z-]+)':/gm)].map((m) => m[1])
}

describe('action.yml matches the CLI', () => {
  it('declares every input the CLI reads, and nothing it does not', () => {
    expect([...sectionKeys('inputs')].sort()).toEqual(cliNames('getInput'))
  })

  it('declares every output the CLI sets, and nothing it does not', () => {
    expect([...sectionKeys('outputs')].sort()).toEqual(cliNames('setOutput'))
  })

  it('the command input and the unknown-command error list every command', () => {
    const commands = cliCommands()
    expect(commands).toContain('spec-drift')
    const commandInput = action.match(/\n {2}command:\n {4}description: '([^']+)'/)?.[1] ?? ''
    const unknown = cli.match(/unknown command: \$\{command\}\. Expected ([^.]+)\./)?.[1] ?? ''
    for (const c of commands) {
      expect(commandInput.split(/\s*\|\s*|:\s*/), `action.yml command lists ${c}`).toContain(c)
      expect(unknown.split(/\s*\|\s*/), `unknown-command error lists ${c}`).toContain(c)
    }
  })
})
