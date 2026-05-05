/**
 * Rule: `mushi-mushi/no-dead-handler` (Gate 1, whitepaper §5)
 *
 * Catches interactive UI elements wired up to handlers that DO NOTHING.
 * The dominant 2025–2026 agentic-coding failure mode: an LLM scaffolds a
 * Submit button, the page compiles, the Sentinel sees no error, the
 * customer ships, the user clicks the button, and nothing happens.
 *
 * What counts as "dead":
 *   - `() => {}`               (empty arrow body)
 *   - `function () {}`         (empty function expression body)
 *   - `() => null`             (return-only arrow with literal null/undefined)
 *   - any of the above wrapped in `useCallback` / `useMemo`
 *   - a function whose body consists ONLY of `console.log(…)` or
 *     `console.warn('TODO: …')` style placeholders
 *   - a function whose body raises `throw new Error('not implemented')`
 *
 * Where to look:
 *   - JSX attributes whose name starts with `on` (onClick, onSubmit,
 *     onPress, onValueChange, …) — covers React + React Native + most
 *     framework conventions.
 *   - Object properties named `onClick` / `onSubmit` / `onPress` /
 *     `onChange` / `onSelect` (so `<button {...{onClick: () => {}}}/>`
 *     style passing is caught too).
 *
 * Allowlist:
 *   - The author can opt out per-call-site with a leading
 *     `// mushi-mushi-allowlist: <reason>` comment. The reason is required
 *     so a follow-up scan can audit them.
 *   - Storybook + test files (`*.stories.*`, `*.test.*`, `*.spec.*`) are
 *     ignored by default; the rule's `ignorePatterns` option lets the
 *     consumer extend it.
 *
 * The rule emits a structured `data` payload (`handlerName`, `kind`)
 * that the CI gate runner persists as `gate_findings` — the admin's
 * /inventory page renders findings with that metadata.
 */

import type { Rule } from 'eslint'
import type { Node } from 'estree'

interface JSXAttribute {
  type: 'JSXAttribute'
  name: { type: 'JSXIdentifier'; name: string }
  value: { type: 'JSXExpressionContainer'; expression: Node } | null
}
interface JSXOpeningElement {
  type: 'JSXOpeningElement'
  name: { type: 'JSXIdentifier'; name: string } | { type: string; name?: string }
  attributes: JSXAttribute[]
}

const DEFAULT_HANDLER_REGEX = /^on[A-Z]/

const meta: Rule.RuleMetaData = {
  type: 'problem',
  docs: {
    description:
      'Forbid empty / placeholder handlers attached to interactive UI elements. Catches the "scaffold compiles but does nothing" failure mode (Mushi Mushi v2 Gate 1).',
    recommended: true,
  },
  schema: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        handlerNamePattern: {
          type: 'string',
          description:
            'JS regex (string form) for prop names treated as handlers. Defaults to `^on[A-Z]`.',
        },
        ignorePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filename glob patterns that opt out of the rule.',
        },
        ignoreEmptyArrowReturningJSX: {
          type: 'boolean',
          description:
            'When true, an arrow that returns JSX (e.g. render-prop callbacks) is NEVER flagged even if its body is short.',
          default: true,
        },
      },
    },
  ],
  messages: {
    empty:
      'Handler `{{handlerName}}` is empty or placeholder ({{kind}}). Either implement it, remove the prop, or annotate with `// mushi-mushi-allowlist: <reason>` if intentional.',
  },
}

function isAllowlisted(context: Rule.RuleContext, node: Node): boolean {
  const sc = context.sourceCode
  const comments = sc.getCommentsBefore(node as never)
  return comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))
}

