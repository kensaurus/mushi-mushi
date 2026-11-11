/**
 * FILE: apps/admin/src/lib/setupStepWords.ts
 * PURPOSE: The setup checklist in a builder's words (console audit
 *          2026-11-11, finding 9). The server's step list said "Install the
 *          SDK", "BYOK avoids platform quotas", "watch the LLM agent", "QA
 *          story" and "Seer root-cause", and one screen offered "Install SDK"
 *          three times and "Connect GitHub" three times.
 *
 *          The console rewords the steps it knows by id (an unknown step
 *          keeps the server's words), and a later step that leads to the same
 *          page as an earlier open one shows no second button.
 */

import type { SetupStep } from './useSetupStatus'

const WORDS: Record<string, Partial<Pick<SetupStep, 'label' | 'description' | 'cta_label'>>> = {
  api_key_generated: {
    label: 'Get your app key',
    description: 'The key lets your app send bug reports to Mushi Mushi. It can only send reports.',
    cta_label: 'Get the key',
  },
  sdk_installed: {
    label: 'Put the report button in your app',
    description: 'Add the report button to your live app so your users can tell you what broke.',
    cta_label: 'Add the button',
  },
  first_report_received: {
    label: 'Get your first bug report',
    description: 'Send a test report, or wait for one of your users.',
  },
  github_connected: {
    label: 'Connect GitHub',
    description: 'Lets Mushi Mushi read your code to explain bugs better, and open fixes for you to review.',
  },
  sentry_connected: {
    label: 'Connect Sentry (optional)',
    description: 'Already use Sentry for crash alerts? Its crashes arrive here as bugs, each with an explanation.',
  },
  byok_anthropic: {
    label: 'Use your own AI key (optional)',
    description: 'Mushi Mushi pays for the AI on the free plan. Add your own Anthropic or OpenAI key to go past its limits; you pay the AI company directly.',
    cta_label: 'Add a key',
  },
  first_fix_dispatched: {
    label: 'Let Mushi Mushi fix a bug for you (optional)',
    description: 'Open a bug and press Dispatch fix: Mushi Mushi writes the change and opens it for you to review.',
    cta_label: 'Open my bugs',
  },
  first_qa_story_passing: {
    label: 'Check a key page automatically (optional)',
    description: 'Describe in plain words what should work, such as "sign in and see the dashboard". Mushi Mushi tries it on a schedule and tells you when it breaks.',
    cta_label: 'Add a check',
  },
  slack_connected: {
    description: 'Get a Slack message when a new bug arrives or a check fails.',
  },
}

/** The steps in plain words, with no second button to a page an earlier open step already offers. */
export function plainSetupSteps(steps: readonly SetupStep[]): SetupStep[] {
  const offered = new Set<string>()
  return steps.map((step) => {
    const words = WORDS[step.id] ?? {}
    const next: SetupStep = { ...step, ...words }
    if (!step.complete && step.cta_to) {
      const page = step.cta_to.split('#')[0]!.split('?')[0]!
      if (offered.has(page)) next.cta_label = ''
      else offered.add(page)
    }
    return next
  })
}
