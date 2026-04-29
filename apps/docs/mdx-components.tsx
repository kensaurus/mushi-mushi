import { useMDXComponents as getDocsComponents } from 'nextra-theme-docs'
import { Playground } from './components/Playground'
import { MigrationHub } from './components/MigrationHub'
import { MigrationChecklist } from './components/MigrationChecklist'
import { EffortBadge, RiskBadge } from './components/MigrationBadges'

export const useMDXComponents = (components?: Record<string, unknown>) => ({
  ...getDocsComponents(),
  Playground,
  MigrationHub,
  MigrationChecklist,
  EffortBadge,
  RiskBadge,
  ...(components ?? {}),
})