function bodyIsEmptyOrPlaceholder(fnNode: Node): { dead: true; kind: string } | { dead: false } {
  if (fnNode.type !== 'ArrowFunctionExpression' && fnNode.type !== 'FunctionExpression') {
    return { dead: false }
  }

  const body = fnNode.body

  // 1. Concise arrow body returning a literal null/undefined.
  if (fnNode.type === 'ArrowFunctionExpression' && body.type !== 'BlockStatement') {
    if (body.type === 'Literal' && (body.value === null || body.value === undefined)) {
      return { dead: true, kind: 'arrow returns null' }
    }
    if (body.type === 'Identifier' && body.name === 'undefined') {
      return { dead: true, kind: 'arrow returns undefined' }
    }
    return { dead: false }
  }

  if (body.type !== 'BlockStatement') return { dead: false }

  // 2. Empty block.
  if (body.body.length === 0) return { dead: true, kind: 'empty block' }

  // 3. Single statement: throw new Error('not implemented')
  if (body.body.length === 1) {
    const stmt = body.body[0]
    if (
      stmt &&
      stmt.type === 'ThrowStatement' &&
      stmt.argument.type === 'NewExpression' &&
      stmt.argument.callee.type === 'Identifier' &&
      stmt.argument.callee.name === 'Error' &&
      stmt.argument.arguments[0]?.type === 'Literal' &&
      typeof stmt.argument.arguments[0].value === 'string' &&
      /not\s*implemented|todo|stub/i.test(stmt.argument.arguments[0].value)
    ) {
      return { dead: true, kind: 'throws not-implemented' }
    }
  }

  // 4. Body consists ONLY of console.log/warn/info/debug calls.
  const onlyConsole = body.body.every(
    (stmt) =>
      stmt.type === 'ExpressionStatement' &&
      stmt.expression.type === 'CallExpression' &&
      stmt.expression.callee.type === 'MemberExpression' &&
      stmt.expression.callee.object.type === 'Identifier' &&
      stmt.expression.callee.object.name === 'console',
  )
  if (onlyConsole) return { dead: true, kind: 'console-only placeholder' }

  return { dead: false }
}

function unwrapHook(node: Node): Node {
  // useCallback(fn, deps) / useMemo(() => fn, deps) — peel off
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    if (node.callee.name === 'useCallback' && node.arguments[0]) {
      return unwrapHook(node.arguments[0] as Node)
    }
    if (node.callee.name === 'useMemo' && node.arguments[0]) {
      const inner = node.arguments[0] as Node
      if (
        inner.type === 'ArrowFunctionExpression' &&
        inner.body.type !== 'BlockStatement'
      ) {
        return unwrapHook(inner.body)
      }
    }
  }
  return node
}

export default {
  meta,
  create(context: Rule.RuleContext): Rule.RuleListener {
    const opts = context.options[0] ?? {}
    const handlerRegex = opts.handlerNamePattern
      ? new RegExp(opts.handlerNamePattern as string)
      : DEFAULT_HANDLER_REGEX
    const ignorePatterns = (opts.ignorePatterns as string[] | undefined) ?? [
      '*.stories.*',
      '*.test.*',
      '*.spec.*',
    ]

    const filename = context.filename ?? ''
    const fileLeaf = filename.split(/[\\/]/).pop() ?? ''
    if (
      ignorePatterns.some((p) => {
        const re = new RegExp(`^${p.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`)
        return re.test(fileLeaf)
      })
    ) {
      return {}
    }

    function checkHandlerValue(
      handlerName: string,
      valueNode: Node,
      reportNode: Node,
    ): void {
      const fn = unwrapHook(valueNode)
      const verdict = bodyIsEmptyOrPlaceholder(fn)
      if (!verdict.dead) return
      if (isAllowlisted(context, reportNode)) return
      context.report({
        node: reportNode as never,
        messageId: 'empty',
        data: { handlerName, kind: verdict.kind },
      })
    }

    const listener: Rule.RuleListener = {
      JSXAttribute(node: Rule.Node) {
        const attr = node as unknown as JSXAttribute
        if (!attr.name || attr.name.type !== 'JSXIdentifier') return
        if (!handlerRegex.test(attr.name.name)) return
        if (!attr.value || attr.value.type !== 'JSXExpressionContainer') return
        const expr = attr.value.expression
        if (
          expr.type === 'ArrowFunctionExpression' ||
          expr.type === 'FunctionExpression' ||
          expr.type === 'CallExpression'
        ) {
          checkHandlerValue(attr.name.name, expr, attr as unknown as Node)
        }
      },
      Property(node) {
        const prop = node as unknown as {
          key: { type: string; name?: string }
          value: Node
        }
        if (prop.key.type !== 'Identifier' || !prop.key.name) return
        if (!handlerRegex.test(prop.key.name)) return
        if (
          prop.value.type === 'ArrowFunctionExpression' ||
          prop.value.type === 'FunctionExpression' ||
          prop.value.type === 'CallExpression'
        ) {
          checkHandlerValue(prop.key.name, prop.value, prop as unknown as Node)
        }
      },
    }
    return listener
  },
} satisfies Rule.RuleModule
