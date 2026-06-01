/**
 * Rule: `mushi-mushi/no-raw-palette-color`
 *
 * Bans raw Tailwind CSS palette utility classes (e.g. `text-gray-500`,
 * `bg-yellow-400`, `border-red-300`) in JSX `className` props inside
 * `apps/admin/src`, `packages/marketing-ui/src`, and `apps/docs/components`.
 *
 * - Admin surface:  use `@theme` tokens (text-fg-muted, bg-surface-raised, etc.)
 * - Marketing/docs: use `--mushi-*` CSS variable classes (text-[var(--mushi-ink)],
 *   bg-[var(--mushi-jade)], etc.) — NOT raw Tailwind palette colors.
 *
 * Why:
 *  - Raw palette classes bypass the light/dark-mode token swap.
 *  - They create a parallel colour system that drifts from brand decisions.
 *  - They make global hue changes (de-ambering, re-branding) impossible to
 *    do via token edits alone.
 *
 * What is flagged:
 *   `bg-{color}-{shade}` / `text-{color}-{shade}` / `border-{color}-{shade}`
 *   where color ∈ { slate, gray, zinc, neutral, stone, red, orange, amber,
 *   yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet,
 *   purple, fuchsia, pink, rose } and shade ∈ { 50 … 950 }.
 *
 * What is NOT flagged:
 *   - Design token classes: `text-fg`, `bg-surface-raised`, `text-danger`, etc.
 *   - Mushi CSS var classes: `text-[var(--mushi-*)]`, `bg-[var(--mushi-*)]`
 *   - Files outside the guarded dirs.
 *
 * Allowlist per-site:
 *   Add `// mushi-mushi-allowlist: <reason>` on the preceding line to suppress.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

// Local JSX type definitions (not exported by 'estree')
interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }

const PALETTE_COLORS = new Set([
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'pink', 'rose',
])

const SHADE_RE = /^(50|[1-9]00|950)$/

const PREFIXES = ['text-', 'bg-', 'border-', 'ring-', 'fill-', 'stroke-', 'accent-', 'caret-', 'from-', 'to-', 'via-', 'shadow-', 'outline-', 'decoration-']

function findViolations(classes: string): string[] {
  const violations: string[] = []
  for (const cls of classes.split(/\s+/)) {
    const stripped = cls.replace(/^(?:hover:|focus:|active:|focus-visible:|dark:|sm:|md:|lg:|xl:|2xl:|motion-safe:|group-hover:)+/, '')
    for (const prefix of PREFIXES) {
      if (!stripped.startsWith(prefix)) continue
      const rest = stripped.slice(prefix.length)
      const dashIdx = rest.lastIndexOf('-')
      if (dashIdx === -1) break
      const color = rest.slice(0, dashIdx)
      const shade = rest.slice(dashIdx + 1)
      if (PALETTE_COLORS.has(color) && SHADE_RE.test(shade)) {
        violations.push(cls)
      }
      break
    }
  }
  return violations
}

function extractStrings(node: Node): string[] {
  if (node.type === 'Literal' && typeof (node as Literal).value === 'string') {
    return [(node as Literal).value as string]
  }
  if (node.type === 'TemplateLiteral') {
    return (node as TemplateLiteral).quasis.map(q => q.value.raw)
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
    return (node as unknown as { arguments: Node[] }).arguments.flatMap(a => extractStrings(a))
  }
  return []
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow raw Tailwind palette colour classes in admin src — use design tokens instead.',
    },
    messages: {
      rawPaletteColor:
        'Raw palette class "{{cls}}" in className. Use a design token (text-fg-muted, bg-surface-raised, text-danger, etc.) instead.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? ''
    const isGuarded =
      filename.includes('apps/admin/src') ||
      filename.includes('packages/marketing-ui/src') ||
      filename.includes('apps/docs/components')
    if (!isGuarded) return {}

    function check(node: Node) {
      const sc = context.sourceCode
      const comments = sc.getCommentsBefore(node as never)
      if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return

      for (const str of extractStrings(node)) {
        for (const cls of findViolations(str)) {
          context.report({ node, messageId: 'rawPaletteColor', data: { cls } })
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
