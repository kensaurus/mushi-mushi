/**
 * Plain-language Explore / Codebase Atlas tab guide.
 */

export type ExploreGuideTabId =
  | 'overview'
  | 'ask'
  | 'tour'
  | 'domains'
  | 'knowledge'
  | 'graph'
  | 'layers'
  | 'search'
  | 'index'

export interface ExploreTabDefinition {
  id: ExploreGuideTabId
  label: string
  plain: string
  whenToUse: string
}

export const EXPLORE_ATLAS_TABS: ExploreTabDefinition[] = [
  {
    id: 'overview',
    label: 'Summary',
    plain: 'Index posture — how many files are indexed and whether search is ready.',
    whenToUse: 'Start here after connecting a repo.',
  },
  {
    id: 'ask',
    label: 'Ask',
    plain: 'Chat with your codebase — answers cite file:line from the index.',
    whenToUse: '“Where is auth handled?” or “What calls this RPC?”',
  },
  {
    id: 'tour',
    label: 'Tour',
    plain: 'Guided walkthrough ordered by architectural dependencies.',
    whenToUse: 'Onboarding a teammate or re-learning a repo you have not touched in months.',
  },
  {
    id: 'domains',
    label: 'Domains',
    plain: 'Business domains and user flows mapped to source files.',
    whenToUse: 'Tracing a feature from UI button to database table.',
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    plain: 'Wiki and docs merged into Ask — operator-authored context.',
    whenToUse: 'Adding runbooks or ADRs the indexer cannot infer from code alone.',
  },
  {
    id: 'graph',
    label: 'Graph',
    plain: 'Visual map of files and imports — nodes coloured by layer.',
    whenToUse: 'Spotting god-files, circular deps, or where a change will ripple.',
  },
  {
    id: 'layers',
    label: 'Layers',
    plain: 'Sankey view of UI → lib → backend → test file distribution.',
    whenToUse: 'Checking whether new code landed in the right architectural lane.',
  },
  {
    id: 'search',
    label: 'Search',
    plain: 'Semantic search over embeddings — plain-English queries.',
    whenToUse: 'Finding symbols when you know what it does but not what it is named.',
  },
  {
    id: 'index',
    label: 'Index',
    plain: 'Indexer debug — repo URL, webhook, last error, embedding coverage.',
    whenToUse: 'Index is empty, stale, or failing — fix wiring here first.',
  },
]

export const EXPLORE_EXPLAINER_SUMMARY =
  'Explore indexes your connected GitHub repo so Ask, Search, and Graph answers are grounded in real source — not guesses. Enable indexing in Settings, wait ~90s, then try Ask or Search.'

export function exploreTabDefinition(tab: string): ExploreTabDefinition | undefined {
  return EXPLORE_ATLAS_TABS.find((t) => t.id === tab)
}
