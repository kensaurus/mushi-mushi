'use client'

import { useState } from 'react'
import { useMarketing } from './context'
import { reportSample } from './canvas/data'

// Three-persona content — each chip swaps the lead paragraph in place.
// See docs/marketing/VOICE.md for the phrasebook that backs each persona.
const PERSONAS = [
  {
    id: 'vibe' as const,
    label: 'Vibe coder',
    lead: 'You build and ship fast with AI. The choke point is testing and observability. Mushi captures what users feel, AI triages it, and opens a draft PR — no QA team, no Jira, no PM bottleneck.',
  },
  {
    id: 'team' as const,
    label: 'AI-native team',
    lead: 'Your agents already write the code. Mushi closes the loop so they also know which bugs to fix next — and never repeat the same class of mistake twice.',
  },
  {
    id: 'pm' as const,
    label: 'PM / founder',
    lead: 'Get bug and feature signal direct from users, not through a support queue. The loop fixes the cheap ones automatically. You stay focused on what only you can decide.',
  },
] as const

type PersonaId = (typeof PERSONAS)[number]['id']

export function Hero() {
  const { Link, urls } = useMarketing()
  const [persona, setPersona] = useState<PersonaId>('vibe')

  const activePersona = PERSONAS.find((p) => p.id === persona) ?? PERSONAS[0]

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] px-6 py-8 shadow-[0_24px_80px_-48px_rgba(14,13,11,0.45)] sm:px-10 sm:py-10 lg:px-14">
      <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_18%_12%,var(--mushi-vermillion-wash),transparent_32%),radial-gradient(circle_at_84%_18%,rgba(14,13,11,0.05),transparent_34%)]" />
      <div className="relative grid gap-6 lg:grid-cols-[1.1fr_0.95fr] lg:items-center lg:gap-8">
        <div className="max-w-4xl">
          {/* Eyebrow uses the spine sub-tagline from @mushi-mushi/brand MUSHI_TAGLINE.spine */}
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--mushi-ink-muted)]" aria-hidden="true">
            <span className="text-[var(--mushi-ink)]">Mushi</span>
            <span className="mx-2 opacity-40">/</span>
            the evolution loop for AI-assisted software
          </p>

          {/* H1 uses MUSHI_TAGLINE.full — canonical, word-for-word. See packages/brand/src/index.js. */}
          <h1 className="mt-3 max-w-3xl font-serif text-5xl font-semibold leading-[0.95] tracking-[-0.06em] text-[var(--mushi-ink)] sm:text-6xl lg:text-7xl">
            Sentry sees what code throws.{' '}
            <br className="hidden sm:block" />
            <span className="text-[var(--mushi-vermillion)]">Mushi closes the loop with AI.</span>
          </h1>

          {/* Three-persona switcher chips — vibe coder / AI-native team / PM+founder.
              Swaps the lead paragraph without a page navigation. */}
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="I am a…">
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersona(p.id)}
                className={[
                  'rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]',
                  persona === p.id
                    ? 'border-[var(--mushi-ink)] bg-[var(--mushi-ink)] text-[var(--mushi-paper)]'
                    : 'border-[var(--mushi-rule)] bg-transparent text-[var(--mushi-ink-muted)] hover:border-[var(--mushi-ink)] hover:text-[var(--mushi-ink)]',
                ].join(' ')}
                aria-pressed={persona === p.id}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Lead paragraph — swaps when persona chip is pressed. */}
          <p key={activePersona.id} className="mt-3 max-w-xl text-base leading-7 text-[var(--mushi-ink-muted)] sm:text-lg sm:leading-7">
            {activePersona.lead}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={urls.signup}
              className="rounded-sm bg-[var(--mushi-vermillion)] px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
            >
              Start free, no card
            </Link>
            <Link
              href={urls.loopAnchor}
              className="group inline-flex items-center gap-2 rounded-sm border border-[color-mix(in_oklch,var(--mushi-ink)_22%,var(--mushi-rule))] bg-[color-mix(in_oklch,var(--mushi-paper)_82%,white)] px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mushi-ink)] transition hover:-translate-y-0.5 hover:border-[var(--mushi-ink)] hover:bg-[color-mix(in_oklch,var(--mushi-paper)_70%,white)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
            >
              See one walk through
              <span aria-hidden="true" className="transition-transform group-hover:translate-y-0.5 motion-reduce:transition-none">↓</span>
            </Link>
          </div>

          <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--mushi-ink-muted)]">
            <li>1,000 reports / mo free</li>
            <li aria-hidden="true" className="text-[var(--mushi-ink-faint)] opacity-50">／</li>
            <li>8 SDKs, web to native</li>
            <li aria-hidden="true" className="text-[var(--mushi-ink-faint)] opacity-50">／</li>
            <li>MIT-licensed</li>
          </ul>
        </div>

        <ReportPreview />
      </div>
    </section>
  )
}

