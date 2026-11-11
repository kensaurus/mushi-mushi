/**
 * Console audit 2026-11-11, blockers 1–3 and findings 5 and 9: the console's
 * side of "out of credits", the host guidance under the install snippet, and
 * the setup checklist in plain words. Real error text from production.
 */
import { describe, expect, it } from 'vitest'
import { AGENT_OUT_OF_USAGE_BUCKET, isAgentOutOfUsageError } from './agentOutOfUsage'
import { agentCreditsTitle, CLAUDE_FOLLOWUPS_COMMAND, CLAUDE_WORK_COMMAND, CLAUDE_WORK_NEEDS, creditsBackLine } from './agentCredits'
import { fixCauseLabel, failureHeadline, retryCandidates } from './fixReportTruth'
import { fixFailureBucket } from './pdcaAct'
import { creditCountdowns } from './creditPlan'
import { builderPrompt, hostGuide, webEnvNames } from './hostingEnvHint'
import { plainSetupSteps } from './setupStepWords'
import type { FixAttempt } from '../components/fixes/types'
import type { SetupStep } from './useSetupStatus'

const LOCAL_OUT =
  "Local agent finished without a change: ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue."

function fix(over: Partial<FixAttempt>): FixAttempt {
  return { id: 'f1', report_id: 'r1', status: 'failed', started_at: '2026-11-08T00:00:00Z', retryable: true, ...over } as FixAttempt
}

describe('out-of-usage failures', () => {
  it('are named, bucketed and never offered for retry', () => {
    const f = fix({ error: LOCAL_OUT, failure_category: null })
    expect(isAgentOutOfUsageError(LOCAL_OUT)).toBe(true)
    expect(fixFailureBucket(f)).toBe(AGENT_OUT_OF_USAGE_BUCKET)
    expect(fixCauseLabel(AGENT_OUT_OF_USAGE_BUCKET)).toBe('Coding agent out of credits')
    expect(failureHeadline(f)?.title).toContain('out of credits')
    // The row stays retryable: FixesPage hides Retry from the live state, so
    // these can be retried once the credits are back.
    expect(retryCandidates([f])).toHaveLength(1)
  })

  it('reads Cursor Cloud refusals stored as cursor_api_error the same way', () => {
    const f = fix({ error: 'Cursor API 400 usage_limit_exceeded: On-demand usage is required.', failure_category: 'cursor_api_error' })
    expect(fixFailureBucket(f)).toBe(AGENT_OUT_OF_USAGE_BUCKET)
  })
})

describe('the out-of-credits words', () => {
  const state = { out: true, since: '2026-11-07T00:15:00Z', refused: 53, backAt: '2026-11-19T23:59:59Z', backLabel: 'kensaurus' }
  it('says since when and when they come back', () => {
    expect(agentCreditsTitle(state)).toBe('Automatic fixes are out of credits since Nov 7')
    expect(creditsBackLine(state)).toBe('Cursor\'s credits come back on Nov 19 (key "kensaurus").')
  })

  it('gives commands that run with no global install, and what they need', () => {
    expect(CLAUDE_WORK_COMMAND).toBe('npx @mushi-mushi/cli@latest work --agent claude --repo-dir .')
    expect(CLAUDE_FOLLOWUPS_COMMAND).toBe('npx @mushi-mushi/cli@latest work --agent claude --followups --repo-dir .')
    expect(CLAUDE_WORK_NEEDS.map((n) => n.command)).toEqual(['claude auth login', 'gh auth login', 'npx @mushi-mushi/cli@latest login'])
  })

  it('Spend credits says "out of credits", not "room for 440 more fixes"', () => {
    const key = { id: 'k1', label: 'kenji.sakuramoto', keyHint: null, enabled: false, creditsExpireAt: '2026-11-21T23:59:59Z', dailyLimit: 40, dispatchedToday: 0, state: 'active' }
    const now = new Date('2026-11-11T09:00:00Z')
    const before = creditCountdowns({ cursorKeys: [key], firecrawl: null, now })[0]!
    expect(before.idle).toBe(true)
    const out = creditCountdowns({ cursorKeys: [key], firecrawl: null, outOfCredits: { backAt: state.backAt }, now })[0]!
    expect(out.idle).toBe(false)
    expect(out.tone).toBe('danger')
    expect(`${out.usedLine} ${out.leftLine}`).toContain('Out of credits')
    expect(out.leftLine).not.toMatch(/room for/i)
  })
})

