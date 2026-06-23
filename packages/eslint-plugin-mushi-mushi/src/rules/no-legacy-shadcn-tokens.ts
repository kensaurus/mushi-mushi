/**
 * Rule: `mushi-mushi/no-legacy-shadcn-tokens`
 *
 * Warns on deprecated shadcn alias classes in `apps/admin/src` that have
 * canonical Design System v2 replacements documented in apps/admin/README.md.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }

const LEGACY_TOKENS: Record<string, string> = {
  'text-muted': 'text-fg-muted',
  'text-muted-foreground': 'text-fg-muted',
  'text-foreground': 'text-fg',
  'border-border': 'border-edge-subtle',
  'hover:text-foreground': 'hover:text-fg',
  'ring-accent': 'ring-brand',
  'focus-visible:ring-accent': 'focus-visible:ring-brand',
}

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

function findViolations(classes: string): Array<{ cls: string; replacement: string }> {
  const violations: Array<{ cls: string; replacement: string }> = []
  for (const cls of classes.split(/\s+/)) {
    const stripped = cls.replace(/^(?:hover:|focus:|active:|focus-visible:|dark:|sm:|md:|lg:|xl:|2xl:)+/, '')
    const replacement = LEGACY_TOKENS[stripped] ?? LEGACY_TOKENS[cls]
    if (replacement) violations.push({ cls, replacement })
  }
  return violations
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow legacy shadcn alias token classes in admin — use Design System v2 semantic tokens.',
    },
    messages: {
      legacyToken:
        'Legacy token "{{cls}}" — use "{{replacement}}" instead (Design System v2).',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? ''
    if (!filename.includes('apps/admin/src')) return {}

    function check(node: Node) {
      const sc = context.sourceCode
      const comments = sc.getCommentsBefore(node as never)
      if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return

      for (const str of extractStrings(node)) {
        for (const { cls, replacement } of findViolations(str)) {
          context.report({ node, messageId: 'legacyToken', data: { cls, replacement } })
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
