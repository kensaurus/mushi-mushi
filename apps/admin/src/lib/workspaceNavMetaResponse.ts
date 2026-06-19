/**
 * Client types for GET /v1/admin/workspace/nav-meta
 */

import type { NavStatSlices } from './extendedNavMeta'

export interface WorkspaceNavMetaResponse {
  generatedAt: string
  slices: NavStatSlices
  projects: {
    projectCount: number
    neverIngestedCount: number
    staleKeyCount: number
  } | null
  members: {
    memberCount: number | null
    pendingInvites: number
    inactiveCount: number
    atSeatCap: boolean
    expiringSoonInvites: number
  } | null
}

/** Coerce partial API slices into the strict NavStatSlices shape. */
export function normalizeNavSlices(raw: Partial<NavStatSlices> | undefined): NavStatSlices {
  const s = raw ?? {}
  return {
    contentQuality: (s.contentQuality as NavStatSlices['contentQuality']) ?? null,
    codeHealth: (s.codeHealth as NavStatSlices['codeHealth']) ?? null,
    qaCoverage: (s.qaCoverage as NavStatSlices['qaCoverage']) ?? null,
    experiments: (s.experiments as NavStatSlices['experiments']) ?? null,
    lessons: (s.lessons as NavStatSlices['lessons']) ?? null,
    drift: (s.drift as NavStatSlices['drift']) ?? null,
    anomalies: (s.anomalies as NavStatSlices['anomalies']) ?? null,
    iterate: (s.iterate as NavStatSlices['iterate']) ?? null,
    onboarding: (s.onboarding as NavStatSlices['onboarding']) ?? null,
    rewards: (s.rewards as NavStatSlices['rewards']) ?? null,
    billing: (s.billing as NavStatSlices['billing']) ?? null,
    audit: (s.audit as NavStatSlices['audit']) ?? null,
    intelligence: (s.intelligence as NavStatSlices['intelligence']) ?? null,
    releases: (s.releases as NavStatSlices['releases']) ?? null,
    fullstackAudit: (s.fullstackAudit as NavStatSlices['fullstackAudit']) ?? null,
    dashboard: (s.dashboard as NavStatSlices['dashboard']) ?? null,
    explore: (s.explore as NavStatSlices['explore']) ?? null,
    promptLab: (s.promptLab as NavStatSlices['promptLab']) ?? null,
    research: (s.research as NavStatSlices['research']) ?? null,
    graph: (s.graph as NavStatSlices['graph']) ?? null,
    inventory: (s.inventory as NavStatSlices['inventory']) ?? null,
    health: (s.health as NavStatSlices['health']) ?? null,
    fixes: (s.fixes as NavStatSlices['fixes']) ?? null,
    repo: (s.repo as NavStatSlices['repo']) ?? null,
    mcp: (s.mcp as NavStatSlices['mcp']) ?? null,
    marketplace: (s.marketplace as NavStatSlices['marketplace']) ?? null,
    settings: (s.settings as NavStatSlices['settings']) ?? null,
    costs: (s.costs as NavStatSlices['costs']) ?? null,
    sso: (s.sso as NavStatSlices['sso']) ?? null,
    compliance: (s.compliance as NavStatSlices['compliance']) ?? null,
    storage: (s.storage as NavStatSlices['storage']) ?? null,
    query: (s.query as NavStatSlices['query']) ?? null,
    integrations: (s.integrations as NavStatSlices['integrations']) ?? null,
    featureBoard: (s.featureBoard as NavStatSlices['featureBoard']) ?? null,
    skills: (s.skills as NavStatSlices['skills']) ?? null,
  }
}
