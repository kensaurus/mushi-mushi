/**
 * FILE: packages/cli/src/auth-ui.ts
 * PURPOSE: Shared browser sign-in UX helpers for the anti-paste auth banner.
 *
 * OVERVIEW:
 *   Centralizes the CLI-side messaging for the RFC 8628 device-auth flow so
 *   that `mushi init`, `mushi login`, and `mushi project create` all show the
 *   same clear, numbered instructions — including an explicit "do NOT type in
 *   terminal" guard that prevents the most common user mistake (pasting the
 *   verification code into the shell as a command).
 *
 * USAGE:
 *   import { printAuthBanner, printAuthApproved } from './auth-ui.js'
 *   printAuthBanner(session.user_code, session.verification_uri)
 *   // ... wait for token ...
 *   printAuthApproved()
 *
 * TECHNICAL DETAILS:
 *   - Works with both @clack/prompts surfaces (init wizard) and raw console
 *     surfaces (mushi login, mushi project create).
 *   - Uses box-drawing characters that render on Windows cmd, PowerShell,
 *     Git Bash, and POSIX terminals.
 */

/** Character-safe box top/bottom line (58 chars wide). */
const LINE = '─'.repeat(58)

/**
 * Print the numbered browser sign-in banner.
 *
 * Always call this right after opening (or printing) the browser URL, before
 * starting the poll spinner. The banner explicitly tells the user to look at
 * the browser tab — not to type anything in the terminal.
 *
 * @param userCode       The XXXX-XXXX code shown in both terminal and browser.
 * @param verificationUri The full URL the CLI opened (or the user should open).
 */
export function printAuthBanner(userCode: string, verificationUri: string): void {
  console.log('')
  console.log(`  ┌${LINE}┐`)
  console.log(`  │  Browser sign-in — follow these 3 steps              │`)
  console.log(`  ├${LINE}┤`)
  console.log(`  │                                                        │`)
  console.log(`  │  1. A browser tab will open (or visit the URL below)  │`)
  console.log(`  │  2. Sign in if prompted, then click "Approve"         │`)
  console.log(`  │  3. Come back here — setup continues automatically    │`)
  console.log(`  │                                                        │`)
  console.log(`  ├${LINE}┤`)
  console.log(`  │  Verification code (show in browser — NOT terminal):  │`)
  console.log(`  │                                                        │`)
  console.log(`  │    ${userCode.padEnd(52)}│`)
  console.log(`  │                                                        │`)
  console.log(`  │  ⚠  Do NOT paste or type this code in your terminal   │`)
  console.log(`  └${LINE}┘`)
  console.log('')
  // Print the verification URL in full on its own line — never truncate it.
  // The code is embedded as a query param, so a clipped URL would drop the
  // code and leave the manual-fallback link broken.
  console.log(`  If the browser didn't open, visit this URL and approve:`)
  console.log(`    ${verificationUri}`)
  console.log('')
  console.log('  ⏳ Waiting for browser approval… (Ctrl+C to cancel)')
  console.log('')
}

/**
 * Print a brief "Approved — return to terminal" confirmation line.
 * Replaces the spinner-stop message so the user knows the browser step is done.
 */
export function printAuthApproved(): void {
  console.log('')
  console.log('  ✓ Approved! Continuing setup in this terminal…')
  console.log('')
}

/**
 * Print the denied / timed-out error with a recovery hint.
 */
export function printAuthFailed(reason: 'denied' | 'timeout' | 'error', detail?: string): void {
  console.log('')
  if (reason === 'denied') {
    console.error('  ✗ Browser sign-in was denied.')
    console.error('    If that was a mistake, run mushi login again.')
  } else if (reason === 'timeout') {
    console.error('  ✗ Browser sign-in timed out (10 minutes elapsed).')
    console.error('    Run mushi login again — a new code will be generated.')
  } else {
    console.error(`  ✗ Browser sign-in failed: ${detail ?? 'unknown error'}`)
    console.error('    Run mushi login again, or use:')
    console.error('      mushi login --api-key <key> --project-id <uuid>')
  }
  console.log('')
}
