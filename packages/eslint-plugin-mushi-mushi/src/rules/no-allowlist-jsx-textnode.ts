/**
 * Rule: `mushi-mushi/no-allowlist-jsx-textnode`
 *
 * Catches `// mushi-mushi-allowlist: …` (and similar) written as JSX *children*.
 * In child position, `//` is not a comment — React renders it as a text node.
 * That produced the admin sidebar "allowlist comment explosion" bug.
 *
 * Safe placements (not flagged):
 *   - Between JSX attributes (attribute-line `//` comment)
 *   - Inside a JS expression group (`return (` / `&& (` etc.)
 *   - JSX block comments: `{` + `/* mushi-mushi-allowlist: … *` + `/` + `}`
 *
 * Prefer a JSX block comment immediately above the flagged element when the
 * allowlist must sit in the children list.
 */

import type { Rule } from 'eslint'
import type { Node } from 'estree'

const ALLOWLIST_RE = /mushi-mushi-allowlist:/i
/** Matches a line that is only a // allowlist "comment" (leaked as JSXText). */
const LINE_COMMENT_ALLOWLIST_RE = /^\s*\/\/\s*mushi-mushi-allowlist:/i

const meta: Rule.RuleMetaData = {
  type: 'problem',
  docs: {
    description:
      'Forbid mushi-mushi-allowlist markers written as JSX text nodes (// in child position). Use {/* … */} or an attribute-line // comment instead.',
    recommended: true,
  },
  schema: [],
  messages: {
    textnode:
      '`// mushi-mushi-allowlist` in JSX children renders as visible text. Use `{/* mushi-mushi-allowlist: <reason> */}` or put `//` on the opening-tag attribute line.',
  },
}

const rule: Rule.RuleModule = {
  meta,
  create(context): Rule.RuleListener {
    return {
      JSXText(node: Node) {
        const text = node as unknown as { value?: string }
        const value = text.value ?? ''
        if (!ALLOWLIST_RE.test(value)) return
        // Only flag when a line looks like a leaked // comment (not incidental copy).
        const lines = value.split(/\n/)
        if (!lines.some((l) => LINE_COMMENT_ALLOWLIST_RE.test(l) || /^\s*mushi-mushi-allowlist:/i.test(l))) {
          return
        }
        context.report({ node, messageId: 'textnode' })
      },
      Literal(node: Node) {
        // JSX string children can also surface as Literal under some parsers.
        const lit = node as unknown as { value?: unknown; parent?: { type?: string } }
        if (lit.parent?.type !== 'JSXElement' && lit.parent?.type !== 'JSXFragment') return
        if (typeof lit.value !== 'string') return
        if (!ALLOWLIST_RE.test(lit.value)) return
        if (!LINE_COMMENT_ALLOWLIST_RE.test(lit.value) && !/^\s*mushi-mushi-allowlist:/i.test(lit.value)) {
          return
        }
        context.report({ node, messageId: 'textnode' })
      },
    }
  },
}

export default rule
