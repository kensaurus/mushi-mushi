/**
 * FILE: apps/admin/src/lib/integrationOAuthReturn.ts
 * PURPOSE: Turn the query params an install / OAuth round trip lands on
 *          /integrations/config with into one plain-English toast, and say
 *          which params to strip so a refresh does not repeat it.
 *
 * Sources: github-app-callback (github_connected | github_pending_approval |
 * github_error), linear-oauth-callback (connected=linear | linear_error) and
 * the api Slack callback (slack_connected | slack_error). Slack's result used
 * to be ignored, so a cancelled or failed install came back with no message.
 */

export interface OAuthReturnToast {
  tone: 'success' | 'error'
  title: string
  description: string
}

export interface OAuthReturn {
  toast: OAuthReturnToast
  /** Query keys to delete from the URL once the toast is shown. */
  consumedKeys: string[]
}

/** Slack OAuth `slack_error` reasons → what happened and what to do. */
function slackErrorText(reason: string): string {
  const r = reason.replace(/^Error:\s*/i, '').trim()
  switch (r) {
    case 'access_denied':
      return 'The Slack install was cancelled, so nothing changed. Click "Add to Slack" again and choose Allow.'
    case 'invalid_state':
      return 'The install link expired or was opened in another tab. Click "Add to Slack" again from this page.'
    case 'missing_params':
      return 'Slack sent us back without an install code. Click "Add to Slack" again.'
    case 'server_misconfigured':
      return "Slack sign-in isn't set up on this Mushi server yet. Ask whoever runs it to add the Slack app credentials, or paste an incoming webhook URL below instead."
    case 'token_not_saved':
      return 'Slack approved the install, but Mushi could not save the bot token. Click "Add to Slack" again; if it keeps failing, paste an incoming webhook URL below instead.'
    case 'invalid_code':
    case 'code_already_used':
    case 'bad_redirect_uri':
      return 'Slack refused the install code. Click "Add to Slack" again and finish the install in one go.'
    default:
      return 'Slack did not finish the install. Click "Add to Slack" again; if it keeps failing, paste an incoming webhook URL below instead.'
  }
}

function githubErrorText(reason: string): string {
  if (reason === 'missing_installation_id') return 'GitHub did not return an installation. Retry the install from this page.'
  if (reason === 'link_failed') return 'The installation could not be saved to this project. Retry the install from this page.'
  return 'GitHub did not finish the install. Retry it from this page.'
}

function linearErrorText(reason: string): string {
  if (/denied|cancel/i.test(reason)) {
    return 'The Linear install was cancelled, so nothing changed. Click "Connect workspace" again and approve it.'
  }
  if (/state|expired/i.test(reason)) return 'The connect link expired. Click "Connect workspace" again from this page.'
  if (/misconfiguration|credentials missing/i.test(reason)) {
    return "Linear sign-in isn't set up on this Mushi server yet. Use a Linear API key below instead."
  }
  if (/store|save/i.test(reason)) {
    return 'Linear approved the connection, but Mushi could not save it. Click "Connect workspace" again.'
  }
  return 'Linear did not finish connecting. Click "Connect workspace" again, or use a Linear API key below.'
}

export function readIntegrationOAuthReturn(search: string): OAuthReturn | null {
  const params = new URLSearchParams(search)

  if (params.get('github_connected')) {
    return {
      toast: { tone: 'success', title: 'GitHub App connected', description: 'Installation linked to this project.' },
      consumedKeys: ['github_connected', 'installation_id'],
    }
  }
  if (params.get('github_pending_approval')) {
    return {
      toast: {
        tone: 'success',
        title: 'GitHub install requested',
        description: 'An org admin must approve the installation on GitHub. It links automatically once approved.',
      },
      consumedKeys: ['github_pending_approval', 'installation_id'],
    }
  }
  const githubError = params.get('github_error')
  if (githubError) {
    return {
      toast: { tone: 'error', title: 'GitHub App install failed', description: githubErrorText(githubError) },
      consumedKeys: ['github_error', 'installation_id'],
    }
  }

  if (params.get('connected') === 'linear') {
    return {
      toast: {
        tone: 'success',
        title: 'Linear workspace connected',
        description: 'Reports will now create Linear issues and sync status.',
      },
      consumedKeys: ['connected'],
    }
  }
  const linearError = params.get('linear_error')
  if (linearError) {
    return {
      toast: {
        tone: 'error',
        title: 'Linear connect failed',
        description: linearErrorText(linearError),
      },
      consumedKeys: ['linear_error'],
    }
  }

  if (params.get('slack_connected')) {
    return {
      toast: {
        tone: 'success',
        title: 'Slack connected',
        description: 'Pick the channel Mushi should post to, then send a test.',
      },
      consumedKeys: ['slack_connected'],
    }
  }
  const slackError = params.get('slack_error')
  if (slackError !== null) {
    return {
      toast: { tone: 'error', title: 'Slack install failed', description: slackErrorText(slackError) },
      consumedKeys: ['slack_error'],
    }
  }

  return null
}
