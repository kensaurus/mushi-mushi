import { describe, expect, it } from 'vitest'
import { LOCAL_QA_RUN_LABEL, QA_PROVIDER_DEFINITIONS } from './qaProviderGuide'

describe('local QA stories', () => {
  it('tells the operator they run only via the CLI', () => {
    expect(LOCAL_QA_RUN_LABEL).toBe('Runs only via `mushi qa run`')
    expect(QA_PROVIDER_DEFINITIONS.find((p) => p.id === 'local')?.requires).toBe(LOCAL_QA_RUN_LABEL)
  })
})
