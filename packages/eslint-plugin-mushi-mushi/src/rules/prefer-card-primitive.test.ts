import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './prefer-card-primitive.js'

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

describe('prefer-card-primitive', () => {
  tester.run('prefer-card-primitive', rule as never, {
    valid: [
      {
        filename: 'apps/admin/src/pages/OverviewPage.tsx',
        code: `import { Card } from '../components/ui'
        export function X() { return <Card className="p-4">ok</Card> }`,
      },
      {
        filename: 'apps/admin/src/components/ui/layout.tsx',
        code: `export function Card() { return <div className="rounded border bg-surface-raised" /> }`,
      },
      {
        // Chip / pill — not a Card
        filename: 'apps/admin/src/pages/OddPage.tsx',
        code: `export function OddPage() {
          return <span className="text-3xs bg-surface-overlay border border-edge-subtle px-1.5 py-0.5 rounded-full">disabled</span>
        }`,
      },
      {
        // Form field chrome — not a Card
        filename: 'apps/admin/src/pages/OddPage.tsx',
        code: `export function OddPage() {
          return <input className="w-full bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs" />
        }`,
      },
    ],
    invalid: [
      {
        filename: 'apps/admin/src/pages/OddPage.tsx',
        code: `export function OddPage() {
          return <div className="rounded border bg-surface-overlay p-4">x</div>
        }`,
        errors: [{ messageId: 'preferCard' }],
      },
    ],
  })
})
