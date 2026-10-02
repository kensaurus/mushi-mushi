import { describe, expect, it } from 'vitest'
import { parseIssueIdInput, sentryImportBody } from './sentryImport'

describe('parseIssueIdInput', () => {
  it('splits on commas and whitespace, drops blanks and duplicates', () => {
    expect(parseIssueIdInput(' WEB-12, 4501\nWEB-13  WEB-12 ,')).toEqual(['WEB-12', '4501', 'WEB-13'])
    expect(parseIssueIdInput('   ')).toEqual([])
  })
})

describe('sentryImportBody', () => {
  it('sends ids when given, otherwise asks for the newest five', () => {
    expect(sentryImportBody(['WEB-12'])).toEqual({ issueIds: ['WEB-12'] })
    expect(sentryImportBody([])).toEqual({ limit: 5 })
  })
})
