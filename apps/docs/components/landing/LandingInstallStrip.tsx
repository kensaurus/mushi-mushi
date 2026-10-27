'use client'

/**
 * The hero's install box: pick your editor (Claude Code, Cursor, other), then
 * three numbered steps — connect the editor, paste one prompt that has the AI
 * set Mushi up and send a test report, ask it to fix a real bug. The steps are
 * the cycle of ADR 0027 (connect, bugs come in, a fix you review), and each one
 * ends in what you should see.
 *
 * The Lovable or Bolt tab has the same three steps without a terminal: sign up
 * and copy the console's script tag, paste a prompt that adds it to <head>,
 * read the diagnosis (LANDING_INSTALL_LOVABLE).
 *
 * Every editor install is URL-only (`buildOAuthInstall`): the editor runs the
 * Mushi OAuth sign-in on first use, so the page needs no key. The Cursor
 * badges are Cursor's official artwork, bundled under public/badges because
 * the docs CSP does not allow images from cursor.com.
 */
import { useId, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { MUSHI_CANONICAL_URLS } from '@mushi-mushi/brand'
import { buildOAuthInstall } from '@mushi-mushi/mcp/clients'
import {
  LANDING_FIX_PROMPT,
  LANDING_HERO_START,
  LANDING_INSTALL,
  LANDING_INSTALL_LOVABLE as L,
  LANDING_SETUP_PROMPT,
} from '@/lib/landing-copy'
import { publicAssetPath } from '@/lib/public-asset-path'
import { CopyCommand } from '../CopyCommand'

type TabId = (typeof LANDING_INSTALL.tabs)[number]['id']

const cursorInstall = buildOAuthInstall('cursor', { mcpOAuthUrl: MUSHI_CANONICAL_URLS.hostedMcp })
const CURSOR_URL = cursorInstall.kind === 'deeplink' ? cursorInstall.url : '/connect'
const claudeInstall = buildOAuthInstall('claude-code', { mcpOAuthUrl: MUSHI_CANONICAL_URLS.hostedMcp })
const CLAUDE_CMD = claudeInstall.kind === 'command' ? claudeInstall.text : ''

function ConnectAction({ tab }: { tab: TabId }) {
  if (tab === 'lovable') {
    // Console signup is another app — plain <a>, same tab, tracked. Its id
    // stays `landing-hero` so the signup funnel keeps its history.
    return (
      <a
        href={LANDING_HERO_START.console.href}
        className="landing-hero-cta landing-hero-cta--secondary"
        data-mushi-cta={LANDING_HERO_START.console.id}
        data-mushi-location="hero-install"
      >
        {LANDING_HERO_START.console.label} →
      </a>
    )
  }
  if (tab === 'claude-code') {
    return <CopyCommand cmd={CLAUDE_CMD} ctaId="landing-copy-claude" location="hero-install" />
  }
  if (tab === 'cursor') {
    return (
      <a
        href={CURSOR_URL}
        className="landing-oneclick__badge"
        data-mushi-cta={LANDING_HERO_START.cursor.id}
        data-mushi-location="hero-install"
      >
        {/* Dark badge on the light theme, light badge on the dark theme. */}
        <img
          className="landing-oneclick__badge-img landing-oneclick__badge-img--on-light"
          src={publicAssetPath('/badges/cursor-mcp-install-dark.png')}
          alt={LANDING_INSTALL.cursorAlt}
          width={169}
          height={39}
        />
        <img
          className="landing-oneclick__badge-img landing-oneclick__badge-img--on-dark"
          src={publicAssetPath('/badges/cursor-mcp-install-light.png')}
          alt=""
          aria-hidden="true"
          width={169}
          height={39}
        />
      </a>
    )
  }
  return (
    <Link
      href={LANDING_INSTALL.otherHref}
      className="landing-hero-cta landing-hero-cta--secondary"
      data-mushi-cta={LANDING_HERO_START.more.id}
      data-mushi-location="hero-install"
    >
      {LANDING_INSTALL.otherLabel} →
    </Link>
  )
}

function Check({ children }: { children: string }) {
  return (
    <p className="landing-install-box__check">
      <span aria-hidden="true">✓</span>
      <span>
        <strong>You&rsquo;ll see:</strong> {children}
      </span>
    </p>
  )
}

export function LandingInstallStrip() {
  const [tab, setTab] = useState<TabId>('claude-code')
  const baseId = useId()
  const tabs = LANDING_INSTALL.tabs
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]
  const lovable = current.id === 'lovable'

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const last = tabs.length - 1
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : index === 0 ? last : index - 1
    setTab(tabs[next].id)
    document.getElementById(`${baseId}-tab-${tabs[next].id}`)?.focus()
  }

  return (
    <section id="install" className="landing-install-box" aria-label="Install Mushi Mushi">
      <div className="landing-install-box__tabs" role="tablist" aria-label={LANDING_INSTALL.label}>
        <span className="landing-install-box__tabs-label" aria-hidden="true">
          {LANDING_INSTALL.label}
        </span>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            className="landing-install-box__tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ol
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${current.id}`}
        className="landing-install-box__steps"
      >
        <li className="landing-install-box__step">
          <span className="landing-install-box__num" aria-hidden="true">1</span>
          <div className="landing-install-box__body">
            <h3 className="landing-install-box__title">{lovable ? L.steps.connect : LANDING_INSTALL.steps.connect}</h3>
            <p className="landing-install-box__desc">{current.connect}</p>
            <ConnectAction tab={current.id} />
          </div>
        </li>
        <li className="landing-install-box__step">
          <span className="landing-install-box__num" aria-hidden="true">2</span>
          <div className="landing-install-box__body">
            <h3 className="landing-install-box__title">{lovable ? L.steps.setup : LANDING_INSTALL.steps.setup}</h3>
            {lovable ? <p className="landing-install-box__desc">{L.setupLead}</p> : null}
            <CopyCommand
              cmd={lovable ? L.prompt : LANDING_SETUP_PROMPT}
              prompt
              ctaId={lovable ? 'landing-copy-lovable-prompt' : 'landing-copy-setup-prompt'}
              location="hero-install"
            />
            <Check>{lovable ? L.setupCheck : LANDING_INSTALL.setupCheck}</Check>
          </div>
        </li>
        <li className="landing-install-box__step">
          <span className="landing-install-box__num" aria-hidden="true">3</span>
          <div className="landing-install-box__body">
            <h3 className="landing-install-box__title">{lovable ? L.steps.fix : LANDING_INSTALL.steps.fix}</h3>
            {lovable ? (
              <>
                <p className="landing-install-box__desc">{L.fixLead}</p>
                <p className="landing-install-box__desc">
                  <Link href={L.connector.href} data-mushi-cta="landing-lovable-connector" data-mushi-location="hero-install">
                    {L.connector.label}
                  </Link>
                </p>
              </>
            ) : (
              <>
                <p className="landing-install-box__desc">{LANDING_INSTALL.fixLead}</p>
                <CopyCommand cmd={LANDING_FIX_PROMPT} prompt ctaId="landing-copy-fix-prompt" location="hero-install" />
                <Check>{LANDING_INSTALL.fixCheck}</Check>
              </>
            )}
          </div>
        </li>
      </ol>
      <div className="landing-install-box__no-editor">
        {lovable ? (
          <Link
            href={L.guide.href}
            className="landing-install-box__guide"
            data-mushi-cta="landing-lovable-guide"
            data-mushi-location="hero-install"
          >
            {L.guide.label}
          </Link>
        ) : (
          <CopyCommand
            label={LANDING_INSTALL.noEditor}
            cmd={LANDING_HERO_START.npx.cmd}
            ctaId={LANDING_HERO_START.npx.id}
            location="hero-install"
          />
        )}
      </div>
    </section>
  )
}
