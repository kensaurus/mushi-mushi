/**
 * Rule: `mushi-mushi/no-text-3xs-on-interactive`
 *
 * Prevents `text-3xs` (≤ 11px) from being applied to interactive or labelling
 * elements: `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, `<label>`,
 * `<th>`, and `<td>`.
 *
 * Why:
 *  - WCAG 2.2 SC 1.4.4 (Resize Text): text must remain legible at 200% zoom.
 *  - Research floor for dev-console interactive text is 12px (text-2xs).
 *  - 11px on buttons or table headers is nearly unreadable.
 *
 * Allowlist:
 *  Add `// mushi-mushi-allowlist: <reason>` on the preceding line.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }
interface JSXOpenEl {
  type: 'JSXOpeningElement'
  name: { type: string; name: string }
  attributes: Array<Node | JSXAttr>
}

const INTERACTIVE_ELEMENTS = new Set([
  'button', 'a', 'input', 'select', 'textarea', 'label', 'th', 'td',
])

function hasText3xs(value: string): boolean {
  return value.split(/\s+/).some(cls => {
    const stripped = cls.replace(/^(?:hover:|focus:|active:|sm:|md:|lg:|xl:|dark:)+/, '')
    return stripped === 'text-3xs'
  })
}

function extractStringValues(node: Node): string[] {
  if (node.type === 'Literal' && typeof (node as Literal).value === 'string') {
    return [(node as Literal).value as string]
  }
  if (node.type === 'TemplateLiteral') {
    return (node as TemplateLiteral).quasis.map(q => q.value.raw)
  }
  if (node.type === 'ConditionalExpression') {
    const n = node as unknown as { consequent: Node; alternate: Node }
    return [...extractStringValues(n.consequent), ...extractStringValues(n.alternate)]
  }
  if (node.type === 'LogicalExpression') {
    return extractStringValues((node as unknown as { right: Node }).right)
  }
  if (node.type === 'CallExpression') {
    return (node as unknown as { arguments: Node[] }).arguments.flatMap(a => extractStringValues(a))
  }
  return []
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow text-3xs on interactive/label elements — 12px (text-2xs) minimum.',
    },
    messages: {
      text3xsOnInteractive:
        'text-3xs (11px) is too small for interactive/label element <{{tag}}>. Use text-2xs (12px) at minimum.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXOpeningElement(node: Node) {
        const el = node as unknown as JSXOpenEl
        if (el.name.type !== 'JSXIdentifier') return
        const tag = el.name.name.toLowerCase()
        if (!INTERACTIVE_ELEMENTS.has(tag)) return

        for (const attr of el.attributes) {
          const a = attr as unknown as JSXAttr
          if (a.type !== 'JSXAttribute') continue
          if (a.name?.name !== 'className' || !a.value) continue

          const sc = context.sourceCode
          const comments = sc.getCommentsBefore(node as never)
          if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) continue

          let found = false
          const val = a.value
          if ((val as Node).type === 'Literal') {
            found = hasText3xs((val as unknown as Literal).value as string)
          } else if ((val as JSXExprContainer).type === 'JSXExpressionContainer') {
            found = extractStringValues((val as JSXExprContainer).expression).some(hasText3xs)
          }

          if (found) {
            context.report({ node, messageId: 'text3xsOnInteractive', data: { tag } })
          }
        }
      },
    }
  },
}

export default rule
