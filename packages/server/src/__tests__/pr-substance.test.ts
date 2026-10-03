/**
 * FILE: pr-substance.test.ts
 * PURPOSE: The notes-only detector that stops a cloud agent's speculative
 *          PR (NEEDS_INVESTIGATION.md, a markdown write-up, TODO comments)
 *          from moving a report to `fixing`. Conservative: anything it cannot
 *          prove is notes-only is a code change.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyPrSubstance,
  isDocFile,
  isTodoOnlyChange,
  parsePullRequestUrl,
  type PrChangedFile,
} from '../../supabase/functions/_shared/pr-substance.ts'

const file = (filename: string, patch: string | null, extra: Partial<PrChangedFile> = {}): PrChangedFile => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 0,
  patch,
  ...extra,
})

describe('isDocFile', () => {
  it('matches prose by extension and the NEEDS_INVESTIGATION note by name', () => {
    expect(isDocFile('NEEDS_INVESTIGATION.md')).toBe(true)
    expect(isDocFile('docs/needs-investigation')).toBe(true)
    expect(isDocFile('apps/docs/content/guide.mdx')).toBe(true)
    expect(isDocFile('notes.TXT')).toBe(true)
    expect(isDocFile('src/login.ts')).toBe(false)
    expect(isDocFile('apps/docs/app/layout.tsx')).toBe(false)
    expect(isDocFile('Dockerfile')).toBe(false)
    expect(isDocFile('.md')).toBe(false)
  })
})

describe('isTodoOnlyChange', () => {
  it('is true only when every added line is a TODO-style comment and nothing is deleted', () => {
    expect(isTodoOnlyChange(file('src/a.ts', '@@ -1 +1,2 @@\n a\n+// TODO: investigate the null user here\n+'))).toBe(true)
    expect(isTodoOnlyChange(file('a.py', '+# FIXME needs investigation'))).toBe(true)
    expect(isTodoOnlyChange(file('a.sql', '+-- XXX check the index'))).toBe(true)
  })

  it('treats any real line, deletion, plain comment or missing patch as a code change', () => {
    expect(isTodoOnlyChange(file('src/a.ts', '+// TODO: x\n+if (!user) return'))).toBe(false)
    expect(isTodoOnlyChange(file('src/a.ts', '+// TODO: x', { deletions: 1 }))).toBe(false)
    expect(isTodoOnlyChange(file('src/a.ts', '+// explains the guard'))).toBe(false)
    expect(isTodoOnlyChange(file('src/a.ts', null))).toBe(false)
    expect(isTodoOnlyChange(file('src/a.ts', '+\n+   '))).toBe(false)
    // A YAML value or a CLI flag mentioning TODO is not a comment line.
    expect(isTodoOnlyChange(file('ci.yml', '+  run: echo TODO'))).toBe(false)
    expect(isTodoOnlyChange(file('Dockerfile', '+    --mount=type=cache TODO'))).toBe(false)
    expect(isTodoOnlyChange(file('run.sh', '+#!/bin/sh TODO'))).toBe(false)
  })
})

describe('classifyPrSubstance', () => {
  it('does not judge an empty PR (the Copilot agent opens its PR before pushing)', () => {
    expect(classifyPrSubstance([], { complete: true })).toEqual({ speculative: false })
  })

  it('flags a notes-only PR as speculative', () => {
    const v = classifyPrSubstance(
      [
        file('NEEDS_INVESTIGATION.md', '+# what I checked', { status: 'added' }),
        file('src/a.ts', '+// TODO(mushi): the crash is somewhere in here'),
      ],
      { complete: true },
    )
    expect(v).toMatchObject({ speculative: true, files: ['NEEDS_INVESTIGATION.md', 'src/a.ts'] })
    if (v.speculative) expect(v.reason).toContain('NEEDS_INVESTIGATION.md')
  })

  it('a single code change, a removal or a truncated listing is never speculative', () => {
    expect(classifyPrSubstance([file('README.md', '+x'), file('src/a.ts', '+fix()')], { complete: true })).toEqual({ speculative: false })
    expect(classifyPrSubstance([file('old.md', null, { status: 'removed', deletions: 5 })], { complete: true })).toEqual({ speculative: false })
    expect(classifyPrSubstance([file('NOTES.md', '+x')], { complete: false })).toEqual({ speculative: false })
  })
})

describe('parsePullRequestUrl', () => {
  it('parses GitHub PR URLs and rejects the rest', () => {
    expect(parsePullRequestUrl('https://github.com/acme/web/pull/42')).toEqual({ owner: 'acme', repo: 'web', number: 42 })
    expect(parsePullRequestUrl('https://github.com/acme/web/pull/42/files')).toEqual({ owner: 'acme', repo: 'web', number: 42 })
    expect(parsePullRequestUrl('https://github.com/acme/web/issues/42')).toBeNull()
    expect(parsePullRequestUrl('https://gitlab.com/acme/web/pull/42')).toBeNull()
    expect(parsePullRequestUrl('https://github.com/acme/web/pull/0')).toBeNull()
  })
})
