import { MCP_CLIENTS } from '@mushi-mushi/mcp/clients'

export const CURSOR_CLIENT = MCP_CLIENTS.find((c) => c.id === 'cursor')!
export const VSCODE_CLIENT = MCP_CLIENTS.find((c) => c.id === 'vscode')!
