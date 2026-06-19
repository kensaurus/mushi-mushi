/**
 * Plain-language Judge explainer — classifier vs independent judge.
 */

export interface JudgePipelineStep {
  id: 'classifier' | 'judge'
  label: string
  when: string
  measures: string
}

export const JUDGE_PIPELINE_STEPS: JudgePipelineStep[] = [
  {
    id: 'classifier',
    label: 'Classifier (automatic)',
    when: 'Runs on every new report within seconds of ingest.',
    measures:
      'Severity, category, blast radius, and whether auto-fix should run — this is what triage and routing use day-to-day.',
  },
  {
    id: 'judge',
    label: 'Judge (independent audit)',
    when: 'Runs on a sample of classified reports — manually or on Mon/Thu cron.',
    measures:
      'Grades whether the classifier got severity, accuracy, and reproducibility right. Disagreements mean triage quality may be drifting.',
  },
]

export const JUDGE_EXPLAINER_SUMMARY =
  'The classifier triages bugs fast; the judge double-checks a sample so you catch bad severity labels before they reach customers. Run the judge after prompt changes or when disagreement rate climbs.'

export interface JudgeScoreDimension {
  key: string
  label: string
  plain: string
}

/** Human labels for score dimensions shown on the Judge overview tab. */
export const JUDGE_SCORE_DIMENSIONS_PLAIN: JudgeScoreDimension[] = [
  { key: 'accuracy', label: 'Accuracy', plain: 'Did the classifier pick the right bug category?' },
  { key: 'severity', label: 'Severity', plain: 'Was the urgency level appropriate for user impact?' },
  { key: 'component', label: 'Component', plain: 'Did it identify the right part of the app?' },
  { key: 'repro', label: 'Reproducibility', plain: 'Could someone reproduce the bug from the report?' },
]
