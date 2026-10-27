/**
 * Mushi report b0a9a959: a `js:./scripts/login.js` script must load from
 * the project the runner is started in, not from the runner's own
 * install folder.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __test } from './index.js'

let project: string
const startDir = process.cwd()

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mushi-auth-project-'))
  mkdirSync(join(project, 'scripts'))
  writeFileSync(
    join(project, 'scripts', 'login.js'),
    'export default async function login(page) { page.calls.push("logged-in") }\n',
  )
  process.chdir(project)
})

afterEach(() => {
  process.chdir(startDir)
  rmSync(project, { recursive: true, force: true })
})

describe('js: login scripts', () => {
  it('loads ./scripts/login.js from the project directory', async () => {
    const page = { calls: [] as string[] }
    await __test.runLoginScript(page as never, {} as never, 'js:./scripts/login.js')
    expect(page.calls).toEqual(['logged-in'])
  })

  it('resolves against the inventory file folder when one is named', async () => {
    const app = join(project, 'apps', 'web')
    mkdirSync(join(app, 'scripts'), { recursive: true })
    writeFileSync(join(app, 'scripts', 'login.js'), 'export default async function login(page) { page.calls.push("web") }\n')
    const page = { calls: [] as string[] }
    await __test.runLoginScript(page as never, {} as never, 'js:./scripts/login.js', app)
    expect(page.calls).toEqual(['web'])
  })
})
