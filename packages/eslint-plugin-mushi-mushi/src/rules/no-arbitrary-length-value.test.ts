import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-arbitrary-length-value.js'

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

describe('no-arbitrary-length-value', () => {
  tester.run('no-arbitrary-length-value', rule as never, {
    valid: [
      {
        filename: 'apps/admin/src/pages/OverviewPage.tsx',
        code: `export function X() { return <div className="w-full max-w-lg gap-4" /> }`,
      },
      {
        filename: 'apps/admin/src/pages/OverviewPage.tsx',
        code: `export function X() { return <div className="w-[var(--chrome-row-height)]" /> }`,
      },
      {
        filename: 'apps/admin/src/pages/OverviewPage.tsx',
        code: `export function X() {
          return (
            // mushi-mushi-allowlist: canvas fixed width
            <div className="w-[240px]" />
          )
        }`,
      },
    ],
    invalid: [
      {
        filename: 'apps/admin/src/pages/OverviewPage.tsx',
        code: `export function X() { return <div className="w-[240px] text-[13px]" /> }`,
        errors: [{ messageId: 'arbitraryValue' }, { messageId: 'arbitraryValue' }],
      },
    ],
  })
})
