/**
 * Rule: `mushi-mushi/no-raw-css-var-text`
 *
 * Flags Tailwind arbitrary values like `text-[var(--color-error-foreground)]`
 * when semantic utilities (`text-danger-foreground`) exist in @theme.
 */

import type { Rule } from 'eslint'
import type { Node } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | null }

const RAW_VAR_TEXT = /text-\[var\(--color-/i

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow text-[var(--color-*)] — use semantic text-*-foreground utilities from @theme.',
    },
    messages: {
      rawCssVarText:
        'Use semantic foreground utilities (e.g. text-danger-foreground) instead of text-[var(--color-*)].',
    },
    schema: [],
  },

  create(context) {
    const sc = context.sourceCode

    function checkString(value: string, node: Node) {
      if (!RAW_VAR_TEXT.test(value)) return
      const comments = sc.getCommentsBefore(node as never)
      if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return
      context.report({ node, messageId: 'rawCssVarText' })
    }

    return {
      Literal(node: Node) {
        const lit = node as { type: 'Literal'; value?: unknown }
        if (typeof lit.value === 'string') checkString(lit.value, node)
      },
      JSXAttribute(node: Node) {
        const attr = node as unknown as JSXAttr
        if (attr.name?.name !== 'className') return
        const val = attr.value
        if (!val || val.type !== 'Literal') return
        const lit = val as { value?: unknown }
        if (typeof lit.value === 'string') checkString(lit.value, node)
      },
    }
  },
}

export default rule
