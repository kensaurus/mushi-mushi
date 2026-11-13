/**
 * Copy shared between admin console and docs (connect Skills lane, login hero).
 * Mirror of apps/docs/lib/public-copy.ts — keep CONNECT_SKILLS in sync.
 */
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'

export const CONNECT_SKILLS = {
  intro:
    'Skills are playbooks your editor can read on demand — bug triage, fix-and-ship, QA, security audit, and more.',
  whatAreSkillsTitle: 'What are skills?',
  whatAreSkillsBody:
    'SKILL.md playbooks live in GitHub repos and sync into Mushi Mushi so the right playbook surfaces when a report lands. Your agent reads them — nothing runs automatically.',
  learnMoreHref: 'https://kensaur.us/mushi-mushi/docs/sdks/skills',
  learnMoreLabel: 'Learn about skills →',
  /**
   * The skills `npx skills add kensaurus/mushi-mushi` installs, in the order
   * the Connect lane lists them. scripts/sync-skills.mjs --check fails when
   * this list and the repo's skills/ folder disagree.
   */
  skillNames: [
    'mushi-mushi',
    'mushi-setup',
    'mushi-triage',
    'mushi-debug',
    'mushi-test',
    'mushi-sdk-upgrade',
    'mushi-check-live-app',
  ],
} as const

export const LOGIN_HERO = {
  /**
   * The landing's headline, so a visitor who clicked "Start free" reads the
   * same thing here. Not the offer line after it ("...with a reviewer that
   * says no"): it means nothing to someone who has not seen the product yet.
   */
  cloudTagline: MUSHI_TAGLINE_V2.hero,
  /** Directly under the title on sign-up: the price, and the one thing that happens next. */
  signupNext: 'Free for one app, no card. Next: copy one line and paste it into Lovable, Bolt or your code.',
  /** Under the sign-up form: the last doubt a stranger has before trusting a new tool. */
  signupReassurance: 'Open source, so you can read every line it runs.',
  selfHostTagline: 'Sign in to your self-hosted Mushi Mushi console.',
} as const
