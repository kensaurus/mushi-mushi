/**
 * "What else it does" (/what-it-does): the checks and helpers beyond the one
 * job the landing leads with (ADR 0052), each as the pain it answers, what it
 * does, what it needs and where to start. Plain words for non-technical
 * builders. Every "needs" line is a real requirement in the code (keys,
 * connections, a worker); keep it that way when features change.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'

const CONSOLE = 'https://kensaur.us/mushi-mushi/admin'

export interface Feature {
  id: string
  name: string
  pain: string
  does: string
  needs: string
  icon: ReactNode
  start: { label: string; href: string }
  more?: { label: string; href: string }
}

/** 24×24 line icons, drawn here so the docs need no icon dependency. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const FEATURES: Feature[] = [
  {
    id: 'first-user-test',
    name: 'First-time user test',
    pain: 'You can’t use your own app like a stranger. You already know where every button is.',
    does: 'An AI that has never seen your app starts at your home page and tries one goal, like signing up. It times every step, notes where it got stuck, and files those stalls as bugs with screenshots.',
    needs: 'A computer of yours running the Mushi Mushi worker, or run it once yourself with mushi ux fresh-eyes.',
    icon: (
      <Icon>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </Icon>
    ),
    start: { label: 'Open First-time user test', href: `${CONSOLE}/first-user-test` },
    more: { label: 'How it works', href: '/admin/ux-runs' },
  },
  {
    id: 'ai-review',
    name: 'A second AI checks every fix',
    pain: 'The AI’s fix looked right, passed the tests, and broke something else.',
    does: 'Before a fix merges, a second AI reads it next to the original bug report and says merge, fix first or do not merge, with its reasons line by line. When you choose “Merge when ready”, approved fixes land one at a time, each branch updated and its tests passed first.',
    needs: 'Your GitHub repo connected and your own Anthropic key.',
    icon: (
      <Icon>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
        <path d="M6 8.5v7M8.5 6h3a4 4 0 0 1 4 4" />
      </Icon>
    ),
    start: { label: 'See a fix it held', href: 'https://github.com/kensaurus/mushi-mushi/pull/864' },
    more: { label: 'Fixes in the console', href: '/admin/fixes' },
  },
  {
    id: 'site-watch',
    name: 'Live-site watch',
    pain: 'Your site breaks at night and you hear about it from a user, days later.',
    does: 'Checks your live pages every hour. A page that errors, a dead link or a broken layout is checked a second time, and only then filed as a bug, so a one-off blip doesn’t wake you.',
    needs: 'Your own Firecrawl key. Off until you switch it on.',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </Icon>
    ),
    start: { label: 'Switch it on', href: `${CONSOLE}/credits` },
    more: { label: 'Checks in the console', href: '/admin/checks' },
  },
  {
    id: 'site-audit',
    name: 'Weekly site audit',
    pain: 'Dead links, missing page titles and text in the wrong language quietly cost you visitors.',
    does: 'Once a week it reads every page of your site and files one plain-English report per problem: broken links and images, missing titles and descriptions, pages in the wrong language, images without a text description.',
    needs: 'Your own Firecrawl key. Off until you switch it on.',
    icon: (
      <Icon>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M9 10h6M9 14h6M9 18h3" />
      </Icon>
    ),
    start: { label: 'Switch it on', href: `${CONSOLE}/credits` },
  },
  {
    id: 'vulnerabilities',
    name: 'Known security holes',
    pain: 'Your AI added hundreds of packages. You can’t tell which one has a known security hole.',
    does: 'Every day it checks each package version in your lockfiles against the public vulnerability database. A hole with a fixed version becomes a report that says which package to update and how urgent it is.',
    needs: 'Your GitHub repo connected.',
    icon: (
      <Icon>
        <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        <path d="M12 8v5M12 16h.01" />
      </Icon>
    ),
    start: { label: 'Open Checks', href: `${CONSOLE}/checks` },
  },
  {
    id: 'ci-cost',
    name: 'Your CI bill, explained',
    pain: 'Your GitHub Actions bill went up and you don’t know which workflow did it.',
    does: 'Reads your real GitHub bill, shows which repos and workflows cost the most, and spots waste, such as tests that run when only docs changed or a scheduled job that runs every hour. One click opens a draft pull request with the fix, and after it merges the minutes saved are measured.',
    needs: 'Your GitHub repo connected. Reading the bill needs a GitHub token that can see billing.',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2" />
      </Icon>
    ),
    start: { label: 'Open CI runners', href: `${CONSOLE}/ci` },
    more: { label: 'How the bill is read', href: '/admin/ci' },
  },
  {
    id: 'ci-runners',
    name: 'Is it my code or the CI machine?',
    pain: 'CI failed again, and you can’t tell if it’s your code or GitHub having a bad day.',
    does: 'Watches every CI job: how long it waited for a machine, how long it ran, and whether it failed on your code or on the machine. A machine problem is never blamed on a fix.',
    needs: 'Your GitHub repo connected.',
    icon: (
      <Icon>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4M7 9l2 2-2 2M11 13h4" />
      </Icon>
    ),
    start: { label: 'Open CI runners', href: `${CONSOLE}/ci` },
  },
  {
    id: 'skill-runs',
    name: 'Playbooks that run in rounds',
    pain: 'You know the app needs a proper pass, for speed, accessibility or tidier code, but it means a week of prompting.',
    does: 'Pick a playbook, like “make it accessible”, and a part of your app. It runs in rounds: each round becomes a fix pull request, and once that merges the next round starts, until the playbook finds nothing left (five rounds at most). You can also chain playbooks on one bug, for example reproduce, fix, test, and run each step in your editor.',
    needs: 'Your own Cursor key, or a computer running the Mushi Mushi worker.',
    icon: (
      <Icon>
        <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
        <path d="M18 3v4h-4M6 21v-4h4" />
      </Icon>
    ),
    start: { label: 'Open Agent skills', href: `${CONSOLE}/skills` },
    more: { label: 'Chaining playbooks', href: '/admin/skill-pipelines' },
  },
  {
    id: 'store-reviews',
    name: 'Bad app store reviews become bugs',
    pain: 'A one-star review says the app crashes, and you see it a week later.',
    does: 'Reads your App Store and Google Play reviews every six hours. Low-star reviews become bug reports with a plain-English diagnosis, like any other report.',
    needs: 'Your store accounts connected. Off until you switch it on.',
    icon: (
      <Icon>
        <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />
      </Icon>
    ),
    start: { label: 'Open Integrations', href: `${CONSOLE}/integrations` },
  },
  {
    id: 'voice',
    name: 'Report a bug from your phone',
    pain: 'You notice a bug on your phone and have forgotten it by the time you’re at your desk.',
    does: 'Say it or type it into Telegram, Slack or an iPhone shortcut. It becomes a report, and it can start a fix and send you the draft pull request.',
    needs: 'Telegram, Slack or the shortcut connected from the console.',
    icon: (
      <Icon>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </Icon>
    ),
    start: { label: 'Open Voice reports', href: `${CONSOLE}/voice` },
    more: { label: 'Set it up', href: '/admin/voice' },
  },
]

function Go({ href, children, className }: { href: string; children: ReactNode; className: string }) {
  return href.startsWith('/') ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  )
}

export function FeatureTour() {
  return (
    <div className="not-prose grid gap-4 sm:grid-cols-2">
      {FEATURES.map((f) => (
        <section key={f.id} id={f.id} className="landing-diagnosis-card" aria-labelledby={`${f.id}-name`}>
          <span className="landing-diagnosis-glyph">{f.icon}</span>
          <h3 id={`${f.id}-name`} className="landing-diagnosis-name">
            {f.name}
          </h3>
          <p className="m-0 text-sm italic text-mushi-ink-muted">{f.pain}</p>
          <p className="m-0 text-sm text-mushi-ink">{f.does}</p>
          <p className="m-0 text-xs text-mushi-ink-muted">
            <strong className="font-semibold">Needs:</strong> {f.needs}
          </p>
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Go href={f.start.href} className="font-medium text-mushi-vermillion hover:underline">
              {f.start.label} →
            </Go>
            {f.more && (
              <Go href={f.more.href} className="text-mushi-ink-muted underline-offset-2 hover:underline">
                {f.more.label}
              </Go>
            )}
          </p>
        </section>
      ))}
    </div>
  )
}
