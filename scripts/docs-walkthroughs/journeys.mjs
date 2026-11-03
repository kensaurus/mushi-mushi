/**
 * The docs walkthroughs, step by step. scripts/record-docs-walkthroughs.mjs plays them; each `chapter`
 * step becomes one line of the step list beside the video on the docs page,
 * so write chapter text as the instruction a reader follows.
 *
 * Console journeys use the mushi-mushi app only: its repo and pull requests
 * are public, so nothing private shows. A bug that went all the way through
 * is the example: "App switcher says All apps but the page only shows one
 * app", fixed in kensaurus/mushi-mushi#689.
 */

const ADMIN = 'https://kensaur.us/mushi-mushi/admin'
const APP = '67a6453c-375d-41d7-833a-b33471159442' // the mushi-mushi app

/** Text swapped out of every page before it is filmed. */
export const PRIVACY = [
  ['solo-boss-cloud', 'my-other-app'],
  ['test@mushimushi.dev', 'you@example.com'],
]

/**
 * Names of the owner's other apps. The recorder fails a run if any of them is
 * visible in a frame, so a private app never reaches a public video. Matched
 * case-insensitively against the text on screen.
 */
export const DENYLIST = ['glot', 'tsumagoi', 'yen-yen', 'yenyen', 'solo-boss', 'solo:', 'help her', 'help-her', 'wanting-mind', 'wanting mind', 'lets-talk', 'sbc', 'mushimushi.dev']

const widget = (p) => p.locator('#mushi-mushi-widget')
/** A button whose whole visible text is `text` (icons and badges aside). */
const exactButton = (p, text) => p.locator('button, [role=tab]', { hasText: new RegExp(String.raw`^\s*${text}\s*$`) })

