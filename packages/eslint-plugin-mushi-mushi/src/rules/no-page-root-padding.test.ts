import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-page-root-padding.js'

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

describe('no-page-root-padding', () => {
  tester.run('no-page-root-padding', rule as never, {
    valid: [
      {
        filename: 'apps/admin/src/pages/OverviewPage.tsx',
        code: `import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
        import { PageHeaderBar } from '../components/PageHeaderBar'
        export function OverviewPage() {
          return <div className={PAGE_CONTENT_STACK}><PageHeaderBar title="X" /></div>
        }`,
      },
      {
        filename: 'apps/admin/src/pages/LoginPage.tsx',
        code: `export function LoginPage() { return <div className="p-4" /> }`,
      },
      {
        // Nested control padding must NOT be flagged as page-root padding
        // (regression: </PageHeaderBar> closing tag false-positive).
        filename: 'apps/admin/src/pages/ReportsPage.tsx',
        code: `import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
        import { PageHeaderBar } from '../components/PageHeaderBar'
        export function ReportsPage() {
          return (
            <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-reports">
              <PageHeaderBar title="Reports">
                <button className="inline-flex px-1.5 py-0.5">?</button>
              </PageHeaderBar>
            </div>
          )
        }`,
      },
    ],
    invalid: [
      {
        filename: 'apps/admin/src/pages/DriftPage.tsx',
        code: `import { PageHeaderBar } from '../components/PageHeaderBar'
        export function DriftPage() {
          return <div className="space-y-4"><PageHeaderBar title="X" /></div>
        }`,
        errors: [{ messageId: 'missingStack' }],
      },
      {
        filename: 'apps/admin/src/pages/OddPage.tsx',
        code: `import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
        import { PageHeaderBar } from '../components/PageHeaderBar'
        export function OddPage() {
          return <div className="p-6" data-testid="mushi-page-odd"><PageHeaderBar title="X" /></div>
        }`,
        errors: [{ messageId: 'rootPadding' }],
      },
    ],
  })
})
