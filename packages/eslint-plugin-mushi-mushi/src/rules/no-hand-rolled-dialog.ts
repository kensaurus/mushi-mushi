/**
 * Rule: `mushi-mushi/no-hand-rolled-dialog`
 *
 * Bans hand-rolled modal/drawer overlays that use `fixed inset-0` together
 * with `role="dialog"` or `aria-modal` on a raw `<div>` (or any
 * HTML element — not a React component).
 *
 * Why:
 *  - The shared Drawer/Modal provides: focus-trap, Esc-close, scroll-lock,
 *    consistent z-index stacking, and return-focus on close.
 *  - Hand-rolled overlays re-implement these guards incompletely.
 *
 * Allowlist:
 *   `// mushi-mushi-allowlist: <reason>` on the preceding line.
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
  loc: { start: { line: number } }
}

function classesContainAll(node: Node | JSXExprContainer, ...tokens: string[]): boolean {
  const check = (s: string) => tokens.every(t => s.split(/\s+/).includes(t))

  if ((node as Node).type === 'Literal') {
    const v = (node as Literal).value
    return typeof v === 'string' && check(v)
  }
  if ((node as JSXExprContainer).type === 'JSXExpressionContainer') {
    return classesContainAll((node as JSXExprContainer).expression as Node | JSXExprContainer, ...tokens)
  }
  if ((node as Node).type === 'TemplateLiteral') {
    const combined = (node as TemplateLiteral).quasis.map(q => q.value.raw).join(' ')
    return tokens.every(t => combined.includes(t))
  }
  if ((node as Node).type === 'ConditionalExpression') {
    const n = node as unknown as { consequent: Node; alternate: Node }
    return classesContainAll(n.consequent as Node | JSXExprContainer, ...tokens) ||
           classesContainAll(n.alternate as Node | JSXExprContainer, ...tokens)
  }
  if ((node as Node).type === 'CallExpression') {
    return (node as unknown as { arguments: (Node | JSXExprContainer)[] }).arguments
      .some(a => classesContainAll(a, ...tokens))
  }
  return false
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hand-rolled fixed-inset dialogs — use the shared <Modal> or <Drawer> instead.',
    },
    messages: {
      handRolledDialog:
        'Hand-rolled fixed-inset overlay detected. Use <Modal> or <Drawer> for consistent focus-trap, scroll-lock, and Esc-close behaviour.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXOpeningElement(node: Node) {
        const el = node as unknown as JSXOpenEl
        // Only flag raw HTML elements (lowercase), not React components
        if (el.name.type !== 'JSXIdentifier') return
        if (/^[A-Z]/.test(el.name.name)) return

        let hasFixedInset = false
        let hasDialogRole = false

        for (const attr of el.attributes) {
          const a = attr as unknown as JSXAttr
          if (a.type !== 'JSXAttribute') continue
          const attrName = a.name?.name ?? ''

          if (attrName === 'className' && a.value) {
            hasFixedInset = classesContainAll(a.value as Node | JSXExprContainer, 'fixed', 'inset-0')
          }
          if (attrName === 'role' && a.value) {
            const v = a.value as unknown as { value?: unknown }
            if (v.value === 'dialog') hasDialogRole = true
          }
          if (attrName === 'aria-modal') hasDialogRole = true
        }

        if (!hasFixedInset || !hasDialogRole) return

        const sc = context.sourceCode
        const comments = sc.getCommentsBefore(node as never)
        if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return

        context.report({ node, messageId: 'handRolledDialog' })
      },
    }
  },
}

export default rule
