/**
 * Custom ESLint rule: no-empty-onclick
 *
 * closes the "dead button" finding from the static audit: empty
 * `onClick={() => {}}`, `onClick={noop}`, or `onClick={()=>null}` handlers
 * silently render an unresponsive button. Users click; nothing happens; we
 * have no telemetry to find it because the handler succeeds.
 *
 * This rule reports any of those patterns on `onClick` (and the equivalent
 * `onClickCapture`, plus `onSubmit` where the same problem applies on
 * forms). Suggestion: wire the handler, log a TODO, or remove the prop.
 *
 * Exceptions allowed via the `allowedNames` option — e.g. you can pass
 * `noopBecauseHandledByParent` if you intentionally need a no-op identifier.
 */

const TARGET_PROPS = new Set(['onClick', 'onClickCapture', 'onSubmit'])
const DEFAULT_ALLOWED = new Set(['identityFn'])

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow empty onClick / onSubmit handlers in JSX — they render an unresponsive button.',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedNames: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      empty:
        'Empty `{{prop}}` handler — the button looks clickable but does nothing. Wire it, gate it, or remove the prop.',
    },
  },
  create(context) {
    const opts = context.options[0] ?? {}
    const allowed = new Set([...DEFAULT_ALLOWED, ...(opts.allowedNames ?? [])])

    function reportEmpty(node, propName) {
      context.report({ node, messageId: 'empty', data: { prop: propName } })
    }

    function isEmptyArrow(expr) {
      if (expr.type !== 'ArrowFunctionExpression') return false
      const body = expr.body
      if (body.type === 'BlockStatement' && body.body.length === 0) return true
      if (body.type === 'Literal' && (body.value === null || body.value === undefined)) return true
      return false
    }

    function isEmptyFunction(expr) {
      if (expr.type !== 'FunctionExpression') return false
      return expr.body.type === 'BlockStatement' && expr.body.body.length === 0
    }

    return {
      JSXAttribute(node) {
        if (!node.name || node.name.type !== 'JSXIdentifier') return
        const propName = node.name.name
        if (!TARGET_PROPS.has(propName)) return
        const value = node.value
        if (!value || value.type !== 'JSXExpressionContainer') return
        const expr = value.expression

        if (isEmptyArrow(expr) || isEmptyFunction(expr)) {
          reportEmpty(node, propName)
          return
        }
        if (
          expr.type === 'Identifier' &&
          (expr.name === 'noop' || expr.name === '_noop') &&
          !allowed.has(expr.name)
        ) {
          reportEmpty(node, propName)
        }
      },
    }
  },
}

export default rule
