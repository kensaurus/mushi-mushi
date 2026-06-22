/**
 * Rule: `mushi-mushi/no-hand-rolled-tablist`
 *
 * Flags raw HTML elements with `role="tablist"` in admin page files.
 * Page-level section navigation should use `<SegmentedControl>` (radiogroup)
 * for consistent focus rings, scrollable overflow, and brand-pill styling.
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line.
 */

import type { Rule } from 'eslint'
import type { Node, Literal } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }
interface JSXOpenEl {
  type: 'JSXOpeningElement'
  name: { type: string; name: string }
  attributes: Array<Node | JSXAttr>
}

function attrValueIs(node: Node | JSXExprContainer | null, expected: string): boolean {
  if (!node) return false
  if ((node as Node).type === 'Literal') {
    return (node as Literal).value === expected
  }
  if ((node as JSXExprContainer).type === 'JSXExpressionContainer') {
    const expr = (node as JSXExprContainer).expression as Node
    if (expr.type === 'Literal') return (expr as Literal).value === expected
  }
  return false
}

function basename(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? filename
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow hand-rolled role="tablist" navigation in page files — use SegmentedControl instead.',
    },
    messages: {
      handRolledTablist:
        'Hand-rolled tablist detected. Use <SegmentedControl scrollable> for page section tabs (Design System v2).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          pageFilesOnly: { type: 'boolean' },
          pagePattern: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] ?? {}) as {
      pageFilesOnly?: boolean
      pagePattern?: string
    }
    const pageFilesOnly = options.pageFilesOnly ?? true
    const pagePattern = new RegExp(options.pagePattern ?? 'Page\\.tsx$')

    // `context.filename` is the modern API (ESLint 8.40+); fall back to the
    // legacy `getFilename()` at runtime for older ESLint, which newer type defs
    // no longer declare — hence the cast.
    const filename =
      context.filename ??
      (context as unknown as { getFilename(): string }).getFilename()
    if (pageFilesOnly && !pagePattern.test(basename(filename))) {
      return {}
    }

    return {
      JSXOpeningElement(node: Node) {
        const el = node as unknown as JSXOpenEl
        if (el.name.type !== 'JSXIdentifier') return
        if (/^[A-Z]/.test(el.name.name)) return

        let hasTablistRole = false
        for (const attr of el.attributes) {
          const a = attr as unknown as JSXAttr
          if (a.type !== 'JSXAttribute') continue
          if (a.name?.name === 'role' && attrValueIs(a.value, 'tablist')) {
            hasTablistRole = true
          }
        }
        if (!hasTablistRole) return

        const sc = context.sourceCode
        const comments = sc.getCommentsBefore(node as never)
        if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return

        context.report({ node, messageId: 'handRolledTablist' })
      },
    }
  },
}

export default rule
