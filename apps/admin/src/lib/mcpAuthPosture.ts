/**
 * FILE: apps/admin/src/lib/mcpAuthPosture.ts
 * PURPOSE: Status line for the MCP consent page (/mcp-auth).
 *
 * The form, spinner, and error alert stay as they are. This names the state
 * the page is in and the one next step above them.
 */

export type McpAuthPostureTone = 'info' | 'brand' | 'danger' | 'warn' | 'ok'

/** Mirrors the consent page's own states. */
export type McpAuthConsentState = 'loading' | 'ready' | 'approving' | 'redirecting' | 'denied' | 'complete' | 'error'

/**
 * Why the consent page is not showing the approve form. Null while the
 * request is still open. `previously_denied` is a request denied earlier;
 * the user clicking Deny on this page is the `denied` page state instead.
 */
export type McpAuthFault =
  | null
  | 'missing_txn'
  | 'not_found'
  | 'unavailable'
  | 'expired'
  | 'previously_denied'
  | 'not_collected'
  | 'already_handled'

export interface McpAuthPostureCopy {
  tone: McpAuthPostureTone
  /** What state this sign-in is in. */
  title: string
  /** The one next step. */
  next: string
}

/** Fault for a transaction that is no longer pending. Null once the client collected its token. */
export function mcpAuthFaultForStatus(status: string, tokenDelivered: boolean | undefined): McpAuthFault {
  if (status === 'expired') return 'expired'
  if (status === 'denied') return 'previously_denied'
  if (status === 'approved' && tokenDelivered) return null
  if (status === 'approved') return 'not_collected'
  return 'already_handled'
}

export function mcpAuthPosture(input: {
  state: McpAuthConsentState
  fault: McpAuthFault
  projects: 'ok' | 'failed' | 'empty'
  approveFailed: boolean
}): McpAuthPostureCopy {
  switch (input.state) {
    case 'loading':
      return {
        tone: 'info',
        title: 'Checking this sign-in',
        next: 'Wait a moment. This page is loading the request from your MCP client.',
      }
    case 'approving':
      return {
        tone: 'info',
        title: 'Approving access',
        next: 'Stay on this page. You will return to your MCP client when the key is ready.',
      }
    case 'redirecting':
      return {
        tone: 'ok',
        title: 'Return to your MCP client',
        next: 'The connection is approved. If this tab does not move, switch back to your terminal or editor.',
      }
    case 'denied':
      return {
        tone: 'warn',
        title: 'Access denied',
        next: 'The MCP client was not connected. Close this tab, or retry the login from your client.',
      }
    case 'complete':
      return {
        tone: 'ok',
        title: 'Connection complete',
        next: 'Return to your MCP client. You can close this tab.',
      }
    case 'error':
      return postureForFault(input.fault)
    case 'ready':
      return postureForReady(input)
  }
}

function postureForFault(fault: McpAuthFault): McpAuthPostureCopy {
  switch (fault) {
    case 'missing_txn':
      return {
        tone: 'danger',
        title: 'No authorization request',
        next: 'Restart the connection from your MCP client.',
      }
    case 'not_found':
      return {
        tone: 'danger',
        title: 'Request not found',
        next: 'It may have expired. Restart the connection from your MCP client.',
      }
    case 'unavailable':
      return {
        tone: 'danger',
        title: 'Could not load this request',
        next: 'Reload this page. If it still fails, restart the connection from your MCP client.',
      }
    case 'expired':
      return {
        tone: 'warn',
        title: 'This request expired',
        next: 'Restart the connection from your MCP client. Requests last 10 minutes.',
      }
    case 'previously_denied':
      return {
        tone: 'warn',
        title: 'This connection was denied',
        next: 'Restart the login from your MCP client to try again.',
      }
    case 'not_collected':
      return {
        tone: 'warn',
        title: 'Your client has not picked this up',
        next: 'Go back one page and paste the localhost address where the terminal asks, or restart the login with only one window signing in.',
      }
    case 'already_handled':
      return {
        tone: 'warn',
        title: 'This request is closed',
        next: 'Restart the connection from your MCP client if it did not finish.',
      }
    case null:
      return {
        tone: 'danger',
        title: 'Cannot complete this connection',
        next: 'Restart it from your MCP client.',
      }
  }
}

function postureForReady(input: { projects: 'ok' | 'failed' | 'empty'; approveFailed: boolean }): McpAuthPostureCopy {
  if (input.approveFailed) {
    return {
      tone: 'danger',
      title: 'Approval did not go through',
      next: 'Try again, or deny and restart the login from your MCP client.',
    }
  }
  if (input.projects === 'failed') {
    return {
      tone: 'warn',
      title: 'Projects did not load',
      next: 'Reload this page, then approve. The request stays open for 10 minutes.',
    }
  }
  if (input.projects === 'empty') {
    return {
      tone: 'warn',
      title: 'No projects to connect',
      next: 'Create a project in the console, then retry the connection from your MCP client.',
    }
  }
  return {
    tone: 'brand',
    title: 'Approve access',
    next: 'Choose which projects this client can reach, then approve. You will be sent back to your MCP client.',
  }
}
