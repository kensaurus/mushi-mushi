/**
 * Rule: `mushi-mushi/no-accent-for-selection`
 *
 * Flags interactive selected-state classes that use `accent` instead of `brand`.
 * Selection / active UI chrome should use brand tokens per Design System v2.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }

const ACCENT_SELECTION_RE =
  /(?:^|\s)(?:border-accent|bg-accent\/|text-accent(?:\s|$)|ring-accent|focus-visible:ring-accent)/

function extractStrings(node: Node): string[] {
  if (node.type === 'Literal' && typeof (node as Literal).value === 'string') {
    return [(node as Literal).value as string]
  }
  if (node.type === 'TemplateLiteral') {
    return (node as TemplateLiteral).quasis.map((q) => q.value.raw)
  }
  if (node.type === 'ConditionalExpression') {
    const n = node as unknown as { consequent: Node; alternate: Node }
    return [...extractStrings(n.consequent), ...extractStrings(n.alternate)]
  }
  if (node.type === 'LogicalExpression') {
    return extractStrings((node as unknown as { right: Node }).right)
  }
  if (node.type === 'BinaryExpression' && (node as unknown as { operator: string }).operator === '+') {
    const n = node as unknown as { left: Node; right: Node }
    return [...extractStrings(n.left), ...extractStrings(n.right)]
  }
  if (node.type === 'CallExpression') {
    return (node as unknown as { arguments: Node[] }).arguments.flatMap((a) => extractStrings(a))
  }
  return []
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow accent token for interactive selection states — use brand / FilterChip tone="brand".',
    },
    messages: {
      accentSelection:
        'Accent used for selection/active UI. Use brand tokens or <FilterChip tone="brand"> instead.',
    },
    schema: [],
  },

  create(context) {
    const filename = (context.filename ?? '').replace(/\\/g, '/')
    const isGuarded =
      filename.includes('apps/admin/src/components/connect/') ||
      filename.includes('apps/admin/src/pages/')
    if (!isGuarded) return {}

    // Tester portal intentionally remaps accent — skip those routes.
    if (filename.includes('/tester')) return {}

    function check(node: Node) {
      const sc = context.sourceCode
      const comments = sc.getCommentsBefore(node as never)
      if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return

      for (const str of extractStrings(node)) {
        if (ACCENT_SELECTION_RE.test(str)) {
          context.report({ node, messageId: 'accentSelection' })
          break
        }
      }
    }

    return {
      JSXAttribute(node: Node) {
        const attr = node as unknown as JSXAttr
        if (attr.name?.name !== 'className' || !attr.value) return
        const val = attr.value
        if ((val as Node).type === 'Literal') {
          check(val as Node)
        } else if ((val as JSXExprContainer).type === 'JSXExpressionContainer') {
          check((val as JSXExprContainer).expression)
        }
      },
    }
  },
}

export default rule
