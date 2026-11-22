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
 * Env-var hosts get the names and, once the page holds a key, the values as
 * a block to copy (re-audit 2026-11-11: "The values are in the code above"
 * pointed at YOUR_SDK_KEY). The names follow the snippet above: Next.js reads
 * NEXT_PUBLIC_, Vite reads VITE_, and an unknown React setup is asked for,
 * never guessed. A snippet that holds its values inline needs nothing in the
 * host's settings. Lovable and Bolt have no env vars for the browser, so they
 * get the paste-ready prompt with the script tag (the SDK key in it can only
 * send reports, like any browser key).
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
  /** `NAME=value` lines to copy, only when the page holds the real key. */
  envBlock?: string
  /** Exact steps, in order. */
  steps: string[]
  /** Where the host keeps the setting, when it has one page for it. */
  link?: { label: string; href: string }
  /** Use the Script tag tab instead of a framework one. */
  useScriptTag?: boolean
  /** The React setup (Next.js or Vite) must be picked before names can be given. */
  askSetup?: boolean
}

/** Shown in a prompt until a key is made; it cannot pass for a key. */
const KEY_PLACEHOLDER = 'YOUR_SDK_KEY'
const MAKE_KEY =
  'Press "Make a key and fill it in" above first: a key is shown only once, and its value then appears here.'

/** The prompt the landing's Lovable / Bolt tab shows, with this project's values filled in. */
/** @internal Exported for tests. */
export function builderPrompt(projectId: string, apiKey: string): string {
  return `Add this script tag inside the <head> of index.html exactly as written, and change nothing else:
<script async src="${LOADER_CDN_URL}" data-project="${projectId}" data-key="${apiKey}"></script>`
}

/** Env var names for a web app whose snippet reads them: NEXT_PUBLIC_ on Next.js, VITE_ on Vite. */
export function webEnvNames(bundler: 'vite' | 'next'): string[] {
  const prefix = bundler === 'next' ? 'NEXT_PUBLIC_' : 'VITE_'
  return [`${prefix}MUSHI_PROJECT_ID`, `${prefix}MUSHI_API_KEY`]
}

function envBlock(names: string[], projectId: string, apiKey: string | null): string | undefined {
  if (!apiKey) return undefined
  return [`${names[0]}=${projectId}`, `${names[1]}=${apiKey}`].join('\n')
}

export interface HostGuideInput {
  projectId: string
  /** The full key when the page holds it; null until one is made. */
  apiKey: string | null
  /** What the snippet above reads its values from; null when it holds them inline. */
  bundler?: 'vite' | 'next' | null
  /** React tab with no setup picked: ask instead of guessing a prefix. */
  askSetup?: boolean
  mobileEnvNames?: string[]
  scriptTag?: boolean
}

export function hostGuide(host: Host, input: HostGuideInput): HostGuide {
  const hasKey = Boolean(input.apiKey)
  const values = hasKey ? 'Copy them from here:' : MAKE_KEY

  if (host === 'lovable' || host === 'bolt') {
    const name = HOST_LABEL[host]
    return {
      lead: `${name} has no settings for keys, so you paste one line instead. ${
        hasKey ? `Copy this and send it to ${name} in the chat:` : MAKE_KEY
      }`,
      prompt: builderPrompt(input.projectId, input.apiKey ?? KEY_PLACEHOLDER),
      steps: [`Publish the app in ${name}.`, 'Open your live app: a report button appears. Tap it and send yourself a first report.'],
      useScriptTag: true,
    }
  }

  if (host === 'expo') {
    const mobile = input.mobileEnvNames?.length ? input.mobileEnvNames : ['EXPO_PUBLIC_MUSHI_PROJECT_ID', 'EXPO_PUBLIC_MUSHI_API_KEY']
    return {
      lead: `An app store build reads these values when it is built, so EAS needs them too. ${values}`,
      envNames: mobile,
      envBlock: envBlock(mobile, input.projectId, input.apiKey),
      steps: [
        `Add each one: eas env:create --name ${mobile[0]} --value "<value>" --environment production`,
        'Then build again (eas build). A build made before this has no report button.',
      ],
    }
  }

  const hostName = host === 'other' ? 'your host' : HOST_LABEL[host]
  // The Script tag carries its values itself: on an ordinary web host nothing
  // goes in the host's settings, the tag just has to reach the live page.
  if (input.scriptTag) {
    return {
      lead: `With the Script tag nothing goes in ${hostName}'s settings: the tag above already holds your project and key.`,
      steps: [
        "Paste it inside the <head> of your site's main page (index.html; in a Next.js app, the root layout).",
        `Deploy again on ${hostName}, then open your live site: a report button appears.`,
        'Using the React or Vue tab instead? Pick that tab to see where its two values go.',
      ],
    }
  }
  // Next.js and Vite name the same two values differently. Unknown is a
  // question, never a silent VITE_ (re-audit 2026-11-11: a Next.js app on
  // Vercel was handed VITE_ names its build never reads).
  if (input.askSetup) {
    return {
      lead: 'Is your React app built with Next.js or Vite? Pick it under "Which React setup?" above. The two name these values differently, so the exact names appear here once you pick.',
      steps: [],
      askSetup: true,
    }
  }
  if (!input.bundler) {
    return {
      lead: `The code above already holds your project and key, so nothing goes in ${hostName}'s settings.`,
      steps: [
        `Commit the code and deploy again on ${hostName}, then open your live site: a report button appears.`,
        'Rather keep the key out of your code? Use the React tab and pick Next.js or Vite: the code then reads both values from environment variables.',
      ],
    }
  }

  const names = webEnvNames(input.bundler)
  const block = envBlock(names, input.projectId, input.apiKey)
  const redeploy = 'Then redeploy: these values only reach the live site on the next build.'
  if (host === 'vercel') {
    return {
      lead: `Add these two values to your Vercel project. ${values}`,
      envNames: names,
      envBlock: block,
      steps: [
        'Vercel: your project → Settings → Environment Variables. Add each name with its value, for Production.',
        `Or in a terminal: vercel env add ${names[0]} production (it asks for the value).`,
        redeploy,
      ],
      link: { label: 'Open Vercel', href: 'https://vercel.com/dashboard' },
    }
  }
  if (host === 'netlify') {
    return {
      lead: `Add these two values to your Netlify site. ${values}`,
      envNames: names,
      envBlock: block,
      steps: [
        'Netlify: your site → Project configuration → Environment variables. Add each name with its value.',
        `Or in a terminal: netlify env:set ${names[1]} "<value>".`,
        redeploy,
      ],
      link: { label: 'Open Netlify', href: 'https://app.netlify.com' },
    }
  }
  return {
    lead: `Add these two values wherever your host keeps environment variables. ${values}`,
    envNames: names,
    envBlock: block,
    steps: [redeploy, 'No environment variables on your host? Use the Script tag tab: it works on any site.'],
  }
}