function ReportPreview() {
  return (
    <aside
      aria-label="Preview of a Mushi report"
      className="relative overflow-hidden rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_94%,white)] p-5 shadow-[0_22px_60px_-40px_rgba(14,13,11,0.55)]"
    >
      <header className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--mushi-vermillion)]" />
          <span className="text-[var(--mushi-ink)]">live</span>
          <span className="opacity-40">·</span>
          /reports
        </span>
        <span className="rounded-sm border border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink)]">
          {reportSample.prNumber}
        </span>
      </header>

      <h2 className="mt-3 font-serif text-[1.6rem] leading-[1.12] tracking-[-0.03em] text-[var(--mushi-ink)]">
        {reportSample.title}
      </h2>
      <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--mushi-ink-muted)]">
        {reportSample.path}
        <span className="mx-2 opacity-40">·</span>
        {reportSample.browser}
      </p>

      <blockquote className="mt-3 rounded-md border-l-[3px] border-[color-mix(in_oklch,var(--mushi-ink)_30%,var(--mushi-rule))] bg-[color-mix(in_oklch,var(--mushi-paper)_82%,white)] py-2.5 pl-3 pr-3 font-serif text-[13.5px] italic leading-[1.55] text-[var(--mushi-ink)]">
        &ldquo;{reportSample.userNote}&rdquo;
      </blockquote>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--mushi-rule)] pt-3">
        <DataPill label="Severity" value={reportSample.severity} tone="alert" />
        <DataPill label="Class" value={reportSample.taxonomy} tone="ink" />
        <DataPill label="Judge" value={reportSample.judgeScore} tone="pass" suffix="/ 1.00" />
      </dl>
    </aside>
  )
}

type PillTone = 'alert' | 'ink' | 'pass'

const PILL_TONES: Record<PillTone, { bg: string; fg: string; dot: string; border: string }> = {
  alert: { bg: 'var(--mushi-vermillion)', fg: '#ffffff', dot: '#ffffff', border: 'var(--mushi-vermillion)' },
  ink: { bg: 'var(--mushi-ink)', fg: 'var(--mushi-paper)', dot: 'var(--mushi-vermillion)', border: 'var(--mushi-ink)' },
  pass: { bg: 'var(--mushi-jade)', fg: '#ffffff', dot: '#ffffff', border: 'var(--mushi-jade)' },
}

function DataPill({ label, value, tone, suffix }: { label: string; value: string; tone: PillTone; suffix?: string }) {
  const colors = PILL_TONES[tone]
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
        {label}
      </dt>
      <dd
        className="mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[11px] font-semibold uppercase leading-tight tracking-[0.06em] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]"
        style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'alert' ? 'animate-pulse' : ''}`}
          style={{ background: colors.dot }}
        />
        <span className="min-w-0 break-words">{value}</span>
        {suffix && (
          <span className="ml-auto shrink-0 whitespace-nowrap opacity-70" style={{ fontSize: '0.78em' }}>
            {suffix}
          </span>
        )}
      </dd>
    </div>
  )
}
