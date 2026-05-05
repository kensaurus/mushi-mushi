/**
 * Test fixtures for `no-dead-handler`. Uses ESLint's classic RuleTester
 * since flat-config tester APIs are still in flux (and the legacy one
 * is documented + available on every >=8 install).
 */

import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

// Bridge ESLint's RuleTester into Vitest's test runner. Without this,
// `tester.run(...)` calls describe/it on Mocha-style globals that
// Vitest doesn't expose by default.
;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it
;(RuleTester as unknown as { itOnly: typeof it.only }).itOnly = it.only

import rule from './no-dead-handler.js'

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
})

describe('no-dead-handler', () => {
  tester.run('no-dead-handler', rule as never, {
    valid: [
      {
        code: `const Btn = () => <button onClick={() => save()} />`,
      },
      {
        code: `const Btn = () => <button onClick={save} />`,
      },
      {
        code: `const Btn = () => <button onClick={useCallback(() => save(), [])} />`,
      },
      {
        // Allowlisted via comment.
        code: `const Btn = () => (
          <button
            // mushi-mushi-allowlist: stub for upcoming feature flag PR-1234
            onClick={() => {}}
          />
        )`,
      },
      {
        // Render-prop / non-handler property ignored.
        code: `const Btn = () => <List render={() => null} />`,
      },
    ],
    invalid: [
      {
        code: `const Btn = () => <button onClick={() => {}} />`,
        errors: [{ messageId: 'empty', data: { handlerName: 'onClick', kind: 'empty block' } }],
      },
      {
        code: `const Btn = () => <button onSubmit={function () {}} />`,
        errors: [
          { messageId: 'empty', data: { handlerName: 'onSubmit', kind: 'empty block' } },
        ],
      },
      {
        code: `const Btn = () => <button onClick={() => null} />`,
        errors: [
          { messageId: 'empty', data: { handlerName: 'onClick', kind: 'arrow returns null' } },
        ],
      },
      {
        code: `const Btn = () => <button onClick={() => { console.log('clicked') }} />`,
        errors: [
          {
            messageId: 'empty',
            data: { handlerName: 'onClick', kind: 'console-only placeholder' },
          },
        ],
      },
      {
        code: `const Btn = () => <button onClick={() => { throw new Error('not implemented yet') }} />`,
        errors: [
          {
            messageId: 'empty',
            data: { handlerName: 'onClick', kind: 'throws not-implemented' },
          },
        ],
      },
      {
        code: `const Btn = () => <button onClick={useCallback(() => {}, [])} />`,
        errors: [{ messageId: 'empty', data: { handlerName: 'onClick', kind: 'empty block' } }],
      },
      {
        // Object-spread style — Property visitor catches it.
        code: `const props = { onClick: () => {} }`,
        errors: [{ messageId: 'empty', data: { handlerName: 'onClick', kind: 'empty block' } }],
      },
    ],
  })
})
