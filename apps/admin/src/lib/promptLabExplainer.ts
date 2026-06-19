/**
 * Plain-language Prompt Lab workflow guide.
 */

export interface PromptLabWorkflowStep {
  id: string
  label: string
  plain: string
}

export const PROMPT_LAB_WORKFLOW: PromptLabWorkflowStep[] = [
  {
    id: 'judge',
    label: '1. Build eval dataset',
    plain: 'Run the Judge on classified reports — scored examples become your A/B benchmark.',
  },
  {
    id: 'clone',
    label: '2. Clone a baseline',
    plain: 'Copy the active global prompt into a project candidate — never edit production defaults in place.',
  },
  {
    id: 'ab',
    label: '3. A/B at low traffic',
    plain: 'Set Traffic % to 5–10 on the candidate so most users still hit the safe baseline.',
  },
  {
    id: 'promote',
    label: '4. Promote when judge ≥ 80%',
    plain: 'When the candidate beats the active prompt on judge score, promote it to 100% traffic.',
  },
]

export const PROMPT_LAB_EXPLAINER_SUMMARY =
  'Prompt Lab is where you tune the LLM instructions that classify bugs and draft fixes. Every change should go through clone → small A/B → judge score → promote — never edit the live prompt without a scored candidate.'

export const PROMPT_STAGE_PLAIN: Record<string, string> = {
  stage1: 'Fast filter — cheap spam gate before full classification',
  stage2: 'Classifier — severity, category, and routing for each report',
  judge: 'Judge grading rubric — how triage quality is scored',
  fix: 'Fix-agent system prompt — how draft PRs are written',
  intelligence: 'Weekly intelligence digest narrative',
  synthetic: 'Synthetic report generation for prompt testing',
}
