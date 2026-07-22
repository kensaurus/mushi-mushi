import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-allowlist-jsx-textnode.js'

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

describe('no-allowlist-jsx-textnode', () => {
  tester.run('no-allowlist-jsx-textnode', rule as never, {
    valid: [
      {
        code: `export function X() {
          return (
            <div>
              {/* mushi-mushi-allowlist: intentional arbitrary layout */}
              <span className="min-h-[1.375rem]" />
            </div>
          )
        }`,
      },
      {
        code: `export function X() {
          return (
            <div
              // mushi-mushi-allowlist: intentional arbitrary layout
              className="min-h-[1.375rem]"
            />
          )
        }`,
      },
      {
        code: `export function X() {
          return (
            // mushi-mushi-allowlist: intentional arbitrary layout
            <div className="min-h-[1.375rem]" />
          )
        }`,
      },
      {
        code: `export function X() {
          return <p>Read the mushi-mushi-allowlist docs</p>
        }`,
      },
    ],
    invalid: [
      {
        code: `export function X() {
          return (
            <div>
              // mushi-mushi-allowlist: intentional arbitrary layout
              <span className="min-h-[1.375rem]" />
            </div>
          )
        }`,
        errors: [{ messageId: 'textnode' }],
      },
      {
        code: `export function X() {
          return (
            <>
              // mushi-mushi-allowlist: hand-rolled surface
              <span />
            </>
          )
        }`,
        errors: [{ messageId: 'textnode' }],
      },
    ],
  })
})
