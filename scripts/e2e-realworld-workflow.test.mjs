/**
 * FILE: scripts/e2e-realworld-workflow.test.mjs
 * PURPOSE: Pin the RealWorld CI gate so `pnpm e2e:realworld` cannot drop
 *          out of GitHub Actions again (BL-007).
 *
 * USAGE: node --test scripts/e2e-realworld-workflow.test.mjs
 *        (also listed in the root `test:scripts` script)
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(join(ROOT, '.github/workflows/e2e-realworld.yml'), 'utf8')

describe('e2e-realworld.yml', () => {
  it('runs the hermetic RealWorld suite', () => {
    assert.match(workflow, /MUSHI_REALWORLD:\s*'1'/)
    assert.match(workflow, /pnpm e2e:realworld/)
    assert.match(workflow, /playwright install --with-deps chromium/)
  })

  it('builds the workspace packages the fixtures import from dist/', () => {
    assert.match(workflow, /@mushi-mushi\/react\.\.\./)
    assert.match(workflow, /@mushi-mushi\/node\.\.\./)
  })

  it('stays off unrelated pull requests and still runs on its own', () => {
    assert.match(workflow, /workflow_dispatch:/)
    assert.match(workflow, /cron:\s*'15 5 \* \* \*'/)
    assert.match(workflow, /paths:/)
    assert.match(workflow, /examples\/realworld\/\*\*/)
    assert.match(workflow, /packages\/core\/\*\*/)
    assert.match(workflow, /packages\/web\/\*\*/)
    assert.match(workflow, /packages\/react\/\*\*/)
    assert.match(workflow, /packages\/node\/\*\*/)
  })

  it('keeps the ci-cost bounds the other workflows use', () => {
    assert.match(workflow, /concurrency:/)
    assert.match(workflow, /timeout-minutes:\s*25/)
    assert.match(workflow, /runs-on:\s*ubuntu-latest/)
    assert.match(workflow, /retention-days:\s*7/)
    assert.doesNotMatch(workflow, /macos-/)
  })
})
