/**
 * Rule: `mushi-mushi/no-raw-semantic-on-muted`
 *
 * Flags WCAG-AA-failing chip pairings: raw semantic text (`text-ok`, `text-warn`, …)
 * on matching muted tint backgrounds (`bg-ok-muted`, `bg-warn-muted`, …).
 *
 * Use `CHIP_TONE.*`, `statusChipTone()`, or dedicated `*-foreground` tokens instead.
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }

const SEMANTIC_NAMES = ['ok', 'warn', 'danger', 'info', 'accent', 'brand'] as const

const MUTED_BG_RE = new RegExp(
  String.raw`\bbg-(?:${SEMANTIC_NAMES.join('|')})-muted(?:\/[\d.]+)?\b`,
)

/** Raw semantic hue on tint — excludes *-foreground / *-fg tokens. */
const RAW_SEMANTIC_TEXT_RE = new RegExp(
  String.raw`\btext-(?:${SEMANTIC_NAMES.join('|')})(?!-(?:foreground|fg)\b)\b`,
)

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

function stripStatePrefixedClasses(classes: string): string {
  return classes
    .split(/\s+/)
    .filter((cls) => !/^(?:hover:|focus:|active:|focus-visible:|group-hover:|group-focus:)/.test(cls))
    .join(' ')
}

function hasRawSemanticOnMuted(classes: string): boolean {
  const atRest = stripStatePrefixedClasses(classes)
  if (!MUTED_BG_RE.test(atRest)) return false
  return RAW_SEMANTIC_TEXT_RE.test(atRest)
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow raw semantic text colors on muted tint backgrounds — use CHIP_TONE or *-foreground tokens.',
    },
    messages: {
      rawSemanticOnMuted:
        'Raw semantic text on muted tint fails WCAG AA — use CHIP_TONE.*, statusChipTone(), or *-foreground tokens.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? ''
    if (!filename.includes('apps/admin/src')) return {}

    function isAllowlisted(node: Node): boolean {
      const sc = context.sourceCode
      const comments = [
        ...sc.getCommentsBefore(node as never),
        ...sc.getCommentsBefore((node as unknown as { parent?: Node }).parent as never),
      ]
      return comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))
    }

    function check(node: Node, allowlistAnchor?: Node) {
      if (allowlistAnchor && isAllowlisted(allowlistAnchor)) return

      for (const str of extractStrings(node)) {
        if (str.includes('CHIP_TONE') || str.includes('chipTone') || str.includes('ChipTone')) continue
        if (hasRawSemanticOnMuted(str)) {
          context.report({ node, messageId: 'rawSemanticOnMuted' })
          return
        }
      }
    }

    return {
      JSXOpeningElement(node: Node) {
        const el = node as unknown as { attributes: Array<Node | JSXAttr> }
        for (const attr of el.attributes) {
          const a = attr as unknown as JSXAttr
          if (a.type !== 'JSXAttribute') continue
          if (a.name?.name !== 'className' || !a.value) continue
          const val = a.value
          if ((val as Node).type === 'Literal') {
            check(val as Node, node)
          } else if ((val as JSXExprContainer).type === 'JSXExpressionContainer') {
            check((val as JSXExprContainer).expression, node)
          }
        }
      },
      Property(node: Node) {
        const prop = node as unknown as { key: { type: string; name?: string }; value: Node }
        if (prop.key?.type !== 'Identifier') return
        if (prop.key.name !== 'className' && prop.key.name !== 'tone') return
        check(prop.value)
      },
    }
  },
}

export default rule
