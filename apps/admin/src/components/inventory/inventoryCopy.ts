/**
 * Help copy for `/inventory`. The whitepaper breaks the inventory loop into
 * five movements (discover → propose → accept → ingest → reconcile) — this
 * help block exists because every first-time user asks the same question:
 * *"so what is this page actually doing?"*.
 *
 * v2.1 update: with passive SDK discovery + Claude-drafted proposals, most
 * users will never hand-author YAML. The copy now leads with the Discovery
 * tab; "ingest the YAML" is the power-user fallback.
 */

export const INVENTORY_HELP = {
  title: 'How this page works',
  whatIsIt:
    "Your app's map: every page, what a user can do on it, and whether each action still works. Turn on discovery (discoverInventory: true in @mushi-mushi/web) and the SDK notes which pages people open and what they click; Claude drafts user stories from that and you accept them. After that, Mushi checks each action against your code.",
  useCases: [
    'Discovery: the SDK notes routes, test ids, the APIs a page calls and a short page summary on every navigation. User ids are hashed before they leave the browser.',
    'Draft: once Mushi has seen 3 pages and 10 visits, click Generate on the Discovery tab and Claude drafts user stories, pages and actions, each with a one-line reason.',
    "Accept: review the draft (User stories is the main view; Map file is the editable raw form), rename or merge stories, then Accept. It becomes this app's map.",
    'Checking: code checks look for buttons that do nothing, fake data left in, and API calls that do not match. The crawler opens each page, and live probes try key actions every 15 minutes.',
    "Colours: red is broken (stopped working, or no code behind it yet), amber uses fake data, green works. Mushi sets them from the checks; you never set them by hand.",
  ],
  howToUse:
    'Empty? Click Turn on discovery. Once the map exists, User stories leads with each page and its actions (broken ones red and first), All actions is the full table, Code checks lists open findings, Live probes shows the 15-minute checks, and Out of sync lists what the crawler found that the map file does not have, and the reverse.',
}