export const JOURNEYS = [
  {
    id: 'report-a-bug',
    title: 'Your user reports a bug',
    summary: 'What the person using your app sees: one button, one sentence, and the screen goes with it.',
    colorScheme: 'light',
    captionAt: 'top',
    posterAt: 9,
    steps: [
      { do: 'goto', url: 'https://plant-shop.example/', ready: '#total', settle: 1500 },
      { do: 'wait', target: (p) => widget(p).locator('button.mushi-trigger'), ms: 600 },
      { do: 'start' },
      { do: 'card', title: 'A user finds a bug in your app', subtitle: 'This is a made-up shop with the Mushi Mushi widget installed. Here is all your user has to do.' },
      { do: 'chapter', title: 'Your user taps + in the cart', detail: 'The total turns into $NaN. Most people would close the tab and never tell you.' },
      { do: 'click', target: '#plus', ring: true },
      { do: 'point', target: '#total', hold: 1800 },
      { do: 'chapter', title: 'They tap the bug button in the corner', detail: 'That is the Mushi Mushi widget: one script tag or one npm package in your app.' },
      { do: 'click', target: (p) => widget(p).locator('button.mushi-trigger'), ring: true, hold: 1400 },
      { do: 'chapter', title: 'They say what went wrong, in their own words', detail: 'Pick a kind and type one sentence. No account, no form to learn.' },
      { do: 'click', target: (p) => widget(p).locator('button.mushi-chip', { hasText: /^\s*Bug\s*$/ }), hold: 500 },
      { do: 'type', target: (p) => widget(p).locator('textarea'), text: 'The total says $NaN after I pressed + on the Monstera', delay: 38 },
      { do: 'chapter', title: 'They tap Screenshot to attach the screen', detail: 'The page and what they tapped go with every report. Only you, the developer, see them.' },
      { do: 'click', target: (p) => widget(p).getByRole('button', { name: 'Screenshot' }), ring: true, hold: 2600 },
      { do: 'chapter', title: 'They press Send. That is the whole job for them', detail: 'The report lands in your Mushi Mushi console, where it is explained in plain English.' },
      { do: 'click', target: (p) => widget(p).locator('button.mushi-submit'), ring: true, hold: 2600 },
      { do: 'end' },
    ],
  },
  {
    id: 'bug-to-fix',
    title: 'From a bug report to a merged fix',
    summary: 'A real bug from Mushi Mushi’s own console: the plain-English diagnosis, the fix prompt for your editor, and the pull request that fixed it.',
    requiresSignIn: true,
    signInCheckUrl: `${ADMIN}/reports?project=${APP}`,
    posterAt: 14,
    steps: [
      { do: 'goto', url: `${ADMIN}/reports?project=${APP}`, ready: (p) => p.getByText('Fix first', { exact: true }), settle: 2500 },
      { do: 'start' },
      { do: 'card', title: 'Mushi Mushi tells you why it broke', subtitle: 'A real bug from Mushi Mushi’s own app, from the report to the merged fix.' },
      { do: 'chapter', title: 'Every bug lands in one list', detail: 'Reports from your users, Sentry errors and Mushi Mushi’s own checks, ranked by how bad they are.' },
      { do: 'point', target: (p) => p.getByText('Fix first', { exact: true }).locator('xpath=ancestor::*[contains(@class,"rounded")][1]'), hold: 1800 },
      { do: 'chapter', title: 'Search for a bug and open it', detail: 'Or start from the top of “Fix first”.' },
      { do: 'scroll', target: (p) => p.getByPlaceholder(/Search bugs/), block: 'center', hold: 900 },
      { do: 'type', target: (p) => p.getByPlaceholder(/Search bugs/), text: 'ProjectSwitcher pill', delay: 60, hold: 2200 },
      { do: 'click', target: (p) => p.getByText(/ProjectSwitcher pill renders/).first(), ring: true, hold: 2600 },
      { do: 'wait', target: (p) => p.getByText('WHY IT BROKE', { exact: false }), ms: 600 },
      { do: 'chapter', title: 'Read the bug in plain English', detail: 'Mushi Mushi rewrites the report so anyone can tell what is wrong, and rates how bad it is.' },
      { do: 'point', target: (p) => p.getByText(/App switcher says "All apps"/).first(), hold: 1800 },
      { do: 'chapter', title: 'See why it broke and how to fix it', detail: 'The diagnosis names the cause, the fix and the steps to see it happen. It read 5 files of the repo to get there.' },
      { do: 'zoom', target: (p) => p.getByText('Diagnosis', { exact: true }).locator('xpath=ancestor::*[contains(@class,"rounded")][1]'), scale: 1.25, hold: 900 },
      { do: 'point', target: (p) => p.getByText('WHY IT BROKE', { exact: false }), hold: 2200 },
      { do: 'point', target: (p) => p.getByText('SUGGESTED FIX', { exact: false }), hold: 2200 },
      { do: 'unzoom' },
      { do: 'chapter', title: 'Hand the fix to your AI editor', detail: 'Copy one prompt into Claude Code, Cursor, Windsurf or Lovable, or let your editor fetch it over MCP.' },
      { do: 'scroll', target: (p) => p.getByText('Fix it with your coding agent'), block: 'center', hold: 1000 },
      { do: 'point', target: (p) => p.getByRole('button', { name: 'Copy fix prompt' }), hold: 1600 },
      { do: 'point', target: (p) => p.getByRole('button', { name: 'Use with Cursor' }), hold: 1400 },
      { do: 'chapter', title: 'Or let an agent open the pull request', detail: 'A fix agent writes the change, CI runs, and a second AI reviews it against the report before it merges.' },
      { do: 'scroll', target: (p) => p.getByText('THE STORY SO FAR', { exact: false }), block: 'start', hold: 1200 },
      { do: 'point', target: (p) => p.getByRole('link', { name: /PR #689/ }).first(), hold: 2200 },
      { do: 'chapter', title: 'Check how it reached the diagnosis', detail: 'Every step from the report to the merged fix, with how sure Mushi Mushi was at each one.' },
      { do: 'scroll', target: (p) => p.getByText('How Mushi reached this diagnosis'), block: 'start', hold: 1500 },
      { do: 'point', target: (p) => p.getByText(/^Root cause:/).first(), hold: 2400 },
      { do: 'end' },
    ],
  },
  {
    id: 'connect-editor',
    title: 'Connect your AI editor',
    summary: 'Pick your editor, add Mushi Mushi in one click or one command, then ask it to fix the latest bug.',
    requiresSignIn: true,
    signInCheckUrl: `${ADMIN}/connect?project=${APP}`,
    posterAt: 6,
    steps: [
      { do: 'goto', url: `${ADMIN}/connect?project=${APP}`, ready: (p) => p.getByRole('radio', { name: 'Cursor', exact: true }), settle: 2000 },
      // The page remembers the last editor picked; start from Cursor, off camera.
      { do: 'click', target: (p) => p.getByRole('radio', { name: 'Cursor', exact: true }), ms: 1, hold: 800 },
      { do: 'wait', target: (p) => p.getByRole('button', { name: 'Add to Cursor' }), ms: 300 },
      { do: 'start' },
      { do: 'card', title: 'Connect your AI editor', subtitle: 'Open Connect in the console. One click for Cursor and VS Code, one command for Claude Code.' },
      { do: 'chapter', title: 'Pick the editor you use', detail: 'Cursor, VS Code, Windsurf, Cline, Claude Code, Claude Desktop, Zed, or any MCP client.' },
      { do: 'point', target: (p) => p.getByText('YOUR AI CLIENT', { exact: false }).locator('xpath=..'), hold: 1800 },
      { do: 'click', target: (p) => p.getByRole('radio', { name: 'Claude Code', exact: true }), hold: 1600 },
      { do: 'chapter', title: 'Add Mushi Mushi in one step', detail: 'Claude Code gets one command to paste. Cursor and VS Code get a button that opens the install dialog.' },
      { do: 'point', target: (p) => p.getByRole('button', { name: 'Show Claude Code command' }), hold: 2200 },
      { do: 'click', target: (p) => p.getByRole('radio', { name: 'Cursor', exact: true }), hold: 900 },
      { do: 'point', target: (p) => p.getByRole('button', { name: 'Add to Cursor' }), hold: 2000 },
      { do: 'chapter', title: 'Then ask your editor for the fix', detail: '“Get the latest Mushi Mushi bug and fix it.” Your editor reads the diagnosis and the fix prompt for you.' },
      { do: 'ring', target: null },
      { do: 'wait', ms: 2800 },
      { do: 'chapter', title: 'Prefer the terminal? Use the CLI', detail: 'mushi reports, mushi fix, and the same data as the console.' },
      { do: 'click', target: (p) => exactButton(p, 'CLI'), ring: true, hold: 2400 },
      { do: 'end' },
    ],
  },
  {
    id: 'ship-fixes',
    title: 'Watch every fix ship',
    summary: 'The Pipeline page follows every bug from the report to the deploy, and shows the ones that need you.',
    requiresSignIn: true,
    signInCheckUrl: `${ADMIN}/pipeline?project=${APP}`,
    posterAt: 7,
    steps: [
      { do: 'goto', url: `${ADMIN}/pipeline?project=${APP}`, ready: (p) => p.getByText('RELEASE TR', { exact: false }), settle: 2000 },
      { do: 'scroll', target: (p) => p.getByText(/items stuck/), block: 'start', hold: 300 },
      { do: 'start' },
      { do: 'card', title: 'Watch every fix ship', subtitle: 'Open Pipeline: every bug, from the report to the deploy, on one page.' },
      { do: 'chapter', title: 'Follow each bug through eight stages', detail: 'Reported, triaged, fix PR, reviewed, CI, release train, merged, deployed.' },
      { do: 'zoom', target: (p) => p.getByText('5 CI', { exact: true }), scale: 1.25, hold: 600 },
      { do: 'point', target: (p) => p.getByText('1 REPORTED', { exact: false }).locator('xpath=..'), hold: 1200 },
      { do: 'point', target: (p) => p.getByText('3 FIX PR', { exact: false }).locator('xpath=..'), hold: 1200 },
      { do: 'point', target: (p) => p.getByText('6 RELEASE TR', { exact: false }).locator('xpath=..'), hold: 1400 },
      { do: 'point', target: (p) => p.getByText('7 MERGED', { exact: false }).locator('xpath=..'), hold: 1400 },
      { do: 'unzoom' },
      { do: 'chapter', title: 'Approved fixes ship together in a release train', detail: 'One branch, one CI run, one merge and one deploy, instead of one per fix.' },
      { do: 'point', target: (p) => p.getByText('6 RELEASE TR', { exact: false }).locator('xpath=..'), hold: 2000 },
      { do: 'chapter', title: 'Anything stuck says why, with the button to move it', detail: 'Close it, send it back to an agent, or re-run CI, right from the list.' },
      { do: 'scroll', target: (p) => p.getByText(/^Stuck: \d+/), block: 'start', hold: 1000 },
      { do: 'point', target: (p) => p.getByRole('button', { name: /It is fixed: close/ }).first(), hold: 2200 },
      { do: 'end' },
    ],
  },
]
