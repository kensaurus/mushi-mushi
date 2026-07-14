/**
 * FILE: apps/admin/src/lib/buildNav.ts
 * PURPOSE: Build sidebar NavSection[] from navRegistry + icon components.
 */

import type { ComponentType } from 'react'
import type { FeatureFlag } from './useEntitlements'
import {
  CHECK_SUB_GROUPS,
  NAV_REGISTRY,
  NAV_SECTION_META,
  type CheckSubGroupId,
  type NavIconKey,
  type NavRegistryEntry,
  type NavSectionId,
} from './navRegistry'
import {
  IconDashboard,
  IconReports,
  IconStory,
  IconGraph,
  IconJudge,
  IconQuery,
  IconFixes,
  IconProjects,
  IconIntegrations,
  IconQueue,
  IconSSO,
  IconAudit,
  IconFineTuning,
  IconSettings,
  IconHealth,
  IconShield,
  IconBell,
  IconIntelligence,
  IconBilling,
  IconCompliance,
  IconStorage,
  IconMarketplace,
  IconGlobe,
  IconGit,
  IconLessons,
  IconDrift,
  IconAnomalies,
  IconReleases,
  IconExperiments,
  IconIterate,
  IconRewards,
  IconMcp,
  IconMembers,
  IconQaCoverage,
  IconInbox,
  IconGauge,
  IconUser,
  IconExplore,
  IconChat,
  IconSkills,
  IconBolt,
  IconLink,
  IconFlag,
  IconEye,
  IconShieldCheck,
  IconCost,
  IconTerminal,
  IconKey,
  IconExternalLink,
  IconCatalog,
  IconRefresh,
  IconNetwork,
} from '../components/icons'

export interface BuiltNavItem {
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  quickstartLabel?: string
  beginner?: boolean
  checkBeginnerCore?: boolean
  superAdmin?: boolean
  requiresFeature?: FeatureFlag
  requiresAdvancedMode?: boolean
  checkSubGroup?: CheckSubGroupId
}

export interface BuiltNavSection {
  id: NavSectionId
  title: string
  stage?: 'P' | 'D' | 'C' | 'A'
  hint?: string
  defaultCollapsed?: boolean
  items: BuiltNavItem[]
}

const ICON_MAP: Record<NavIconKey, ComponentType<{ className?: string }>> = {
  bolt: IconBolt,
  connect: IconLink,
  dashboard: IconDashboard,
  inbox: IconInbox,
  'feature-board': IconFlag,
  chat: IconChat,
  reports: IconReports,
  content: IconEye,
  'qa-coverage': IconQaCoverage,
  story: IconStory,
  graph: IconGraph,
  explore: IconExplore,
  queue: IconQueue,
  shield: IconShield,
  'shield-check': IconShieldCheck,
  fixes: IconFixes,
  git: IconGit,
  'fine-tuning': IconFineTuning,
  judge: IconJudge,
  health: IconHealth,
  audit: IconAudit,
  gauge: IconGauge,
  cost: IconCost,
  lessons: IconLessons,
  drift: IconDrift,
  experiments: IconExperiments,
  anomalies: IconAnomalies,
  releases: IconReleases,
  intelligence: IconIntelligence,
  globe: IconGlobe,
  'external-link': IconExternalLink,
  iterate: IconIterate,
  skills: IconSkills,
  catalog: IconCatalog,
  pipeline: IconNetwork,
  source: IconRefresh,
  integrations: IconIntegrations,
  mcp: IconMcp,
  terminal: IconTerminal,
  key: IconKey,
  marketplace: IconMarketplace,
  bell: IconBell,
  projects: IconProjects,
  members: IconMembers,
  settings: IconSettings,
  rewards: IconRewards,
  billing: IconBilling,
  sso: IconSSO,
  compliance: IconCompliance,
  storage: IconStorage,
  query: IconQuery,
  user: IconUser,
  activity: IconHealth,
  overview: IconGauge,
}

function entryToNavItem(entry: NavRegistryEntry): BuiltNavItem {
  return {
    label: entry.label,
    path: entry.path,
    icon: ICON_MAP[entry.iconKey],
    quickstartLabel: entry.quickstartLabel,
    beginner: entry.beginner,
    checkBeginnerCore: entry.checkBeginnerCore,
    superAdmin: entry.superAdmin,
    requiresFeature: entry.requiresFeature,
    requiresAdvancedMode: entry.requiresAdvancedMode,
    checkSubGroup: entry.checkSubGroup,
  }
}

const SECTION_ORDER: NavSectionId[] = ['start', 'plan', 'do', 'check', 'act', 'workspace']

/** Full sidebar tree — source of truth lives in navRegistry.ts */
export function buildOperatorNav(): BuiltNavSection[] {
  return SECTION_ORDER.map((sectionId) => {
    const meta = NAV_SECTION_META[sectionId]
    const items = NAV_REGISTRY.filter(
      (e) => e.sectionId === sectionId && e.inSidebar !== false,
    ).map(entryToNavItem)
    return {
      id: sectionId,
      title: meta.title,
      stage: meta.stage,
      hint: meta.hint,
      defaultCollapsed: meta.defaultCollapsed,
      items,
    }
  })
}

export { CHECK_SUB_GROUPS }
