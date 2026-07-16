/**
 * Rule: `mushi-mushi/no-legacy-page-header-in-pages`
 *
 * Operator pages under `apps/admin/src/pages/*Page.tsx` must use
 * `<PageHeaderBar>` — not the legacy `<PageHeader>` from components/ui.
 *
 * Nested panels may still use PageHeader; this rule only targets page files.
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` on the preceding line or
 * in the first 8 lines of the file.
 */

import type { Rule } from 'eslint'
import type { Node } from 'estree'

function basename(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? filename
}

function isAllowlisted(context: Rule.RuleContext, node: Node): boolean {
  const sc = context.sourceCode
  const comments = sc.getCommentsBefore(node as never)
  if (comments.some((c) => /mushi-mushi-allowlist:/i.test(c.value))) return true
  const text = sc.getText()
  return /mushi-mushi-allowlist:/i.test(text.split('\n').slice(0, 8).join('\n'))
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow legacy PageHeader in admin page files — use PageHeaderBar (canonical scaffold).',
    },
    messages: {
      legacyPageHeader:
        'Use <PageHeaderBar> instead of legacy <PageHeader> on operator pages (see page-scaffold.ts).',
      legacyPageHeaderImport:
        'Do not import PageHeader in page files — import PageHeaderBar from components/PageHeaderBar.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          pagePattern: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] ?? {}) as { pagePattern?: string }
    const pagePattern = new RegExp(options.pagePattern ?? 'Page\\.tsx$')
    const filename =
      context.filename ??
      (context as unknown as { getFilename(): string }).getFilename()
    const base = basename(filename)
    if (!pagePattern.test(base)) return {}

    return {
      ImportDeclaration(node: Node) {
        if (isAllowlisted(context, node)) return
        const decl = node as unknown as {
          specifiers: Array<{ type: string; imported?: { name: string } }>
        }
        for (const spec of decl.specifiers) {
          if (spec.type === 'ImportSpecifier' && spec.imported?.name === 'PageHeader') {
            context.report({ node, messageId: 'legacyPageHeaderImport' })
          }
        }
      },
      JSXOpeningElement(node: Node) {
        if (isAllowlisted(context, node)) return
        const el = node as unknown as { name?: { type: string; name?: string } }
        if (el.name?.type === 'JSXIdentifier' && el.name.name === 'PageHeader') {
          context.report({ node, messageId: 'legacyPageHeader' })
        }
      },
    }
  },
}

export default rule
