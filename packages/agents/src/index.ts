export { FixOrchestrator } from './orchestrator.js'
export type { OrchestratorConfig } from './orchestrator.js'

// D7: multi-repo coordination
export { MultiRepoFixOrchestrator } from './orchestrator-multi.js'

export { ClaudeCodeAgent } from './adapters/claude-code.js'
export { CodexAgent } from './adapters/codex.js'
export { GenericMCPAgent } from './adapters/generic-mcp.js'
export { RestFixWorkerAgent } from './adapters/rest-fix-worker.js'
export { McpFixAgent, type McpClientOptions, type McpTransport } from './adapters/mcp.js'

export { checkFileScope, checkCircuitBreaker } from './scope.js'
export {
  checkForSecrets,
  buildReviewPrompt,
  parseReviewResponse,
  renderSpecContext,
  validateAgainstSpec,
  type SpecValidationResult,
} from './review.js'
export { createPR, buildPRBody } from './github.js'

export type {
  FixContext,
  FixResult,
  FixAgent,
  ScopeCheck,
  ReviewResult,
  CodeFile,
  ExpectedOutcome,
  ProjectRepo,
  RepoRole,
  CoordinationTask,
  CoordinationPlan,
  CoordinatedFixResult,
} from './types.js'

// V5.3 §2.10 (M6): managed sandbox provider abstraction
export {
  resolveSandboxProvider,
  registerSandboxProvider,
  unregisterSandboxProvider,
  KNOWN_SANDBOX_PROVIDERS,
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
  KnownSandboxProvider,
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

// 2026-05-09 spec-traceability audit: publish JSON Schemas for the
// FixContext / FixResult / SandboxProvider contracts so non-TS
// orchestrators (Python LangGraph, Go agents, A2A skill cards) can
// implement the contract without typing-by-hand. Mirrors the @mushi-mushi/inventory-schema
// hand-authored / Zod parity pattern.
export {
  FIX_CONTEXT_JSON_SCHEMA,
  FIX_RESULT_JSON_SCHEMA,
  SANDBOX_PROVIDER_JSON_SCHEMA,
  EXPECTED_OUTCOME_JSON_SCHEMA,
  AGENT_JSON_SCHEMAS,
} from './schemas.js'
