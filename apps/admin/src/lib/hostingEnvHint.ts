/**
 * FILE: apps/admin/src/lib/hostingEnvHint.ts
 * PURPOSE: "Where does the key go when my app is live?" for the console's
 *          install step (console audit 2026-11-11, finding 5). Installs
 *          stalled on localhost because `.env.local` never reaches the
 *          deployed site; the CLI learned to say where the values go
 *          (packages/cli/src/hosting-env-hint.ts, 2026-10-27), the console
 *          did not. This ports that guidance per host. Pure, so it is tested
 *          on its own.
 *
 * Names only for env-var hosts: the values are on the page above, never
 * repeated in a command. Lovable and Bolt have no env vars for the browser,
 * so they get the paste-ready prompt with the script tag (the SDK key in it
 * can only send reports, like any browser key).
 */

import { LOADER_CDN_URL } from './sdkSnippets'

export const HOSTS = ['lovable', 'bolt', 'vercel', 'netlify', 'expo', 'other'] as const
export type Host = (typeof HOSTS)[number]

export const HOST_LABEL: Record<Host, string> = {
  lovable: 'Lovable',
  bolt: 'Bolt',
  vercel: 'Vercel',
  netlify: 'Netlify',
  expo: 'Expo (EAS)',
  other: 'Somewhere else',
}

export interface HostGuide {
  /** One line: what to do on this host. */
  lead: string
  /** A prompt to paste into the builder (Lovable, Bolt). */
  prompt?: string
  /** The env var names to add (Vercel, Netlify, Expo, other). */
  envNames?: string[]
  /** Exact steps, in order. */
  steps: string[]
  /** Where the host keeps the setting, when it has one page for it. */
  link?: { label: string; href: string }
  /** Use the Script tag tab instead of a framework one. */
  useScriptTag?: boolean
}

/** The prompt the landing's Lovable / Bolt tab shows, with this project's values filled in. */
/** @internal Exported for tests. */
export function builderPrompt(projectId: string, apiKey: string): string {
  return `Add this script tag inside the <head> of index.html exactly as written, and change nothing else:
<script async src="${LOADER_CDN_URL}" data-project="${projectId}" data-key="${apiKey}"></script>`
}

/** Env var names for a web app: Next reads NEXT_PUBLIC_, everything else here VITE_. */
/** @internal Exported for tests. */
export function webEnvNames(bundler: 'vite' | 'next' | null | undefined): string[] {
  const prefix = bundler === 'next' ? 'NEXT_PUBLIC_' : 'VITE_'
  return [`${prefix}MUSHI_PROJECT_ID`, `${prefix}MUSHI_API_KEY`]
}

export function hostGuide(
  host: Host,
  input: { projectId: string; apiKey: string; bundler?: 'vite' | 'next' | null; mobileEnvNames?: string[]; scriptTag?: boolean },
): HostGuide {
  const names = webEnvNames(input.bundler)
  // The Script tag carries its values itself: on an ordinary web host nothing
  // goes in the host's settings, the tag just has to reach the live page.
  if (input.scriptTag && (host === 'vercel' || host === 'netlify' || host === 'other')) {
    const name = host === 'other' ? 'your host' : HOST_LABEL[host]
    return {
      lead: `With the Script tag nothing goes in ${name}'s settings: the tag above already holds your project and key.`,
      steps: [
        "Paste it inside the <head> of your site's main page (index.html; in a Next.js app, the root layout).",
        `Deploy again on ${name}, then open your live site: a report button appears.`,
        "Using the React or Vue tab instead? Then the two values go in your host's environment variables; pick that tab to see their names.",
      ],
    }
  }
  const first = names[0]!
  const last = names[names.length - 1]!
  const redeploy = 'Then redeploy: these values only reach the live site on the next build.'
  switch (host) {
    case 'lovable':
    case 'bolt': {
      const name = HOST_LABEL[host]
      return {
        lead: `${name} has no settings for keys, so you paste one line instead. Copy this and send it to ${name} in the chat:`,
        prompt: builderPrompt(input.projectId, input.apiKey),
        steps: [`Publish the app in ${name}.`, 'Open your live app: a report button appears. Tap it and send yourself a first report.'],
        useScriptTag: true,
      }
    }
    case 'vercel':
      return {
        lead: 'Add these two values to your Vercel project. The values are in the code above.',
        envNames: names,
        steps: [
          'Vercel: your project → Settings → Environment Variables. Add each name with its value, for Production.',
          `Or in a terminal: vercel env add ${first} production (it asks for the value).`,
          redeploy,
        ],
        link: { label: 'Open Vercel', href: 'https://vercel.com/dashboard' },
      }
    case 'netlify':
      return {
        lead: 'Add these two values to your Netlify site. The values are in the code above.',
        envNames: names,
        steps: [
          'Netlify: your site → Project configuration → Environment variables. Add each name with its value.',
          `Or in a terminal: netlify env:set ${last} "<value>".`,
          redeploy,
        ],
        link: { label: 'Open Netlify', href: 'https://app.netlify.com' },
      }
    case 'expo': {
      const mobile = input.mobileEnvNames?.length ? input.mobileEnvNames : ['EXPO_PUBLIC_MUSHI_PROJECT_ID', 'EXPO_PUBLIC_MUSHI_API_KEY']
      return {
        lead: 'An app store build reads these values when it is built, so EAS needs them too.',
        envNames: mobile,
        steps: [
          `Add each one: eas env:create --name ${mobile[0]} --value "<value>" --environment production`,
          'Then build again (eas build). A build made before this has no report button.',
        ],
      }
    }
    default:
      return {
        lead: 'Add these two values wherever your host keeps environment variables. The values are in the code above.',
        envNames: names,
        steps: [redeploy, 'No environment variables on your host? Use the Script tag tab: it works on any site.'],
      }
  }
}
