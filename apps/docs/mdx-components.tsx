import { useMDXComponents as getDocsComponents } from 'nextra-theme-docs'
import { Playground } from './components/Playground'
import { MigrationHub } from './components/MigrationHub'
import { MigrationChecklist } from './components/MigrationChecklist'
import { EffortBadge, RiskBadge } from './components/MigrationBadges'
import { EditorialHero } from './components/EditorialHero'
import { Pillars } from './components/Pillars'
import { ComparisonTable } from './components/ComparisonTable'

export const useMDXComponents = (components?: Record<string, unknown>) => ({
  ...getDocsComponents(),
  Playground,
  MigrationHub,
  MigrationChecklist,
  EffortBadge,
  RiskBadge,
  EditorialHero,
  Pillars,
  ComparisonTable,
  ...(components ?? {}),
})
