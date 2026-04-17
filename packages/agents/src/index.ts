export { FixOrchestrator } from './orchestrator.js'
export type { OrchestratorConfig } from './orchestrator.js'

// Wave D D7: multi-repo coordination
export { MultiRepoFixOrchestrator } from './orchestrator-multi.js'

export { ClaudeCodeAgent } from './adapters/claude-code.js'
export { CodexAgent } from './adapters/codex.js'
export { GenericMCPAgent } from './adapters/generic-mcp.js'
export { RestFixWorkerAgent } from './adapters/rest-fix-worker.js'
export { McpFixAgent, type McpClientOptions, type McpTransport } from './adapters/mcp.js'

export { checkFileScope, checkCircuitBreaker } from './scope.js'
export { checkForSecrets, buildReviewPrompt, parseReviewResponse } from './review.js'
export { createPR, buildPRBody } from './github.js'

export type {
  FixContext,
  FixResult,
  FixAgent,
  ScopeCheck,
  ReviewResult,
  CodeFile,
  ProjectRepo,
  RepoRole,
  CoordinationTask,
  CoordinationPlan,
  CoordinatedFixResult,
} from './types.js'

// V5.3 §2.10 (M6): managed sandbox provider abstraction
export {
  resolveSandboxProvider,
  buildSandboxConfig,
  LocalNoopSandboxProvider,
  createE2BProvider,
  SandboxError,
} from './sandbox/index.js'
export type {
  Sandbox,
  SandboxConfig,
  SandboxProvider,
  SandboxProviderName,
  SandboxAuditEvent,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileWrite,
  SandboxFsPolicy,
  SandboxNetworkPolicy,
  SandboxResourceLimits,
  BuildSandboxConfigOptions,
} from './sandbox/index.js'
export { SandboxAuditWriter, insertSandboxRun, updateSandboxRun } from './sandbox/persistence.js'
