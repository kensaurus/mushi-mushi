/**
 * packages/cli/action.yml — the packaged CI step (gap #19). Pins the inputs,
 * the opt-in portfolio checks, back-compat for the source-map upload, the
 * no-`${{ inputs.* }}`-in-`run:` rule, and that every CLI command and flag
 * the action calls exists in this CLI.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { registerRadarCommands } from './commands/radar.js'
import { registerRecipeCommands } from './commands/recipe.js'

const yml = readFileSync(resolve(__dirname, '../action.yml'), 'utf8')

/** The YAML block of one input (`  name:` up to the next sibling key). */
function inputBlock(name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`)
  expect(start, `input ${name}`).toBeGreaterThan(-1)
  const rest = yml.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n|\noutputs:/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

/** The YAML block of one step, found by its id. */
function stepBlock(id: string): string {
  const start = yml.indexOf(`      id: ${id}\n`)
  expect(start, `step ${id}`).toBeGreaterThan(-1)
  const from = yml.lastIndexOf('\n    - name:', start)
  const end = yml.indexOf('\n    - name:', start)
  return yml.slice(from, end === -1 ? yml.indexOf('\n# ──', start) : end)
}

function longFlags(program: Command, path: string[]): string[] {
  let cmd: Command | undefined = program
  for (const name of path) cmd = cmd?.commands.find((c) => c.name() === name)
  expect(cmd, path.join(' ')).toBeDefined()
  return (cmd as Command).options.map((o) => o.long ?? '')
}

describe('action.yml inputs', () => {
  it('keeps the source-map upload on by default for existing users', () => {
    expect(inputBlock('upload-sourcemaps')).toMatch(/default: 'true'/)
    expect(stepBlock('upload')).toContain("if: inputs.upload-sourcemaps == 'true'")
    expect(inputBlock('api-key')).toMatch(/required: true/)
  })

  it('makes both portfolio checks opt-in, failing by default', () => {
    expect(inputBlock('radar-scan')).toMatch(/default: 'false'/)
    expect(inputBlock('recipe-check')).toMatch(/default: 'false'/)
    expect(inputBlock('fail-on-error')).toMatch(/default: 'true'/)
    expect(inputBlock('working-directory')).toMatch(/default: '\.'/)
  })
})

describe('action.yml steps', () => {
  it('runs radar scan --push and recipe check --push only when asked', () => {
    const radar = stepBlock('radar')
    expect(radar).toContain("if: inputs.radar-scan == 'true'")
    expect(radar).toMatch(/radar scan --push --dir "\$MUSHI_WORKDIR"/)
    const recipe = stepBlock('recipe')
    expect(recipe).toContain("if: inputs.recipe-check == 'true'")
    expect(recipe).toMatch(/recipe check --push --dir "\$MUSHI_WORKDIR"/)
  })

  it('turns a failed check into a warning only when fail-on-error is false', () => {
    for (const id of ['radar', 'recipe']) {
      const step = stepBlock(id)
      expect(step).toContain('if [ "$MUSHI_FAIL_ON_ERROR" = "true" ]')
      expect(step).toContain('::warning title=')
      expect(step).toContain('echo "pushed=true" >> "$GITHUB_OUTPUT"')
    }
  })

  it('passes the key and every input through env, never ${{ inputs.* }} inside run:', () => {
    const runBlocks = [...yml.matchAll(/ {6}run: \|\n((?: {8}.*\n?)+)/g)].map((m) => m[1])
    expect(runBlocks).toHaveLength(3)
    for (const block of runBlocks) expect(block).not.toContain('${{')
    for (const id of ['upload', 'radar', 'recipe']) {
      expect(stepBlock(id)).toContain('MUSHI_API_KEY: ${{ inputs.api-key }}')
    }
  })
})

describe('the CLI commands the action calls exist', () => {
  const program = new Command()
  registerRadarCommands(program)
  registerRecipeCommands(program)

  it('radar scan takes --push and --dir', () => {
    expect(longFlags(program, ['radar', 'scan'])).toEqual(expect.arrayContaining(['--push', '--dir']))
  })
  it('recipe check takes --push and --dir', () => {
    expect(longFlags(program, ['recipe', 'check'])).toEqual(expect.arrayContaining(['--push', '--dir']))
  })
})

/** Next minor of a 0.x/1.x semver (what a pending `minor` changeset releases). */
function nextMinor(v: string): string {
  const [maj, min] = v.split('.').map(Number)
  return `${maj}.${min + 1}.0`
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

describe('the minimum CLI version the portfolio checks need', () => {
  const pkgVersion = (JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string }).version
  const changeset = resolve(__dirname, '../../../.changeset/radar-cli.md')
  const mins = [...yml.matchAll(/MUSHI_CLI_MIN_PORTFOLIO: '([0-9.]+)'/g)].map((m) => m[1])

  it('both portfolio steps check it before calling the command', () => {
    expect(mins).toHaveLength(2)
    expect(new Set(mins).size).toBe(1)
    for (const id of ['radar', 'recipe']) {
      const step = stepBlock(id)
      expect(step).toContain('--version')
      expect(step).toContain('sort -V')
      expect(step).toContain('::error title=')
      expect(step).toContain('if [ "$cli_ok" = "true" ] && npx')
    }
  })

  it('is the release that ships radar and recipe', () => {
    // While the radar changeset is unreleased, the published CLI has no radar
    // command: the minimum is the next minor. After release, the package
    // version already includes it.
    if (existsSync(changeset)) expect(mins[0]).toBe(nextMinor(pkgVersion))
    else expect(cmpSemver(mins[0], pkgVersion)).toBeLessThanOrEqual(0)
  })

  it('the inputs and the docs say the same version', () => {
    expect(inputBlock('radar-scan')).toContain(`@mushi-mushi/cli ${mins[0]} or later`)
    expect(inputBlock('recipe-check')).toContain(`@mushi-mushi/cli ${mins[0]} or later`)
    expect(inputBlock('cli-version')).toContain(`${mins[0]} or later`)
    const docs = readFileSync(resolve(__dirname, '../../../apps/docs/content/sdks/cli.mdx'), 'utf8')
    expect(docs).toContain(`\`@mushi-mushi/cli\` ${mins[0]} or later`)
  })
})
