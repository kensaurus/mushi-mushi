import { describe, it, expect } from 'vitest'
import { checkFileScope, checkCircuitBreaker } from './scope.js'

describe('checkFileScope', () => {
  it('allows any file when restriction is "none"', () => {
    expect(checkFileScope('/foo/bar.ts', '/baz', 'none')).toEqual({ allowed: true })
  })

  it('allows test files regardless of restriction', () => {
    const testPaths = [
      'src/__tests__/foo.ts',
      'src/foo.test.ts',
      'src/foo.spec.ts',
      'test/foo.ts',
      'tests/foo.ts',
    ]
    for (const p of testPaths) {
      expect(checkFileScope(p, 'other/', 'component')).toEqual({ allowed: true })
    }
  })

  it('allows files inside the component directory', () => {
    expect(checkFileScope('src/components/Button.tsx', 'src/components', 'component'))
      .toEqual({ allowed: true })
  })

  it('blocks files outside the component directory', () => {
    const result = checkFileScope('src/pages/Home.tsx', 'src/components', 'component')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('outside scope')
  })

  it('allows when componentDir is undefined', () => {
    expect(checkFileScope('anything/here.ts', undefined, 'component'))
      .toEqual({ allowed: true })
  })

  it('normalizes backslashes for cross-platform paths', () => {
    expect(checkFileScope('src\\components\\Button.tsx', 'src/components', 'directory'))
      .toEqual({ allowed: true })
  })
})

describe('checkCircuitBreaker', () => {
  it('allows changes within limit', () => {
    expect(checkCircuitBreaker(50, 100)).toEqual({ allowed: true })
  })

  it('allows changes at exact limit', () => {
    expect(checkCircuitBreaker(100, 100)).toEqual({ allowed: true })
  })

  it('blocks changes exceeding limit', () => {
    const result = checkCircuitBreaker(101, 100)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('circuit breaker')
  })
})
