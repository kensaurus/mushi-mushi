import { describe, expect, it } from 'vitest'
import type { DevianceFinding, DevianceRun, RecipeIssue } from '../../lib/recipeTypes'
import { allFilesFixPrompt, designLead, fileFixPrompt, formatNoteGroups, formatNotesPrompt, groupFindingsByFile, totalFindings } from './designFindings'
import { issueCodeLabel } from '../recipe/recipeIssueLabels'

// mushi-mushi-allowlist: the hex values here are design-drift finding text under test, never a UI colour.
const f = (over: Partial<DevianceFinding>): DevianceFinding => ({
  rule_id: 'off_token_color',
  severity: 'warn',
  file_path: 'src/App.tsx',
  line: 10,
  col: 1,
  value: '#ff0000',
  message: 'Colour is not a token.',
  suggestion: { token: 'color.danger', cssVar: '--color-danger', ts: null, value: '#fe0000', distance: 1 },
  ...over,
})

const run = (over: Partial<DevianceRun>): DevianceRun => ({
  runId: 'r1',
  status: 'warn',
  score: 42.4,
  scannedFiles: 10,
  scannedLines: 1000,
  matchedFiles: 10,
  truncated: false,
  commitSha: null,
  startedAt: '2026-11-19T00:00:00Z',
  completedAt: '2026-11-19T00:01:00Z',
  breakdown: [],
  counts: { off_token_color: 100, off_scale_spacing: 6 },
  storedFindings: 50,
  error: null,
  ...over,
})

describe('groupFindingsByFile', () => {
  it('groups per file, files with errors first, then by count', () => {
    const groups = groupFindingsByFile([
      f({ file_path: 'a.tsx' }),
      f({ file_path: 'a.tsx', rule_id: 'off_scale_spacing', line: 3 }),
      f({ file_path: 'b.tsx', severity: 'error' }),
      f({ file_path: null }),
    ])
    expect(groups.map((g) => g.file)).toEqual(['b.tsx', 'a.tsx', '(file not known)'])
    expect(groups[1]!.rules).toEqual([
      { rule: 'off_token_color', count: 1 },
      { rule: 'off_scale_spacing', count: 1 },
    ])
    // Inside a file, by line.
    expect(groups[1]!.findings.map((x) => x.line)).toEqual([3, 10])
  })
})

describe('fix prompts', () => {
  // mushi-mushi-allowlist: finding text under test, not a UI colour.
  it('names the file, each line and the token to use', () => {
    const [g] = groupFindingsByFile([f({})])
    const text = fileFixPrompt(g!)
    expect(text).toContain('1 hard-coded style in src/App.tsx')
    expect(text).toContain('- line 10: `#ff0000` Colour is not a token → use --color-danger (#fe0000)')
    expect(text).toContain('Replace each hard-coded value')
  })

  it('caps the all-files prompt and counts the rest', () => {
    const groups = groupFindingsByFile([f({ file_path: 'a' }), f({ file_path: 'b' }), f({ file_path: 'c' })])
    const text = allFilesFixPrompt(groups, 2)
    expect(text).toContain('3 hard-coded styles in 3 files')
    expect(text).toContain('And 1 more files')
  })
})

describe('format notes', () => {
  const notes: RecipeIssue[] = [
    { severity: 'info', code: 'legacy_color_string', message: 'x', file: 'tokens.json' },
    { severity: 'info', code: 'legacy_color_string', message: 'y', file: 'tokens.json' },
    { severity: 'info', code: 'legacy_duration_string', message: 'z', file: 'motion.json' },
  ]
  it('counts per kind in plain words and never leads with the code', () => {
    expect(formatNoteGroups(notes)).toEqual([
      { code: 'legacy_color_string', label: 'Colour written as plain text', count: 2 },
      { code: 'legacy_duration_string', label: 'Duration written as plain text', count: 1 },
    ])
    const text = formatNotesPrompt(notes)
    expect(text).toContain('3 design tokens written in an older format in tokens.json, motion.json')
    expect(text).not.toContain('legacy_')
    expect(issueCodeLabel('some_new_code')).toBe('Some new code')
  })
})

describe('designLead', () => {
  it('leads with the hard-coded styles and the fix-all prompt', () => {
    const lead = designLead({ latest: run({}), lastError: null, files: 23, tokenProblems: 0, formatNotes: 67 })
    expect(lead.sentence).toBe('106 places in 23 files use a hard-coded style instead of your design tokens.')
    expect(lead.next).toBe('fix-all')
    expect(lead.metrics.map((m) => [m.label, m.value])).toEqual([
      ['Hard-coded styles', '106'],
      ['Files', 23],
      ['Drift score (lower is better)', 42],
    ])
  })

  it('asks for a run with no scan or a failed one, and is green only when nothing is open', () => {
    expect(designLead({ latest: null, lastError: null, files: 0, tokenProblems: 0, formatNotes: 0 }).next).toBe('run')
    expect(designLead({ latest: run({}), lastError: { at: 'x', message: 'Repo not readable.' }, files: 1, tokenProblems: 0, formatNotes: 0 })).toMatchObject({ tone: 'danger', next: 'run' })
    expect(designLead({ latest: run({ status: 'error', error: 'timeout' }), lastError: null, files: 0, tokenProblems: 0, formatNotes: 0 }).sentence).toContain('could not finish: timeout')
    const ok = designLead({ latest: run({ counts: {}, storedFindings: 0, status: 'pass' }), lastError: null, files: 0, tokenProblems: 0, formatNotes: 67 })
    expect(ok.tone).toBe('ok')
    expect(ok.sentence).toContain('67 tokens are written in an older format; nothing is broken.')
    expect(designLead({ latest: run({ counts: {}, storedFindings: 0, status: 'pass' }), lastError: null, files: 0, tokenProblems: 2, formatNotes: 0 }).tone).toBe('warn')
    expect(totalFindings(null)).toBeNull()
  })
})
