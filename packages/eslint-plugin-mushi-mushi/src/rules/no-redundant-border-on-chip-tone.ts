/**
 * Rule: `mushi-mushi/no-redundant-border-on-chip-tone`
 *
 * CHIP_TONE.*Subtle / CHIP_TONE.* recipes already include a single
 * `border border-<tone>/<opacity>`. Appending another resting
 * `border-<tone>/<opacity>` (including responsive variants such as
 * `md:border-danger/40`) produces duplicate/contradictory Tailwind classes.
 *
 * `hover:`, `focus:`, `focus-visible:`, `focus-within:` and `active:`
 * border utilities are the control's state change on that same border,
 * not a second resting border, so they are not flagged.
 *
 * Prefer the bare CHIP_TONE constant. If you need a stronger resting
 * border, use a non-Subtle tone or a dedicated recipe (SELECTED_TONE).
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

const CHIP_TONE_IDENT = /CHIP_TONE\.\w+/
const TONE_BORDER = /^!?border-(?:ok|warn|danger|info|accent|brand)\/\d+$/
const INTERACTION_VARIANT = /^(?:hover|focus|focus-visible|focus-within|active)$/

/**
 * A resting tone border stacked on CHIP_TONE. Interaction-only prefixes
 * recolour the recipe's own border while the control is hovered or focused.
 */
function hasRestingToneBorder(text: string): boolean {
  for (const token of text.split(/\s+/)) {
    if (!token) continue
    const parts = token.split(':')
    const utility = parts.pop() ?? ''
    if (!TONE_BORDER.test(utility)) continue
    if (parts.length > 0 && parts.every((prefix) => INTERACTION_VARIANT.test(prefix))) continue
    return true
  }
  return false
}

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
        'Disallow appending a resting border onto CHIP_TONE recipes that already include a border.',
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
      // Only flag when CHIP_TONE is concatenated/templated with a resting
      // tone border in a literal sibling (the recipe's own border is not a
      // string in this node).
      const hasChip = CHIP_TONE_IDENT.test(context.sourceCode.getText(node))
      if (!hasChip) return
      if (extractStrings(node).some((part) => hasRestingToneBorder(part))) {
        context.report({ node, messageId: 'redundantBorder' })
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
