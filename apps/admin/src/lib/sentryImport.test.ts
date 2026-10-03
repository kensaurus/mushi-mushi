import { describe, expect, it } from 'vitest'
import { parseIssueIdInput, sentryImportBody, sentrySearchBody } from './sentryImport'

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

describe('sentrySearchBody', () => {
  it('keeps the plain newest-5 search when nothing is chosen', () => {
    expect(sentrySearchBody({})).toEqual({ limit: 5 })
  })

  it('pulls full pages of 10 for a backlog window and carries project + cursor', () => {
    expect(sentrySearchBody({ sinceDays: 30 })).toEqual({ limit: 10, sinceDays: 30 })
    expect(sentrySearchBody({ sinceDays: 7, sentryProject: 'api' }, '1700:0:1')).toEqual({
      limit: 10,
      sinceDays: 7,
      sentryProject: 'api',
      cursor: '1700:0:1',
    })
    expect(sentrySearchBody({ sentryProject: 'api' }, null)).toEqual({ limit: 5, sentryProject: 'api' })
  })
})
