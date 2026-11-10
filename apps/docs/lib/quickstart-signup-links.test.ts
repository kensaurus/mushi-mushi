/**
 * Every framework quickstart says where the project ID and API key come from,
 * before the code that reads them, with a signup link tagged for that page.
 *
 * Why: the quickstarts used to read `VITE_MUSHI_API_KEY` in step 2 without
 * ever saying how to get one. A reader on the manual path stalled there, and
 * a signup that did happen could not be traced to the page (the console's
 * signup form records `?src=`; see apps/admin/src/lib/signupAttribution.ts).
 * Migration guides with a "Create a Mushi Mushi project" step carry the same
 * kind of link, tagged `migration-<slug>`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'content')
const SIGNUP = 'https://kensaur.us/mushi-mushi/admin/signup?src='
const KEY_STEP = '## Get your project ID and API key'

/** Pages whose code needs a project ID and an API key. */
const FRAMEWORK_QUICKSTARTS = [
  'react',
  'web',
  'vue',
  'svelte',
  'angular',
  'react-native',
  'capacitor',
  'flutter',
  'ios',
  'android',
] as const

function read(rel: string): string {
  return readFileSync(join(CONTENT, rel), 'utf8')
}

describe('framework quickstarts say where the key comes from', () => {
  it.each(FRAMEWORK_QUICKSTARTS)('%s has a key step with its own signup link', (name) => {
    const source = read(`quickstart/${name}.mdx`)
    expect(source).toContain(KEY_STEP)
    expect(source).toContain(`${SIGNUP}quickstart-${name})`)
  })

  it.each(FRAMEWORK_QUICKSTARTS)('%s puts the key step before the first code that reads the key', (name) => {
    const source = read(`quickstart/${name}.mdx`)
    const step = source.indexOf(KEY_STEP)
    const firstKeyUse = source.search(/apiKey|MUSHI_API_KEY|data-key/)
    expect(step).toBeGreaterThan(-1)
    expect(firstKeyUse).toBeGreaterThan(step)
  })
})

describe('migration guides link the create-project step to signup', () => {
  const withCreateStep = readdirSync(join(CONTENT, 'migrations'))
    .filter((f) => f.endsWith('.mdx'))
    .filter((f) => read(`migrations/${f}`).includes("id: 'create-project'"))

  it('finds the guides that have a create-project step', () => {
    expect(withCreateStep.length).toBeGreaterThan(0)
  })

  it.each(withCreateStep)('%s links signup with its own slug', (file) => {
    const slug = file.replace(/\.mdx$/, '')
    expect(read(`migrations/${file}`)).toContain(`${SIGNUP}migration-${slug}"`)
  })
})
