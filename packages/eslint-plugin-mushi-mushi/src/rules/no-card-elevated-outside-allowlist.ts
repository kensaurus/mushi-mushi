/**
 * Rule: `mushi-mushi/no-card-elevated-outside-allowlist`
 *
 * Warns when operational pages use gradient `.card-elevated` or `<Card elevated />`
 * instead of the diet `variant="flat"` / `.panel` pattern. Editorial / marketing
 * surfaces are allowlisted.
 */

import type { Rule } from 'eslint'
import type { Node, Literal, TemplateLiteral } from 'estree'

// Local JSX type definitions (not exported by 'estree')
interface JSXAttrName { type: 'JSXIdentifier'; name: string }
interface JSXExprContainer { type: 'JSXExpressionContainer'; expression: Node }
interface JSXAttr { type: 'JSXAttribute'; name: JSXAttrName; value: Node | JSXExprContainer | null }

const DEFAULT_ALLOWLIST = [
  'PageHero.tsx',
  'QuickstartMegaCta.tsx',
  'OnboardingModeIntroCard.tsx',
  'BetaBanner.tsx',
  '/illustrations/',
  '/onboarding/',
  '/report-detail/',
  '/tester/',
  'Tester',
  '/PublicHomePage.tsx',
  '/SetupGatePage.tsx',
  '/LoginPage.tsx',
  '/CliAuthPage.tsx',
]

function pathMatchesAllowlist(filename: string, allowlist: string[]): boolean {
  const normalized = filename.replace(/\\/g, '/')
  return allowlist.some((entry) => {
    if (entry.startsWith('/')) return normalized.includes(entry)
    return normalized.endsWith(entry) || normalized.includes(`/${entry}`)
  })
}

function extractStrings(node: Node | JSXExprContainer | null | undefined): string[] {
  if (!node) return []
  if (node.type === 'Literal' && typeof (node as Literal).value === 'string') {
    return [(node as Literal).value as string]
  }
  if (node.type === 'TemplateLiteral') {
    return (node as TemplateLiteral).quasis.map((q) => q.value.raw)
  }
  if (node.type === 'JSXExpressionContainer') {
    return extractStrings(node.expression)
  }
  return []
}

function isTruthyJsxAttr(value: Node | JSXExprContainer | null): boolean {
  if (value === null) return true
  if (value.type === 'JSXExpressionContainer') {
    const expr = value.expression
    if (expr.type === 'Literal') return Boolean((expr as Literal).value)
    if (expr.type === 'Identifier' && (expr as unknown as { name: string }).name === 'true') return true
  }
  return false
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Discourage elevated Card / card-elevated on operational admin surfaces — use Panel or Card variant="flat".',
    },
    messages: {
      elevatedCard:
        'Elevated card on operational surface — use `<Card variant="flat">`, `<Panel>`, or `<PanelRow>` (diet chrome).',
      elevatedClass:
        'Class "card-elevated" on operational surface — use `.panel` / `.card-flat` instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlist: { type: 'array', items: { type: 'string' } },
          pagePattern: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const filename = context.filename ?? ''
    if (!filename.includes('apps/admin/src')) return {}

    const options = (context.options[0] ?? {}) as { allowlist?: string[]; pagePattern?: string }
    const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST
    const pagePattern = options.pagePattern ?? 'Page\\.tsx$'

    if (pathMatchesAllowlist(filename, allowlist)) return {}

    const basename = filename.replace(/\\/g, '/').split('/').pop() ?? ''
    const isPageFile = new RegExp(pagePattern).test(basename)
    if (!isPageFile && !filename.includes('/pages/')) return {}

    function reportElevated(node: Node) {
      context.report({ node, messageId: 'elevatedCard' })
    }

    return {
      JSXAttribute(node: Node) {
        const attr = node as unknown as JSXAttr
        const comments = context.sourceCode.getCommentsBefore(node)
        if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return

        if (attr.name.name === 'elevated' && isTruthyJsxAttr(attr.value)) {
          reportElevated(node)
          return
        }

        if (attr.name.name === 'variant') {
          const strings = extractStrings(attr.value)
          if (strings.some((s) => s.includes('elevated'))) reportElevated(node)
          return
        }

        if (attr.name.name === 'className') {
          const strings = extractStrings(attr.value)
          if (strings.some((s) => /\bcard-elevated\b/.test(s))) {
            context.report({ node, messageId: 'elevatedClass' })
          }
        }
      },
    }
  },
}

export default rule
