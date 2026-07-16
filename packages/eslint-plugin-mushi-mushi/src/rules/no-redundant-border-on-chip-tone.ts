/**
 * Rule: `mushi-mushi/no-redundant-border-on-chip-tone`
 *
 * CHIP_TONE.*Subtle / CHIP_TONE.* recipes already include a single
 * `border border-<tone>/<opacity>`. Appending another `border` or
 * `border-<tone>/<opacity>` produces duplicate/contradictory Tailwind classes.
 *
 * Prefer the bare CHIP_TONE constant. If you need a stronger border,
 * use a non-Subtle tone or a dedicated recipe (SELECTED_TONE).
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

const CHIP_TONE_IDENT = /CHIP_TONE\.\w+/
const REDUNDANT_BORDER = /\bborder(?:\s+border-(?:ok|warn|danger|info|accent|brand)\/\d+|-?(?:ok|warn|danger|info|accent|brand)\/\d+)/

function extractStrings(node: Node): string[] {
  if (node.type === 'Literal' && typeof (node as Literal).value === 'string') {
    return [(node as Literal).value as string]
  }
  if (node.type === 'TemplateLiteral') {
    const tl = node as TemplateLiteral
    return tl.quasis.map((q) => q.value.raw)
  }
  if (node.type === 'BinaryExpression' && (node as { operator: string }).operator === '+') {
    const n = node as unknown as { left: Node; right: Node }
    return [...extractStrings(n.left), ...extractStrings(n.right)]
  }
  if (node.type === 'ConditionalExpression') {
    const n = node as unknown as { consequent: Node; alternate: Node }
    return [...extractStrings(n.consequent), ...extractStrings(n.alternate)]
  }
  return []
}

function nodeMentionsChipTone(node: Node): boolean {
  if (node.type === 'MemberExpression') {
    const obj = (node as unknown as { object: { type: string; name?: string } }).object
    return obj.type === 'Identifier' && obj.name === 'CHIP_TONE'
  }
  if (node.type === 'BinaryExpression') {
    const n = node as unknown as { left: Node; right: Node }
    return nodeMentionsChipTone(n.left) || nodeMentionsChipTone(n.right)
  }
  if (node.type === 'TemplateLiteral') {
    const tl = node as TemplateLiteral
    return tl.expressions.some((e) => nodeMentionsChipTone(e as Node))
  }
  if (node.type === 'ConditionalExpression') {
    const n = node as unknown as { consequent: Node; alternate: Node }
    return nodeMentionsChipTone(n.consequent) || nodeMentionsChipTone(n.alternate)
  }
  return false
}

function hasAllowlist(context: Rule.RuleContext, node: Node): boolean {
  const source = context.sourceCode ?? (context as unknown as { getSourceCode: () => { getCommentsBefore: (n: Node) => { value: string }[] } }).getSourceCode?.()
  if (!source) return false
  const comments = source.getCommentsBefore(node)
  return comments.some((c) => /mushi-mushi-allowlist:/.test(c.value))
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow appending border utilities onto CHIP_TONE recipes that already include a border.',
    },
    messages: {
      redundantBorder:
        'CHIP_TONE recipes already include a border — drop the appended border class (or use SELECTED_TONE / a non-Subtle tone).',
    },
    schema: [],
  },

  create(context) {
    function check(node: Node) {
      if (!nodeMentionsChipTone(node)) return
      if (hasAllowlist(context, node)) return
      const strings = extractStrings(node)
      const joined = strings.join(' ')
      // Only flag when CHIP_TONE is concatenated/templated with a redundant border fragment
      const hasChip = CHIP_TONE_IDENT.test(context.sourceCode.getText(node))
      if (!hasChip) return
      if (REDUNDANT_BORDER.test(joined) && /CHIP_TONE/.test(context.sourceCode.getText(node))) {
        // Require both CHIP_TONE reference AND a border fragment in the string parts
        // that is outside the recipe itself (i.e. in a literal sibling)
        const literalParts = strings.filter((s) => /\bborder\b/.test(s))
        if (literalParts.length > 0) {
          context.report({ node, messageId: 'redundantBorder' })
        }
      }
    }

    return {
      BinaryExpression(node) {
        if ((node as { operator: string }).operator === '+') check(node as unknown as Node)
      },
      TemplateLiteral(node) {
        check(node as unknown as Node)
      },
    }
  },
}

export default rule
