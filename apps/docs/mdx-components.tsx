import { useMDXComponents as getDocsComponents } from 'nextra-theme-docs'
import { Steps } from 'nextra/components'
import { Playground } from './components/Playground'
import { MigrationHub } from './components/MigrationHub'
import { MigrationChecklist } from './components/MigrationChecklist'
import { EffortBadge, RiskBadge } from './components/MigrationBadges'
import { EditorialHero } from './components/EditorialHero'
import { Pillars } from './components/Pillars'
import { ComparisonTable } from './components/ComparisonTable'
import { QuickstartGrid } from './components/QuickstartGrid'
import { InventoryModelDiagram, GatesStrip } from './components/InventoryDiagram'
import { SpecTracePipeline } from './components/SpecTracePipeline'
import { JudgeLoops, JudgeScoreBreakdown, FineTunePipeline } from './components/JudgeDiagram'
import { MultiRepoFlowDiagram } from './components/MultiRepoFlow'

export const useMDXComponents = (components?: Record<string, unknown>) => ({
  ...getDocsComponents(),
  Steps,
  Playground,
  MigrationHub,
  MigrationChecklist,
  EffortBadge,
  RiskBadge,
  EditorialHero,
  Pillars,
  ComparisonTable,
  QuickstartGrid,
  InventoryModelDiagram,
  GatesStrip,
  SpecTracePipeline,
  JudgeLoops,
  JudgeScoreBreakdown,
  FineTunePipeline,
  MultiRepoFlowDiagram,
  ...(components ?? {}),
})
