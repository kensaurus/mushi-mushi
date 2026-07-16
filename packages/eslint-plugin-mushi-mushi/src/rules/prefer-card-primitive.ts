/**
 * Rule: `mushi-mushi/prefer-card-primitive`
 *
 * Warns when JSX className strings hand-roll card chrome
 * (`rounded` + `border` + `bg-surface-raised|overlay`) outside the
 * canonical Card / Panel primitives in components/ui.
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line,
 * or paths matching allowlist globs.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }

const HAND_ROLLED =
  /(?:^|[\s])(?:rounded(?:-\S+)?)\b[\s\S]{0,80}\bborder(?:-\S+)?\b[\s\S]{0,80}\bbg-surface-(?:raised|overlay)\b|(?:^|[\s])bg-surface-(?:raised|overlay)\b[\s\S]{0,100}\bborder(?:-\S+)?\b[\s\S]{0,60}\brounded(?:-\S+)?\b/

const DEFAULT_ALLOWLIST = [
  '/components/ui/',
  'layout.tsx',
  'forms.tsx',
  'Modal.tsx',
  'Drawer.tsx',
  'PageHero.tsx',
  '/tester/',
  'PublicHomePage.tsx',
  'LoginPage.tsx',
]

function pathMatches(filename: string, allowlist: string[]): boolean {
  const norm = filename.replace(/\\/g, '/')
  return allowlist.some((entry) => norm.includes(entry))
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

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer <Card> / <Panel> over hand-rolled rounded+border+bg-surface-* chrome.',
    },
    messages: {
      preferCard:
        'Hand-rolled card chrome — prefer <Card> or <Panel> from components/ui (or add mushi-mushi-allowlist).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlist: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] ?? {}) as { allowlist?: string[] }
    const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST
    const filename = context.filename ?? ''
    if (!filename.replace(/\\/g, '/').includes('apps/admin/src')) return {}
    if (pathMatches(filename, allowlist)) return {}

    function check(node: Node) {
      const sc = context.sourceCode
      const comments = sc.getCommentsBefore(node as never)
      if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return

      for (const str of extractStrings(node)) {
        if (HAND_ROLLED.test(str)) {
          context.report({ node, messageId: 'preferCard' })
          return
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
