import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-hand-rolled-tablist.js'

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
})

describe('no-hand-rolled-tablist', () => {
  tester.run('no-hand-rolled-tablist', rule as never, {
    valid: [
      {
        filename: 'apps/admin/src/pages/HealthPage.tsx',
        code: `export function HealthPage() { return <SegmentedControl value="a" options={[]} onChange={() => {}} /> }`,
      },
      {
        filename: 'apps/admin/src/components/TabbedSubNav.tsx',
        code: `export function X() { return <div role="tablist"><button role="tab" /></div> }`,
        options: [{ pageFilesOnly: true }],
      },
    ],
    invalid: [
      {
        filename: 'apps/admin/src/pages/SkillPipelinesPage.tsx',
        code: `export function SkillPipelinesPage() {
          return <div role="tablist" aria-label="Sections"><button role="tab" /></div>
        }`,
        errors: [{ messageId: 'handRolledTablist' }],
      },
    ],
  })
})
