/**
 * Rule: `mushi-mushi/no-missing-page-posture`
 *
 * Operator worklist pages under `apps/admin/src/pages/*Page.tsx` must wrap
 * status/snapshot/guide chrome in `<PagePosture>` (Design System v2 budget).
 *
 * Skips auth, public, detail, and bridge routes via `skipBasenames`.
 *
 * Allowlist: `// mushi-mushi-allowlist: <reason>` at top of file.
 */

import type { Rule } from 'eslint'

const DEFAULT_SKIP = [
  'AcceptInvitePage.tsx',
  'CliAuthPage.tsx',
  'ContentQualityDetailPage.tsx',
  'DocsBridgePage.tsx',
  'IntegrationsRouteGate.tsx',
  'LoginPage.tsx',
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

function basename(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? filename
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require PagePosture on operator worklist pages (admin console chrome budget).',
    },
    messages: {
      missingPagePosture:
        'Operator page missing <PagePosture>. Wrap status banner, snapshot strip, and guide/readout slots before tabs (see docs/admin/UX-UNIFICATION-BURNDOWN.md).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          pagePattern: { type: 'string' },
          skipBasenames: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] ?? {}) as {
      pagePattern?: string
      skipBasenames?: string[]
    }
    const pagePattern = new RegExp(options.pagePattern ?? 'Page\\.tsx$')
    const skipBasenames = new Set(options.skipBasenames ?? DEFAULT_SKIP)

    // `context.filename` is the modern API (ESLint 8.40+); fall back to the
    // legacy `getFilename()` at runtime for older ESLint, which newer type defs
    // no longer declare — hence the cast.
    const filename =
      context.filename ??
      (context as unknown as { getFilename(): string }).getFilename()
    const base = basename(filename)
    if (!pagePattern.test(base) || skipBasenames.has(base)) {
      return {}
    }

    return {
      Program(node) {
        const sc = context.sourceCode
        const text = sc.getText()
        if (/mushi-mushi-allowlist:/i.test(text.split('\n').slice(0, 8).join('\n'))) {
          return
        }
        if (!/\bPagePosture\b/.test(text)) {
          context.report({ node, messageId: 'missingPagePosture' })
        }
      },
    }
  },
}

export default rule
