import type { FixContext, ReviewResult } from './types.js'

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
  /secret\s*[:=]\s*['"][^'"]+['"]/i,
  /\.env/,
  /credentials/i,
  /private[_-]?key/i,
]

export function checkForSecrets(diff: string): { clean: boolean; findings: string[] } {
  const findings: string[] = []
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(diff)) {
      findings.push(`Potential secret pattern: ${pattern.source}`)
    }
  }
  return { clean: findings.length === 0, findings }
}

export function buildReviewPrompt(context: FixContext, diff: string): string {
  return `You are reviewing an AI-generated code fix. Determine if it correctly addresses the reported issue.

## Original Bug Report
- Summary: ${context.report.summary}
- Category: ${context.report.category}
- Severity: ${context.report.severity}
- Component: ${context.report.component ?? 'unknown'}
- Root Cause: ${context.report.rootCause ?? 'unknown'}

## Reproduction Steps
${context.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Code Diff
\`\`\`diff
${diff.slice(0, 5000)}
\`\`\`

Answer:
1. Does this fix address the reported issue?
2. Does it introduce any unrelated changes?
3. Could it cause any regressions?

Approve only if the fix is focused, correct, and safe.`
}

export function parseReviewResponse(response: string): ReviewResult {
  const lower = response.toLowerCase()
  const approved = lower.includes('approve') && !lower.includes('do not approve') && !lower.includes('reject')
  return { approved, reasoning: response.slice(0, 500) }
}
