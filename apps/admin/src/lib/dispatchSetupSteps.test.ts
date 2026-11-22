import { describe, expect, it } from 'vitest'
import { dispatchSetupSentence, dispatchSetupSteps } from './dispatchSetupSteps'
import type { PreflightCheck } from './useDispatchPreflight'

const check = (key: PreflightCheck['key'], label: string, ready: boolean) => ({ key, label, ready, fixHref: `/fix/${key}` })

describe('dispatchSetupSteps', () => {
  it('lists the steps left in plain words, with links and a count from the server list', () => {
    const setup = dispatchSetupSteps([
      check('github', 'GitHub repo connected', false),
      check('codebase', 'Codebase indexed', false),
      check('agent', 'AI key for writing fixes', true),
      check('autofix', 'Autofix enabled', false),
    ])
    expect(setup).toEqual({
      steps: [
        { key: 'github', label: 'Connect GitHub', href: '/fix/github' },
        { key: 'codebase', label: 'Index your code', href: '/fix/codebase' },
        { key: 'autofix', label: 'Turn on Autofix', href: '/fix/autofix' },
      ],
      done: 1,
      total: 4,
    })
    expect(dispatchSetupSentence(setup!)).toBe('To dispatch a fix: Connect GitHub · Index your code · Turn on Autofix (1 of 4 done)')
  })

  it('names the agent step after the agent that writes the fix', () => {
    const label = (l: string) => dispatchSetupSteps([check('agent', l, false)])!.steps[0].label
    expect(label('AI key for writing fixes (OpenAI)')).toBe('Add an AI key')
    expect(label('Cursor key for the fix agent')).toBe('Add a Cursor key')
    expect(label('Cursor is out of credits')).toBe('Top up Cursor credits')
    expect(label('Fix agent on your own computer')).toBe('Fix agent on your own computer')
    // Older servers.
    expect(dispatchSetupSteps([check('anthropic', 'Anthropic key set', false)])!.steps[0].label).toBe('Add an AI key')
  })

  it('is null when nothing is left or the checks are unknown', () => {
    expect(dispatchSetupSteps([check('github', 'GitHub repo connected', true)])).toBeNull()
    expect(dispatchSetupSteps([])).toBeNull()
    expect(dispatchSetupSteps(null)).toBeNull()
  })
})
