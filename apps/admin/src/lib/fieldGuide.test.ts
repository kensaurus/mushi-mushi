import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CRASH_GUIDE,
  FIRST_RUN_NAME_PROJECT,
  GUIDE_LINE_MAX,
  HOME_ALL_CLEAR,
  NOT_FOUND_GUIDE,
  editorConnectGuide,
  firstDiagnosisGuide,
  loginGuide,
  onboardingTabGuide,
  type EditorConnectState,
  type GuideLine,
} from './fieldGuide'
import type { FirstDiagnosisState } from './firstDiagnosis'
import { ONBOARDING_TAB_IDS } from '../components/onboarding/types'
import type { LoginFormMode } from './loginSubmit'

const DIAGNOSIS: FirstDiagnosisState['phase'][] = [
  'idle',
  'sending',
  'queued',
  'classifying',
  'diagnosed',
  'quota_exhausted',
  'classifier_failed',
  'offline',
  'timed_out',
  'send_failed',
]

/** A minimal state per phase; the guide only reads `phase`. */
function stateFor(phase: FirstDiagnosisState['phase']): FirstDiagnosisState {
  return { phase } as FirstDiagnosisState
}

const LOGIN_MODES: LoginFormMode[] = ['login', 'magic', 'signup', 'forgot']
const EDITOR_STATES: EditorConnectState[] = [
  'no_project',
  'endpoint_mismatch',
  'report_only_keys',
  'no_mcp_key',
  'never_connected',
  'healthy',
]

function everyLine(): Array<[string, GuideLine]> {
  return [
    ...LOGIN_MODES.flatMap((m) => [
      [`login:${m}`, loginGuide(m, 'console')] as [string, GuideLine],
      [`login:${m}:tester`, loginGuide(m, 'tester')] as [string, GuideLine],
    ]),
    ['first-run', FIRST_RUN_NAME_PROJECT],
    ...DIAGNOSIS.map((p) => [`diagnosis:${p}`, firstDiagnosisGuide(stateFor(p))] as [string, GuideLine]),
    ...ONBOARDING_TAB_IDS.flatMap((t) => [
      [`tab:${t}:new`, onboardingTabGuide(t, { hasProject: false, complete: false })] as [string, GuideLine],
      [`tab:${t}`, onboardingTabGuide(t, { hasProject: true, complete: false })] as [string, GuideLine],
      [`tab:${t}:done`, onboardingTabGuide(t, { hasProject: true, complete: true })] as [string, GuideLine],
    ]),
    ['home-all-clear', HOME_ALL_CLEAR],
    ...EDITOR_STATES.map((s) => [`editor:${s}`, editorConnectGuide(s)] as [string, GuideLine]),
    ['not-found', NOT_FOUND_GUIDE],
    ['crash', CRASH_GUIDE],
  ]
}

describe('field guide lines', () => {
  it.each(everyLine())('%s fits a phone (≤ 90 characters)', (_id, g) => {
    expect(g.line.length).toBeLessThanOrEqual(GUIDE_LINE_MAX)
    expect(g.line.trim()).toBe(g.line)
    expect(g.line.length).toBeGreaterThan(10)
  })

  it.each(everyLine())('%s stays calm and plain', (_id, g) => {
    // A calm naturalist: no exclamation marks, no hype words (docs/marketing/VOICE.md).
    expect(g.line).not.toMatch(/!/)
    expect(g.line).not.toMatch(/\b(empower|seamless|unlock|elevate|leverage|revolutioni[sz]e|magic(al)?ly|awesome|oops)\b/i)
    // The product is "Mushi Mushi", never a bare "Mushi" (owner, 2026-10-29).
    expect(g.line).not.toMatch(/\bMushi\b(?! Mushi)/)
    // Never blame the developer.
    expect(g.line).not.toMatch(/\byour (fault|mistake)\b/i)
  })

  it.each(everyLine())('%s uses a pose that ships as an asset', (_id, g) => {
    const dir = join(__dirname, '../assets/mascot')
    expect(existsSync(join(dir, `mascot-${g.pose}.webp`))).toBe(true)
    expect(existsSync(join(dir, `mascot-${g.pose}-sm.webp`))).toBe(true)
  })

  it('shows the found pose only once the diagnosis is ready', () => {
    for (const phase of DIAGNOSIS) {
      const pose = firstDiagnosisGuide(stateFor(phase)).pose
      if (phase === 'diagnosed') expect(pose).toBe('found')
      else expect(pose).not.toBe('found')
    }
  })

  it('never points at the progress rail before a project exists', () => {
    expect(onboardingTabGuide('overview', { hasProject: false, complete: false }).line).not.toMatch(/rail/)
    expect(onboardingTabGuide('overview', { hasProject: true, complete: false }).line).toMatch(/rail/)
  })

  it('looks closely (magnify) while the report is moving through the pipeline', () => {
    for (const phase of ['sending', 'queued', 'classifying'] as const) {
      expect(firstDiagnosisGuide(stateFor(phase)).pose).toBe('magnify')
    }
  })
})
