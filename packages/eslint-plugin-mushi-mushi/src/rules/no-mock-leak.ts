/**
 * Rule: `mushi-mushi/no-mock-leak` (Gate 2, whitepaper §5)
 *
 * Catches obvious mock data leaking into production paths. The agentic
 * failure mode here is: an LLM scaffolds a list view, fills it with
 * `Array.from({length: 10}, (_, i) => ({name: 'John Doe', email: ...}))`,
 * the customer ships, the page renders fake data forever.
 *
 * What the rule flags:
 *   - imports of `@faker-js/faker` / `faker` / `chance` / `casual` from
 *     a path NOT under a `__tests__|tests|test|spec|stories|fixtures|mocks`
 *     directory.
 *   - imports of `msw`, `msw/node`, `nock`, `axios-mock-adapter` from
 *     non-test paths.
 *   - top-level / module-scope arrays whose every element has the same
 *     `{ name: 'John Doe' | 'Jane Doe' | 'Lorem' | 'Foo' | 'Bar' }`
 *     hardcoded shape (the textbook scaffolding heuristic).
 *   - hardcoded `lorem ipsum` / `placeholder@example.com` strings in
 *     non-test paths.
 *
 * The rule is INTENTIONALLY conservative — false positives are bad UX
 * for the customer. Borderline shapes (a single `John Doe` mention in
 * the middle of real code) are NOT flagged. The customer can extend
 * `mockHostNames` / `placeholderPatterns` per their stack.
 */

import type { Rule } from 'eslint'
import type { ImportDeclaration, ArrayExpression, Literal, Property } from 'estree'

const DEFAULT_MOCK_HOSTS = [
  '@faker-js/faker',
  'faker',
  'chance',
  'casual',
  'msw',
  'msw/node',
  'msw/browser',
  'nock',
  'axios-mock-adapter',
  '@mswjs/data',
]

const DEFAULT_PLACEHOLDER_NAMES = ['John Doe', 'Jane Doe', 'Foo Bar', 'Lorem Ipsum']
const DEFAULT_PLACEHOLDER_EMAILS = /placeholder@example\.com|test@example\.com|user@example\.com/i
const DEFAULT_LOREM_REGEX =
  /\blorem\s+ipsum\b|\bdolor\s+sit\s+amet\b/i

const TEST_DIR_REGEX = /[\\/](__tests__|tests?|spec|stories|fixtures|mocks|__mocks__)[\\/]/i
const TEST_FILENAME_REGEX = /\.(test|spec|stories|mock)\./i

const meta: Rule.RuleMetaData = {
  type: 'problem',
  docs: {
    description:
      'Forbid mock data + faker imports outside test paths (Mushi Mushi v2 Gate 2).',
    recommended: true,
  },
  schema: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        mockHostNames: { type: 'array', items: { type: 'string' } },
        placeholderNames: { type: 'array', items: { type: 'string' } },
      },
    },
  ],
  messages: {
    mockImport:
      'Import of `{{module}}` outside test paths. Mock libraries must not ship to production (Gate 2).',
    placeholderArray:
      'Array of placeholder objects ({{count}} entries with names like "{{example}}") detected outside test paths. Replace with real data or move to a test fixture.',
    placeholderText:
      'Placeholder text "{{snippet}}" detected outside test paths. Mocks must not ship to production.',
  },
}

function isTestPath(filename: string): boolean {
  return TEST_DIR_REGEX.test(filename) || TEST_FILENAME_REGEX.test(filename)
}

function getStringArrayProperty(prop: Property): string | null {
  if (prop.key.type !== 'Identifier' || prop.key.name !== 'name') return null
  if (prop.value.type !== 'Literal') return null
  const v = prop.value.value
  return typeof v === 'string' ? v : null
}

export default {
  meta,
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? ''
    if (isTestPath(filename)) return {}

    const opts = context.options[0] ?? {}
    const hosts = (opts.mockHostNames as string[] | undefined) ?? DEFAULT_MOCK_HOSTS
    const placeholders =
      (opts.placeholderNames as string[] | undefined) ?? DEFAULT_PLACEHOLDER_NAMES

    const placeholderSet = new Set(placeholders.map((s) => s.toLowerCase()))

    function checkArrayLiteral(node: ArrayExpression): void {
      if (node.elements.length < 2) return
      let hits = 0
      let exampleName: string | null = null
      for (const el of node.elements) {
        if (!el || el.type !== 'ObjectExpression') return
        for (const prop of el.properties) {
          if (prop.type !== 'Property') continue
          const name = getStringArrayProperty(prop)
          if (name && placeholderSet.has(name.toLowerCase())) {
            hits += 1
            exampleName ??= name
            break
          }
        }
      }
      // Require at least 2 placeholder hits AND > 50% of array — keeps a
      // single "John Doe" mention from tripping the rule.
      if (hits >= 2 && hits / node.elements.length >= 0.5) {
        context.report({
          node: node as never,
          messageId: 'placeholderArray',
          data: { count: String(hits), example: exampleName ?? 'placeholder' },
        })
      }
    }

    function checkLiteral(node: Literal): void {
      const v = node.value
      if (typeof v !== 'string' || v.length < 8) return
      if (DEFAULT_LOREM_REGEX.test(v)) {
        context.report({
          node: node as never,
          messageId: 'placeholderText',
          data: { snippet: v.slice(0, 40) },
        })
        return
      }
      if (DEFAULT_PLACEHOLDER_EMAILS.test(v)) {
        context.report({
          node: node as never,
          messageId: 'placeholderText',
          data: { snippet: v.slice(0, 40) },
        })
      }
    }

    return {
      ImportDeclaration(node: ImportDeclaration) {
        const src = node.source.value
        if (typeof src !== 'string') return
        if (hosts.includes(src) || hosts.some((h) => src.startsWith(`${h}/`))) {
          context.report({
            node: node as never,
            messageId: 'mockImport',
            data: { module: src },
          })
        }
      },
      ArrayExpression(node) {
        checkArrayLiteral(node as ArrayExpression)
      },
      Literal(node) {
        checkLiteral(node as Literal)
      },
    }
  },
} satisfies Rule.RuleModule