describe('where the key goes when the app is live', () => {
  it('gives Lovable and Bolt the paste-ready prompt with the real values, and the Script tag', () => {
    const g = hostGuide('lovable', { projectId: 'p-1', apiKey: 'mushi_k' })
    expect(g.useScriptTag).toBe(true)
    expect(g.prompt).toBe(builderPrompt('p-1', 'mushi_k'))
    expect(g.prompt).toContain('data-project="p-1" data-key="mushi_k"')
  })

  it('gives Vercel and Netlify the names the snippet reads, with the real values once a key is made', () => {
    const v = hostGuide('vercel', { projectId: 'p-1', apiKey: 'mushi_k', bundler: 'next' })
    expect(v.envNames).toEqual(['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'NEXT_PUBLIC_MUSHI_API_KEY'])
    expect(v.envBlock).toBe('NEXT_PUBLIC_MUSHI_PROJECT_ID=p-1\nNEXT_PUBLIC_MUSHI_API_KEY=mushi_k')
    expect(v.steps.join(' ')).toContain('vercel env add NEXT_PUBLIC_MUSHI_PROJECT_ID production')
    // No key on the page: names only, and where the value comes from. Never a placeholder to paste.
    const noKey = hostGuide('vercel', { projectId: 'p-1', apiKey: null, bundler: 'next' })
    expect(noKey.envBlock).toBeUndefined()
    expect(noKey.lead).toContain('Make a key and fill it in')
    expect(JSON.stringify(noKey)).not.toContain('YOUR_SDK_KEY')
    expect(hostGuide('netlify', { projectId: 'p', apiKey: 'k', bundler: 'vite' }).envNames).toEqual(webEnvNames('vite'))
    // With the Script tag nothing goes in the host's settings.
    const tag = hostGuide('vercel', { projectId: 'p', apiKey: 'k', scriptTag: true })
    expect(tag.envNames).toBeUndefined()
    expect(tag.lead).toContain("nothing goes in Vercel's settings")
    expect(webEnvNames('vite')).toEqual(['VITE_MUSHI_PROJECT_ID', 'VITE_MUSHI_API_KEY'])
  })

  it('asks for the React setup instead of guessing Vite (re-audit 2026-11-11: Next.js on Vercel got VITE_ names)', () => {
    for (const host of ['vercel', 'netlify', 'other'] as const) {
      const ask = hostGuide(host, { projectId: 'p', apiKey: 'k', bundler: null, askSetup: true })
      expect(ask.askSetup).toBe(true)
      expect(ask.envNames).toBeUndefined()
      expect(JSON.stringify(ask)).not.toMatch(/VITE_|NEXT_PUBLIC_/)
      expect(ask.lead).toContain('Next.js or Vite')
    }
  })

  it('says nothing goes in the host settings when the snippet holds its values inline', () => {
    const inline = hostGuide('vercel', { projectId: 'p', apiKey: 'k', bundler: null })
    expect(inline.envNames).toBeUndefined()
    expect(inline.lead).toContain("nothing goes in Vercel's settings")
    expect(JSON.stringify(inline)).not.toMatch(/VITE_MUSHI|NEXT_PUBLIC_MUSHI/)
  })
})

describe('the setup checklist in plain words', () => {
  const step = (id: string, cta_to: string, complete = false): SetupStep =>
    ({ id, label: id, description: 'x', complete, required: false, cta_to, cta_label: `Go ${id}` }) as SetupStep

  it('rewords known steps and keeps unknown ones', () => {
    const [byok, other] = plainSetupSteps([step('byok_anthropic', '/settings?tab=byok'), step('mystery', '/x')])
    expect(byok!.label).toBe('Use your own AI key (optional)')
    expect(`${byok!.label} ${byok!.description}`).not.toMatch(/BYOK/)
    expect(other!.label).toBe('mystery')
  })

  it('offers each page once among the open steps', () => {
    const out = plainSetupSteps([
      step('github_connected', '/connect#connect-github'),
      step('sdk_installed', '/connect?tab=sdk'),
      step('done_one', '/connect', true),
    ])
    expect(out[0]!.cta_label).not.toBe('')
    expect(out[1]!.cta_label).toBe('')
  })
})
