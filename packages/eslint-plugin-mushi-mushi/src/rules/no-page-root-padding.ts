/**
 * Rule: `mushi-mushi/no-page-root-padding`
 *
 * Operator pages under `apps/admin/src/pages/*Page.tsx` must use
 * `PAGE_CONTENT_STACK` as the page body root. The Layout shell already
 * applies horizontal/vertical padding via `PAGE_SHELL_CLASS` — pages must
 * not add `p-*` / `px-*` / `py-*` / `mx-auto` / `max-w-*` on the root.
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` in the first 8 lines,
 * or skipBasenames for auth/public/split-pane pages.
 */

import type { Rule } from 'eslint'
import type { Node } from 'estree'

const DEFAULT_SKIP = [
  'AcceptInvitePage.tsx',
  'CliAuthPage.tsx',
  'ContentQualityDetailPage.tsx',
  'ContentQualityPage.tsx',
  'DocsBridgePage.tsx',
  'IntegrationsRouteGate.tsx',
  'LoginPage.tsx',
  'McpAuthPage.tsx',
  'PublicHomePage.tsx',
  'PublicIntegrationsPage.tsx',
  'ReportDetailPage.tsx',
  'ResetPasswordPage.tsx',
  'SetupGatePage.tsx',
  'TesterSubmissionsReviewPage.tsx',
  'TesterAppsPage.tsx',
  'TesterHomePage.tsx',
  'TesterLearnPage.tsx',
  'TesterSettingsPage.tsx',
  'TesterSubmissionsPage.tsx',
  'TesterWalletPage.tsx',
] as const

const ROOT_PAD_RE = /\b(?:p|px|py|pt|pb|pl|pr)-\S+|\bmx-auto\b|\bmax-w-\S+/

function basename(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? filename
}

function extractClassStrings(node: Node): string[] {
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value]
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((q) => q.value.raw)
  }
  if (node.type === 'Identifier' && node.name === 'PAGE_CONTENT_STACK') {
    return ['PAGE_CONTENT_STACK']
  }
  if (node.type === 'ConditionalExpression') {
    return [...extractClassStrings(node.consequent), ...extractClassStrings(node.alternate)]
  }
  if (node.type === 'LogicalExpression') {
    return extractClassStrings(node.right)
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [...extractClassStrings(node.left), ...extractClassStrings(node.right)]
  }
  if (node.type === 'CallExpression') {
    return node.arguments.flatMap((a) => extractClassStrings(a as Node))
  }
  return []
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require PAGE_CONTENT_STACK page roots — forbid root padding/max-width (shell owns them).',
    },
    messages: {
      rootPadding:
        'Page root must not use "{{cls}}" — Layout already pads via PAGE_SHELL_CLASS. Use className={PAGE_CONTENT_STACK}.',
      missingStack:
        'Operator page root should use className={PAGE_CONTENT_STACK} (see page-scaffold.ts / pageLayout.ts).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          pagePattern: { type: 'string' },
          skipBasenames: { type: 'array', items: { type: 'string' } },
          requireStack: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] ?? {}) as {
      pagePattern?: string
      skipBasenames?: string[]
      requireStack?: boolean
    }
    const pagePattern = new RegExp(options.pagePattern ?? 'Page\\.tsx$')
    const skipBasenames = new Set(options.skipBasenames ?? DEFAULT_SKIP)
    const requireStack = options.requireStack !== false

    const filename =
      context.filename ??
      (context as unknown as { getFilename(): string }).getFilename()
    const base = basename(filename)
    if (!pagePattern.test(base) || skipBasenames.has(base)) return {}

    const sc = context.sourceCode
    const text = sc.getText()
    if (/mushi-mushi-allowlist:/i.test(text.split('\n').slice(0, 8).join('\n'))) {
      return {}
    }

    let reportedMissingStack = false
    let foundStack = /\bPAGE_CONTENT_STACK\b/.test(text)

    return {
      Program(node) {
        if (requireStack && !foundStack && !reportedMissingStack) {
          // Soft: only report once if PageHeaderBar is present (operator page)
          // but PAGE_CONTENT_STACK is absent — catches space-y-N roots.
          if (/\bPageHeaderBar\b/.test(text)) {
            reportedMissingStack = true
            context.report({ node, messageId: 'missingStack' })
          }
        }
      },
      JSXAttribute(node: Node) {
        const attr = node as unknown as {
          name?: { name?: string }
          value?: Node | { type: string; expression?: Node } | null
          parent?: { type: string; name?: { name?: string }; parent?: { type: string } }
        }
        if (attr.name?.name !== 'className' || !attr.value) return

        // Only flag the outermost page wrapper: a div/main/section whose parent
        // is a ReturnStatement (approximate via source — check sibling PageHeaderBar).
        const val = attr.value
        let classes: string[] = []
        if ((val as Node).type === 'Literal') {
          classes = extractClassStrings(val as Node)
        } else if (
          (val as { type: string }).type === 'JSXExpressionContainer' &&
          (val as { expression?: Node }).expression
        ) {
          classes = extractClassStrings((val as { expression: Node }).expression)
        }

        for (const cls of classes) {
          if (cls === 'PAGE_CONTENT_STACK' || /\bPAGE_CONTENT_STACK\b/.test(cls)) {
            foundStack = true
            continue
          }
          if (ROOT_PAD_RE.test(cls)) {
            // Only flag outermost page wrappers (div/main/section), never nested
            // controls (Btn className="… px-1.5" sitting inside PageHeaderBar).
            const jsxParent = attr.parent as
              | { type?: string; name?: { name?: string } | string }
              | undefined
            const tagName =
              typeof jsxParent?.name === 'string'
                ? jsxParent.name
                : (jsxParent?.name as { name?: string } | undefined)?.name
            if (tagName && !['div', 'main', 'section'].includes(tagName)) continue

            // Opening PageHeaderBar ahead = this wrapper is the page root.
            // Do NOT match </PageHeaderBar> (false positive on nested children).
            const start = (node as unknown as { range?: [number, number] }).range?.[0] ?? 0
            const window = text.slice(start, start + 500)
            if (/<PageHeaderBar\b/.test(window) || /data-testid=["']mushi-page-/.test(window)) {
              const hit = cls.match(ROOT_PAD_RE)?.[0] ?? cls
              context.report({
                node,
                messageId: 'rootPadding',
                data: { cls: hit },
              })
            }
          }
        }
      },
    }
  },
}

export default rule
