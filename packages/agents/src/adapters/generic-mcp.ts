/**
 * @deprecated Renamed to RestFixWorkerAgent (V5.3 §2.10, M7) — the previous
 *             name was misleading because it spoke plain REST, not MCP.
 *             Use {@link RestFixWorkerAgent} for HTTP/JSON workers, or
 *             {@link McpFixAgent} for true Model Context Protocol clients.
 *             This re-export will be removed in v1.0.
 */
import { RestFixWorkerAgent } from './rest-fix-worker.js'

export class GenericMCPAgent extends RestFixWorkerAgent {
  override name = 'generic_mcp'
}
