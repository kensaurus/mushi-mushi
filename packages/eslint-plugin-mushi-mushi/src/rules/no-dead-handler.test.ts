/**
 * Test fixtures for `no-dead-handler`. Uses ESLint's classic RuleTester
 * since flat-config tester APIs are still in flux (and the legacy one
 * is documented + available on every >=8 install).
 *
 * Round 8 (2026-05-21) — registered `@typescript-eslint/parser` so the
 * rule actually parses TypeScript-flavoured fixtures. Before this, any
 * test fixture using `as`, `satisfies`, generic `<T>`, or interface
 * declarations was silently a parse error and the rule was untested
 * against the syntax 95% of consumers ship.
 */

import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser ships its own loose typings; we only need
// the default-export factory function at runtime.
import tsParser from '@typescript-eslint/parser'

// Bridge ESLint's RuleTester into Vitest's test runner. Without this,
// `tester.run(...)` calls describe/it on Mocha-style globals that
// Vitest doesn't expose by default.
;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it
;(RuleTester as unknown as { itOnly: typeof it.only }).itOnly = it.only

import rule from './no-dead-handler.js'

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
      {
        // TypeScript: `as` cast inside the handler body — needs the TS parser.
        code: `const Btn = () => <button onClick={() => save() as void} />`,
      },
      {
        // TypeScript: `satisfies` operator — needs the TS parser.
        code: `const handler = (() => save()) satisfies () => void`,
      },
      {
        // TypeScript: generic component definition — needs the TS parser.
        code: `function Btn<T>({ value }: { value: T }) { return <button onClick={() => save(value)} /> }`,
      },
      {
        // TypeScript: interface + type annotation on the handler.
        code: `interface Props { onSubmit: () => void } const F = (p: Props) => <form onSubmit={p.onSubmit} />`,
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
      {
        // TypeScript object property with type annotation — would have
        // been a silent parse error before B15 wired the TS parser.
        code: `const props: { onSubmit: () => void } = { onSubmit: () => {} }`,
        errors: [{ messageId: 'empty', data: { handlerName: 'onSubmit', kind: 'empty block' } }],
      },
    ],
  })
})
