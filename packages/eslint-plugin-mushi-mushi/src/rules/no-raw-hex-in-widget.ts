/**
 * Rule: `mushi-mushi/no-raw-hex-in-widget`
 *
 * Errors on raw `#hex` literals in SDK widget stylesheet sources. Colours must
 * flow through `@mushi-mushi/core` → `build-widget-theme.ts` → `styles.ts` template.
 *
 * Allowed:
 * - Comments (line or block)
 * - Files outside the guarded paths
 *
 * Allowlist:
 * - `// mushi-mushi-allowlist: <reason>` on the preceding line
 */

import type { Rule } from 'eslint'

const GUARDED_SUFFIXES = [
  'packages/web/src/styles.ts',
  'packages/web/src/build-widget-theme.ts',
] as const

/** Web widget CSS template + RN widget components under packages/react-native/src. */
function isGuardedWidgetStylePath(filename: string): boolean {
  const normalized = filename.replace(/\\/g, '/')
  if (GUARDED_SUFFIXES.some((g) => normalized.endsWith(g))) return true
  if (normalized.includes('packages/react-native/src/') && /\.tsx$/.test(normalized)) {
    return true
  }
  return false
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g

function stripComments(line: string): string {
  const blockStart = line.indexOf('/*')
  const lineComment = line.indexOf('//')
  if (lineComment >= 0 && (blockStart < 0 || lineComment < blockStart)) {
    return line.slice(0, lineComment)
  }
  return line.replace(/\/\*[\s\S]*?\*\//g, '')
}

function isAllowlisted(source: string, lineIndex: number): boolean {
  if (lineIndex <= 0) return false
  const prev = source.split('\n')[lineIndex - 1] ?? ''
  return prev.includes('mushi-mushi-allowlist:')
}

function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/#[0-9a-fA-F]{3,8}\b/g, ''),
  )
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw hex literals in SDK widget styles — use build-widget-theme.ts + @mushi-mushi/core',
    },
    schema: [],
    messages: {
      rawHex:
        'Raw hex "{{token}}" in widget styles. Resolve colours via mushiPalette() / MUSHI_* in packages/core/src/design-tokens.ts — web via build-widget-theme.ts, RN via @mushi-mushi/core imports.',
    },
  },
  create(context) {
    const filename = context.filename.replace(/\\/g, '/')
    const guarded = isGuardedWidgetStylePath(filename)
    if (!guarded) return {}

    const source = stripBlockComments(context.sourceCode.getText())

    return {
      Program() {
        const lines = source.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (isAllowlisted(source, i)) continue
          const stripped = stripComments(lines[i]!)
          for (const match of stripped.matchAll(HEX_RE)) {
            context.report({
              loc: { line: i + 1, column: (match.index ?? 0) + 1 },
              messageId: 'rawHex',
              data: { token: match[0] },
            })
          }
        }
      },
    }
  },
}

export default rule
