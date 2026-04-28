/**
 * @mushi-mushi/marketing-ui
 *
 * Shared editorial marketing components used by apps/cloud (Next.js) and
 * apps/admin (Vite + react-router). Components are framework-agnostic and
 * read their `Link` component + URL helpers from <MarketingProvider>.
 *
 * Setup:
 *   1. import '@mushi-mushi/marketing-ui/styles.css' in the host app's CSS
 *   2. wrap the marketing surface in <MarketingProvider value={{ Link, urls }}>
 *   3. render <Hero />, <MushiCanvas />, <ClosingCta />, <MarketingFooter />
 *
 * See the package README for a worked example.
 */

export { MarketingProvider, useMarketing } from './context'
export type {
  MarketingLink,
  MarketingLinkProps,
  MarketingTheme,
  MarketingUrls,
} from './context'

export { Hero } from './Hero'
export { ClosingCta } from './ClosingCta'
export { MarketingFooter } from './MarketingFooter'
export { StatusPill } from './StatusPill'
export type { StatusPillProps } from './StatusPill'

export { MushiCanvas } from './canvas/MushiCanvas'
export {
  reportSample,
  stages,
  stageEdges,
  logEvents,
} from './canvas/data'
export type {
  MushiStage,
  MushiStageId,
  MushiEdge,
  ReportSample,
  StageHandleId,
  StageNodeData,
  StageTone,
  PaperEdgeData,
} from './canvas/data'
