import type { ScopeCheck } from './types.js'

const TEST_PATTERNS = [
  /__tests__\//,
  /\.test\./,
  /\.spec\./,
  /test\//,
  /tests\//,
]

export function checkFileScope(
  filePath: string,
  componentDir: string | undefined,
  restriction: 'component' | 'directory' | 'none',
): ScopeCheck {
  if (restriction === 'none') return { allowed: true }

  // Test files always allowed
  if (TEST_PATTERNS.some(p => p.test(filePath))) {
    return { allowed: true }
  }

  if (!componentDir) return { allowed: true }

  const normalizedFile = filePath.replace(/\\/g, '/')
  const normalizedDir = componentDir.replace(/\\/g, '/')

  if (!normalizedFile.startsWith(normalizedDir)) {
    return {
      allowed: false,
      reason: `File ${filePath} is outside scope directory ${componentDir}`,
    }
  }

  return { allowed: true }
}

export function checkCircuitBreaker(
  linesChanged: number,
  maxLines: number,
): ScopeCheck {
  if (linesChanged > maxLines) {
    return {
      allowed: false,
      reason: `Change exceeds circuit breaker: ${linesChanged} lines > ${maxLines} max`,
    }
  }
  return { allowed: true }
}
