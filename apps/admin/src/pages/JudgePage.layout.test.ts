/**
 * Triage grading layout rules from the round-2 review (2026-11-18). The page needs five data
 * hooks and the setup status to render, so these are pinned in source; the logic behind them
 * is tested in components/judge/judgePrompts.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, 'JudgePage.tsx'), 'utf8')

describe('Triage grading layout', () => {
  it('draws the weekly chart and history only from two weeks of grades', () => {
    expect(src).toContain('const drawTrend = canDrawTrend(weeks.length)')
    expect(src).toMatch(/\{drawTrend \? \(\s*<div className="relative">\s*<LineSparkline/)
    expect(src).toMatch(/\{drawTrend && \(\s*<Section title="Weekly history">/)
    expect(src).toContain('data-testid="judge-trend-single"')
  })

  it('says the Lessons sentence on Overview only, not under every tab', () => {
    expect(src).toMatch(/\{activeTab === 'overview' && \(\s*<p className="text-xs text-fg-muted">\s*Grading scores one report at a time\./)
  })

  it('writes the grade dimensions out and puts Score before the report metadata', () => {
    const head = src.slice(src.indexOf('<th className="py-1.5 px-3 font-medium">Report</th>'))
    expect(head.indexOf('short="Score"')).toBeLessThan(head.indexOf('>When</th>'))
    expect(src).not.toContain('<HeaderTip short="Acc" />')
    expect(src).toContain('<HeaderTip short="Repro steps"')
  })

  it('keeps a report severity out of the warning colour unless it is high or critical', () => {
    expect(src).toContain('tone={severityChipTone(e.report_severity)}')
    expect(src).not.toMatch(/<SignalChip tone="warn" className="ml-1 normal-case font-sans">\s*\{e\.report_severity\}/)
  })

  it('prints grades in the sans font', () => {
    expect(src).not.toContain('`font-mono tabular-nums ${tone}`')
  })
})
