/**
 * The landing's bug-loop row (<LoopPipeline /> in packages/marketing-ui)
 * must use the console's own /pipeline stage names, in the console's order,
 * so the marketing picture and the product never say different words.
 * Source of truth: PIPELINE_STAGES in _shared/pipeline-view.ts.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOOP_STAGES } from '../../../packages/marketing-ui/src/pipeline/stages'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function consoleStageLabels(): string[] {
  const src = readFileSync(
    join(ROOT, 'packages', 'server', 'supabase', 'functions', '_shared', 'pipeline-view.ts'),
    'utf8',
  )
  return [...src.matchAll(/\{\s*id:\s*'[a-z]+',\s*label:\s*'([^']+)'\s*\}/g)].map((m) => m[1]!)
}

describe('landing bug-loop row', () => {
  it('reads the console stage list', () => {
    expect(consoleStageLabels()).toContain('Reported')
    expect(consoleStageLabels()).toContain('Deployed')
  })

  it('uses only console stage names, in console order', () => {
    const console = consoleStageLabels()
    const used = LOOP_STAGES.flatMap((s) => s.consoleLabels)
    for (const label of used) expect(console).toContain(label)
    const positions = used.map((l) => console.indexOf(l))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('names each stage after the console stages it stands for', () => {
    for (const stage of LOOP_STAGES) {
      for (const label of stage.consoleLabels) expect(stage.label).toContain(label)
    }
  })

  it('keeps every stage line short', () => {
    for (const stage of LOOP_STAGES) expect(stage.line.split(/\s+/).length).toBeLessThanOrEqual(11)
  })
})
