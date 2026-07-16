/**
 * Rule: `mushi-mushi/prefer-card-primitive`
 *
 * Warns when JSX **container** elements hand-roll card chrome
 * (`rounded` + `border` + `bg-surface-raised|overlay`) outside the
 * canonical Card / Panel primitives in components/ui.
 *
 * Intentionally does NOT flag:
 *   - chips / pills (`rounded-full`, tiny `rounded-sm` badges)
 *   - form controls (`input` / `textarea` / `button` / `span` / `a`)
 *   - inputs that use surface chrome for field styling
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line,
 * or paths matching allowlist globs.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr {
  type: 'JSXAttribute'
  name: JSXAttrName
  value: Node | JSXExprContainer | null
  parent?: { type?: string; name?: { name?: string } | string }
}

const HAND_ROLLED =
  /(?:^|[\s])(?:rounded(?:-\S+)?)\b[\s\S]{0,80}\bborder(?:-\S+)?\b[\s\S]{0,80}\bbg-surface-(?:raised|overlay)\b|(?:^|[\s])bg-surface-(?:raised|overlay)\b[\s\S]{0,100}\bborder(?:-\S+)?\b[\s\S]{0,60}\brounded(?:-\S+)?\b/

/** Card-like padding — without this, treat as chip / inset / field chrome. */
const CARD_PADDING = /\b(?:p|px|py)-(?:3|4|5|6|8)\b/

const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'aside', 'li', 'main'])

const DEFAULT_ALLOWLIST = [
  '/components/ui/',
  'layout.tsx',
  'forms.tsx',
  'Modal.tsx',
  'Drawer.tsx',
  'PageHero.tsx',
  '/tester/',
  'PublicHomePage.tsx',
  'PublicIntegrationsPage.tsx',
  'LoginPage.tsx',
  'CliAuthPage.tsx',
  'McpAuthPage.tsx',
  'AcceptInvitePage.tsx',
  'ResetPasswordPage.tsx',
  'SetupGatePage.tsx',
  // Canvas / flow / graph surfaces — custom chrome, not Card tiles
  '/components/graph/',
  '/components/explore/',
  '/components/hero-flow/',
  '/components/pdca-flow/',
  '/components/skill-pipeline/',
  'FixProgressStream.tsx',
  'StageDrawerContent.tsx',
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

/** Chip / field / tooltip chrome — not a Card candidate. */
function isNonCardChrome(cls: string): boolean {
  if (/\brounded-full\b/.test(cls)) return true
  if (/\bplaceholder:/.test(cls)) return true
  if (/\bresize-/.test(cls)) return true
  // Tiny badge / meta chip
  if (/\brounded-sm\b/.test(cls) && !CARD_PADDING.test(cls)) return true
  // Absolute tooltips / popovers
  if (/\babsolute\b/.test(cls) && /\b(?:z-\d+|pointer-events-none)\b/.test(cls)) return true
  // Must have card-scale padding (p-3+) — toolbars with p-0.5 / p-1 / p-2 are not Cards
  if (!CARD_PADDING.test(cls)) return true
  return false
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer <Card> / <Panel> over hand-rolled rounded+border+bg-surface-* card chrome.',
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

    function check(node: Node, tagName: string | undefined) {
      if (tagName && !CONTAINER_TAGS.has(tagName)) return

      const sc = context.sourceCode
      // Allowlist comments usually sit above the opening tag / attribute, not
      // the string literal — walk parents like no-arbitrary-length-value.
      let cur: Node | undefined = node
      for (let i = 0; i < 4 && cur; i++) {
        const before = sc.getCommentsBefore(cur as never)
        if (before.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return
        cur = (cur as { parent?: Node }).parent
      }

      for (const str of extractStrings(node)) {
        if (!HAND_ROLLED.test(str)) continue
        if (isNonCardChrome(str)) continue
        context.report({ node, messageId: 'preferCard' })
        return
      }
    }

    return {
      JSXAttribute(node: Node) {
        const attr = node as unknown as JSXAttr
        if (attr.name?.name !== 'className' || !attr.value) return
        const parent = attr.parent
        const tagName =
          typeof parent?.name === 'string'
            ? parent.name
            : (parent?.name as { name?: string } | undefined)?.name
        const val = attr.value
        if ((val as Node).type === 'Literal') {
          check(val as Node, tagName)
        } else if ((val as JSXExprContainer).type === 'JSXExpressionContainer') {
          check((val as JSXExprContainer).expression, tagName)
        }
      },
    }
  },
}

export default rule
