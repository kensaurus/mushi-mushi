/**
 * FILE: apps/admin/src/lib/fieldGuide.ts
 * PURPOSE: The field guide's voice in the console: every line Kenji says, and
 *          which pose he takes, keyed by journey state. One file so the voice
 *          stays consistent and the copy gates (`check:console-voice`, the
 *          length test in fieldGuide.test.ts) read all of it in one place.
 *
 *          Kenji is a calm, curious bug naturalist. He explains plainly what
 *          happened and what to do next, in the first person, in one short
 *          line (90 characters at most, so it fits a phone). He never blames
 *          the developer, never hypes, and only points at buttons that are on
 *          the screen. Mushi-chan, the ladybug on his shoulder, is the product
 *          mascot; she never holds tools and is never sad (docs/mascot/README.md).
 *
 *          Placement rule: at most one Kenji per screen. Callers pick the
 *          single owner of a route; see docs/mascot/README.md.
 */

import type { FirstDiagnosisState } from './firstDiagnosis'
import type { LoginFormMode, LoginTrack } from './loginSubmit'
import type { OnboardingTabId } from '../components/onboarding/types'
import type { McpStats } from '../components/mcp/types'

/** The poses shipped in `apps/admin/src/assets/mascot/`. */
export type MascotPose =
  | 'wave'
  | 'point'
  | 'magnify'
  | 'found'
  | 'think'
  | 'allclear'
  | 'oops'
  | 'laptop'

/** A pose and one line of at most 90 characters (fieldGuide.test.ts checks). */
export interface GuideLine {
  pose: MascotPose
  line: string
}

// ─── Sign in ────────────────────────────────────────────────────────────────

export function loginGuide(mode: LoginFormMode, track: LoginTrack): GuideLine {
  if (track === 'tester') {
    return { pose: 'wave', line: "Hi, I'm Kenji. Sign in, pick an app, and earn points for the bugs you find." }
  }
  switch (mode) {
    case 'signup':
      return { pose: 'wave', line: "Hi, I'm Kenji. Make an account and I'll walk you through setup, step by step." }
    case 'forgot':
      return { pose: 'wave', line: "Happens to everyone. Enter your email and I'll send a link to reset it." }
    case 'magic':
      return { pose: 'wave', line: "Enter your email and I'll send a sign-in link. No password needed." }
    case 'login':
      return { pose: 'wave', line: "Hi, I'm Kenji. Sign in and I'll show you what broke in your app, in plain English." }
  }
}

// ─── First run (onboarding S1 + S2) ─────────────────────────────────────────

export const FIRST_RUN_NAME_PROJECT: GuideLine = {
  pose: 'point',
  line: "Step one: name your app. I'll open a notebook for it and make its key.",
}

/** Kenji's line for each phase of the first-diagnosis machine (lib/firstDiagnosis.ts). */
export function firstDiagnosisGuide(state: FirstDiagnosisState): GuideLine {
  switch (state.phase) {
    case 'idle':
      return { pose: 'point', line: "Press Send test report. I'll file a sample bug and read it for you." }
    case 'sending':
      return { pose: 'magnify', line: 'Filing a sample bug, the way one of your users would.' }
    case 'queued':
      return { pose: 'magnify', line: "It's in the queue. I'll pick it up in a few seconds." }
    case 'classifying':
      return { pose: 'magnify', line: 'Reading the screenshot, the console and the network log now.' }
    case 'diagnosed':
      return { pose: 'found', line: "Found it. Here's what broke, why, and where the fix starts." }
    case 'quota_exhausted':
      return { pose: 'think', line: "This month's diagnoses are used up. Billing shows how to get more." }
    case 'classifier_failed':
      return { pose: 'oops', line: "My read didn't finish. Send another and I'll try again." }
    case 'offline':
      return { pose: 'think', line: "You're offline. I'll carry on as soon as the connection is back." }
    case 'timed_out':
      return { pose: 'think', line: 'This one is taking longer than usual. The report is safe either way.' }
    case 'send_failed':
      return { pose: 'oops', line: "I couldn't file the test report. Give it another try." }
  }
}

// ─── Full setup checklist (one line per tab) ────────────────────────────────

interface SetupProgress {
  /** The team has at least one project (the progress rail only shows then). */
  hasProject: boolean
  /** Every step of the active project is done. */
  complete: boolean
}

export function onboardingTabGuide(tab: OnboardingTabId, progress: SetupProgress): GuideLine {
  switch (tab) {
    case 'overview':
      if (!progress.hasProject) {
        return { pose: 'wave', line: "Hi, I'm Kenji. Three steps below wire up your app. Start with the first." }
      }
      return progress.complete
        ? { pose: 'found', line: 'Your app is wired up. Keep this page as your install reference.' }
        : { pose: 'point', line: 'The rail above shows the next step. Do them in order and you are done.' }
    case 'steps':
      return { pose: 'point', line: 'All optional. Connect these when you want alerts or fixes in your tools.' }
    case 'verify':
      return { pose: 'magnify', line: "Send a test bug and I'll show you the read your users' bugs will get." }
    case 'sdk':
      return { pose: 'laptop', line: 'Paste this into your app. Every bug a user reports then gets the same read.' }
    case 'diagnose':
      return { pose: 'think', line: "Reports not arriving? Let's check the heartbeat, the version and the key." }
  }
}

// ─── Home ───────────────────────────────────────────────────────────────────

export const HOME_ALL_CLEAR: GuideLine = {
  pose: 'allclear',
  line: "Nothing needs you right now. I'll list it here the moment something does.",
}

// ─── Connect (editor / MCP) ─────────────────────────────────────────────────

/** The editor (MCP) state the Connect page already reads. */
type EditorConnectState = McpStats['topPriority']

export function editorConnectGuide(state: EditorConnectState): GuideLine {
  switch (state) {
    case 'no_project':
      return { pose: 'point', line: 'Pick or create an app first. Everything on this page connects to it.' }
    case 'never_connected':
      return { pose: 'laptop', line: "Your editor hasn't called in yet. Set it up below, then ask it about a report." }
    case 'endpoint_mismatch':
      return { pose: 'think', line: 'Your editor is calling an old address. The note above has the fix.' }
    case 'no_mcp_key':
    case 'report_only_keys':
      return { pose: 'laptop', line: 'Bug reports are coming in. Next, let your editor read them with an MCP key.' }
    case 'healthy':
      return { pose: 'found', line: "Your editor is connected. Ask it for any report's fix context." }
  }
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** 404: the page offers "Back to dashboard" (or home) and "Open docs". */
export const NOT_FOUND_GUIDE: GuideLine = {
  pose: 'think',
  line: "This page isn't in my field notes. Head back, or look up its new name in the docs.",
}

/** Render crash: the boundary offers "Back to home" and "Open docs". */
export const CRASH_GUIDE: GuideLine = {
  pose: 'oops',
  line: "That crash is on us, not you. Head back home and carry on; your saved work is safe.",
}
