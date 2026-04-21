import { describe, expect, it } from 'vitest'
import { isEnvFileCoveredByGitignore, sanitizeSecret } from './init.js'

describe('sanitizeSecret', () => {
  it('strips surrounding double quotes', () => {
    expect(sanitizeSecret('"mushi_abcdef12345"')).toBe('mushi_abcdef12345')
  })

  it('strips surrounding single quotes', () => {
    expect(sanitizeSecret("'mushi_abcdef12345'")).toBe('mushi_abcdef12345')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeSecret('  mushi_abcdef12345 \t')).toBe('mushi_abcdef12345')
  })

  it('removes CR / LF / NUL to prevent env-file injection', () => {
    expect(sanitizeSecret('mushi_abc\nEVIL_VAR=1')).toBe('mushi_abcEVIL_VAR=1')
    expect(sanitizeSecret('mushi_abc\r\nEVIL')).toBe('mushi_abcEVIL')
    expect(sanitizeSecret('mushi_abc\0foo')).toBe('mushi_abcfoo')
  })

  it('is a no-op on a clean secret', () => {
    expect(sanitizeSecret('mushi_abcdef12345')).toBe('mushi_abcdef12345')
  })
})

describe('isEnvFileCoveredByGitignore', () => {
  describe('when target is .env.local', () => {
    it('matches literal .env.local', () => {
      expect(isEnvFileCoveredByGitignore('.env.local', '.env.local')).toBe(true)
    })

    it('matches the .env* glob', () => {
      expect(isEnvFileCoveredByGitignore('.env*', '.env.local')).toBe(true)
    })

    it('matches the *.local glob', () => {
      expect(isEnvFileCoveredByGitignore('*.local', '.env.local')).toBe(true)
    })

    it('matches .env*.local', () => {
      expect(isEnvFileCoveredByGitignore('.env*.local', '.env.local')).toBe(true)
    })

    it('does NOT treat a literal .env as covering .env.local', () => {
      // the original bug: `.env` in .gitignore does not cover `.env.local`
      expect(isEnvFileCoveredByGitignore('.env', '.env.local')).toBe(false)
    })

    it('does NOT treat *.env as covering .env.local', () => {
      expect(isEnvFileCoveredByGitignore('*.env', '.env.local')).toBe(false)
    })

    it('ignores comment lines', () => {
      const content = '# comment about env\n.env.local\n'
      expect(isEnvFileCoveredByGitignore(content, '.env.local')).toBe(true)
    })

    it('ignores blank lines', () => {
      expect(isEnvFileCoveredByGitignore('\n\n.env.local\n', '.env.local')).toBe(true)
    })

    it('respects negations (!.env.local) by un-covering', () => {
      const content = '*.local\n!.env.local\n'
      expect(isEnvFileCoveredByGitignore(content, '.env.local')).toBe(false)
    })

    it('does not match directory-only patterns', () => {
      expect(isEnvFileCoveredByGitignore('.env.local/', '.env.local')).toBe(false)
    })

    it('strips the leading / anchor', () => {
      expect(isEnvFileCoveredByGitignore('/.env.local', '.env.local')).toBe(true)
    })
  })

  describe('when target is .env', () => {
    it('matches literal .env', () => {
      expect(isEnvFileCoveredByGitignore('.env', '.env')).toBe(true)
    })

    it('matches .env*', () => {
      expect(isEnvFileCoveredByGitignore('.env*', '.env')).toBe(true)
    })

    it('does not match *.local', () => {
      expect(isEnvFileCoveredByGitignore('*.local', '.env')).toBe(false)
    })
  })
})
