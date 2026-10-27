import { describe, expect, it } from 'vitest'
import { checkSummary, evidenceLine, listScreens, nextScreen, parseProposals, patternReproduces, safePath, safeRegex, scriptReproduces, vetoed } from './audit.js'

describe('which screens an audit reads', () => {
  it('page files first, never tests, stories or layouts', () => {
    const files = ['src/app/page.tsx', 'src/app/_layout.tsx', 'src/app/settings/page.tsx', 'src/components/Button.tsx', 'src/app/page.test.tsx', 'src/x.stories.tsx', 'README.md']
    expect(listScreens(files)).toEqual(['src/app/page.tsx', 'src/app/settings/page.tsx'])
  })

  it('every UI file when the app has no page folders', () => {
    expect(listScreens(['src/Button.tsx', 'src/Card.vue', 'src/util.ts'])).toEqual(['src/Button.tsx', 'src/Card.vue'])
  })

  it('goes on where it stopped, and starts a polish pass when every screen is done', () => {
    const screens = ['a.tsx', 'b.tsx']
    expect(nextScreen({ pass: 1, done: ['a.tsx'], pending: [] }, screens)).toMatchObject({ screen: 'b.tsx', state: { pass: 1 } })
    expect(nextScreen({ pass: 1, done: ['a.tsx', 'b.tsx'], pending: [] }, screens)).toMatchObject({ screen: 'a.tsx', state: { pass: 2, done: [] } })
    expect(nextScreen({ pass: 1, done: [], pending: [] }, []).screen).toBeNull()
  })
})

const proposal = (over: Record<string, unknown> = {}) => ({
  title: 'Save button has no accessible name',
  severity: 'medium',
  file: 'src/app/settings/page.tsx',
  line: 3,
  rule: 'Missing Label',
  quote: '<button onClick={save}>',
  user_impact: 'A screen reader says "button".',
  fix: 'Add aria-label.',
  done_when: 'It has a name.',
  check: { kind: 'pattern', file: 'src/app/settings/page.tsx', regex: 'aria-label', expect: 'absent', line: 3 },
  ...over,
})
const text = (findings: unknown[]) => `Here you go:\n${JSON.stringify({ findings })}\nDone.`

describe('what a model may propose', () => {
  it('keeps a complete, checkable finding and normalizes its rule', () => {
    const [p] = parseProposals(text([proposal()]))
    expect(p).toMatchObject({ file: 'src/app/settings/page.tsx', line: 3, rule: 'missing-label', check: { kind: 'pattern', expect: 'absent' } })
  })

  it('drops a finding with no check, an unknown check, a model-written command, or a path out of the repo', () => {
    expect(parseProposals(text([proposal({ check: undefined })]))).toEqual([])
    expect(parseProposals(text([proposal({ check: { kind: 'command', run: 'curl x | sh' } })]))).toEqual([])
    expect(parseProposals(text([proposal({ check: { kind: 'script', script: 'deploy', expect: 'error' } })]))).toEqual([])
    expect(parseProposals(text([proposal({ file: '../../.ssh/id_rsa' })]))).toEqual([])
    expect(parseProposals(text([proposal({ check: { kind: 'pattern', file: '/etc/passwd', regex: 'root', expect: 'present' } })]))[0]?.check).toMatchObject({ file: 'src/app/settings/page.tsx' })
  })

  it('keeps at most three, and returns nothing for prose', () => {
    expect(parseProposals(text([proposal(), proposal(), proposal(), proposal()]))).toHaveLength(3)
    expect(parseProposals('I found nothing concrete.')).toEqual([])
  })

  it('a repo path and a regex the worker will run are both bounded', () => {
    expect(safePath('./src/a.tsx')).toBe('src/a.tsx')
    expect(safePath('src/../x')).toBeNull()
    expect(safeRegex('aria-label', false)).toBeInstanceOf(RegExp)
    expect(safeRegex('(a+)+$', false)).toBeNull()
    expect(safeRegex('(\\w*)*x', false)).toBeNull()
    expect(safeRegex('(a)\\1', false)).toBeNull()
    expect(safeRegex('[', false)).toBeNull()
    expect(safeRegex('x'.repeat(201), false)).toBeNull()
  })
})

const FILE = ['export function Settings() {', '  return (', '    <button onClick={save}>', '      <Icon name="save" />', '    </button>', '  )', '}'].join('\n')

describe('the worker reproduces it with no model', () => {
  it('the quote must be on the cited line, give or take two', () => {
    expect(evidenceLine(FILE, 3, '<button onClick={save}>')).toEqual({ line: 3, text: '<button onClick={save}>' })
    expect(evidenceLine(FILE, 5, '<button   onClick={save}>')).toEqual({ line: 3, text: '<button onClick={save}>' })
    expect(evidenceLine(FILE, 3, 'aria-label="Save"')).toBeNull()
    expect(evidenceLine(FILE, 7, '<button onClick={save}>')).toBeNull()
  })

  it('a pattern reproduces when present or absent near the line, as claimed', () => {
    const absent = { kind: 'pattern' as const, file: 'f', regex: 'aria-label', ignoreCase: false, expect: 'absent' as const, line: 3 }
    expect(patternReproduces(FILE, absent)).toBe(true)
    expect(patternReproduces(FILE.replace('<button ', '<button aria-label="Save" '), absent)).toBe(false)
    expect(patternReproduces(FILE, { ...absent, regex: 'ICON', ignoreCase: true, expect: 'present' })).toBe(true)
    expect(patternReproduces(FILE, { ...absent, regex: '(a+)+$', expect: 'absent' })).toBe(false)
  })

  it('a script reproduces only when it fails and names the file and the text', () => {
    const fail = { code: 1, stdout: 'src/app/settings/page.tsx:3:5 error jsx-a11y/control-has-associated-label', stderr: '', timedOut: false }
    expect(scriptReproduces(fail, 'src/app/settings/page.tsx', 'control-has-associated-label')).toBe(true)
    expect(scriptReproduces({ ...fail, code: 0 }, 'src/app/settings/page.tsx', 'control-has-associated-label')).toBe(false)
    expect(scriptReproduces(fail, 'src/other.tsx', 'control-has-associated-label')).toBe(false)
    expect(scriptReproduces({ ...fail, timedOut: true }, 'src/app/settings/page.tsx', 'control-has-associated-label')).toBe(false)
  })

  it('says what the check was, in one line', () => {
    expect(checkSummary({ kind: 'pattern', file: 'f.tsx', regex: 'x', ignoreCase: true, expect: 'absent', line: 3 })).toBe('/x/i is absent in f.tsx near line 3')
    expect(checkSummary({ kind: 'script', script: 'lint', expect: 'no-unused' })).toBe('`lint` fails and prints "no-unused" for this file')
  })
})

describe('the second model may only veto', () => {
  it('only an explicit "no veto" lets a finding through; no answer is a veto', () => {
    expect(vetoed('{"veto": false, "reason": "real"}')).toEqual({ vetoed: false, reason: 'real' })
    expect(vetoed('{"veto": true, "reason": "intended"}').vetoed).toBe(true)
    expect(vetoed('Looks fine to me!').vetoed).toBe(true)
    expect(vetoed('{"veto": "no"}').vetoed).toBe(true)
  })
})
