// SPDX-License-Identifier: MIT
/**
 * @mushi-mushi/ux — library entry. The `mushi-ux` bin (cli.ts) is the main
 * way in; these exports let other tools drive the same steps: map an app,
 * run the loop, judge a run, serve its dashboard.
 */

export { AGENTS, getAgent, quoteArg, type AgentAdapter, type AgentName, type AgentRunOptions } from './agents.js'
export { cursorCloudAdapter, cursorModel, httpsRepoUrl, type CursorCloudDeps } from './cursor-cloud.js'
export { openSession, captureSurface, settle, type BrowserSession, type Capture } from './capture.js'
export { startDashboard, safeShotPath, type Dashboard } from './dashboard.js'
export { discover, normalizeLink, surfaceKey, type DiscoverOptions } from './discover.js'
export { installGuard, isRequestAllowed, isDestructiveLabel, type AllowRule } from './guard.js'
export { pixelDiff, dHash, hammingHex, cropTop } from './image.js'
export {
  judgeSurface,
  unshuffle,
  DEFAULT_JUDGE_MODEL,
  type JudgeClaim,
  type JudgeOptions,
  type JudgeVerdict,
} from './judge.js'
export { startLoop, type LoopEvent, type LoopHandle, type LoopOptions } from './loop.js'
export { buildPacket, findDesignFiles, POINTER_PROMPT, type PacketInput } from './packet.js'
export { runProbes, probePenalty } from './probes.js'
export { routesFromSource, sitemapPaths, reactRouterPaths, nextRoutePath } from './routes.js'
export {
  loadState,
  saveState,
  newRunId,
  runDir,
  type RunState,
  type SurfaceState,
  type SurfaceStatus,
  type IterationRecord,
} from './state.js'
export { startSync, syncConfigFromEnv, toSnapshot, type SyncConfig, type SyncHandle } from './sync.js'
export { decide, type Verdict, type VerdictInput } from './verdict.js'
export * from './types.js'
