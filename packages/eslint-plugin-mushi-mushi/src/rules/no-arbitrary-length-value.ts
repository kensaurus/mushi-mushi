/**
 * Rule: `mushi-mushi/no-arbitrary-length-value`
 *
 * Warns on arbitrary Tailwind length/color utilities that are not CSS-variable
 * references — e.g. `w-[240px]`, `text-[13px]`, `bg-[#fff]` — in admin source.
 * Token-backed values like `w-[var(--chrome-row-height)]` are allowed.
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line.
 *
 * Start at `warn`; ratchet to `error` once the Start-here cluster is clean.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }

/** Match Tailwind arbitrary values that are NOT var(--…) references. */
const ARBITRARY_RE =
  /(?:^|[\s])(?:(?:sm|md|lg|xl|2xl|max-[a-z0-9]+|hover|focus|active|focus-visible|dark|motion-safe|motion-reduce):)*(?:w|h|min-w|min-h|max-w|max-h|text|bg|gap|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|top|left|right|bottom|rounded|grid-cols|basis|inset|translate-x|translate-y|leading|tracking)-\[(?!var\(--)[^\]]+\]/g

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

function findHits(classes: string): string[] {
  const hits: string[] = []
  const re = new RegExp(ARBITRARY_RE.source, 'g')
  // Pad so leading tokens still match `(?:^|[\s])`
  const padded = ` ${classes} `
  let m: RegExpExecArray | null
  while ((m = re.exec(padded)) !== null) {
    hits.push(m[0].trim())
  }
  return hits
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer design tokens over arbitrary Tailwind length/color values (except var(--…)).',
    },
    messages: {
      arbitraryValue:
        'Avoid arbitrary Tailwind value "{{cls}}" — use a design token or `-[var(--token)]`. Add `// mushi-mushi-allowlist: <reason>` if intentional.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? ''
    if (!filename.replace(/\\/g, '/').includes('apps/admin/src')) return {}

    function isAllowlisted(node: Node): boolean {
      const sc = context.sourceCode
      const comments = [
        ...sc.getCommentsBefore(node as never),
        ...sc.getCommentsInside((node as { parent?: Node }).parent as never ?? node as never),
      ]
      // Also walk up one level (JSXAttribute / JSXOpeningElement) — allowlist
      // comments usually sit above the opening tag, not the string literal.
      let cur: Node | undefined = node
      for (let i = 0; i < 3 && cur; i++) {
        const before = sc.getCommentsBefore(cur as never)
        if (before.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return true
        cur = (cur as { parent?: Node }).parent
      }
      return comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))
    }

    function check(node: Node) {
      if (isAllowlisted(node)) return

      for (const str of extractStrings(node)) {
        for (const cls of findHits(str)) {
          context.report({ node, messageId: 'arbitraryValue', data: { cls } })
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
