'use client'

const PORTFOLIO = [
  {
    id: 'glot-it',
    name: 'Glot It',
    href: 'https://kensaur.us/glot-it/',
    icon: 'https://kensaur.us/glot-it/icon-512.png',
    blurb: 'Learn Thai — bite-size lessons, smart flashcards, and an AI tutor.',
  },
  {
    id: 'yen-yen',
    name: 'yen-yen',
    href: 'https://kensaur.us/yen-yen/',
    icon: 'https://kensaur.us/yen-yen/icon.svg',
    blurb: "Where did the money go? Now you'll know. A kakeibo for households.",
  },
  {
    id: 'the-wanting-mind',
    name: 'The Wanting Mind',
    href: 'https://kensaur.us/the-wanting-mind/',
    icon: 'https://kensaur.us/the-wanting-mind/pwa-512x512.png',
    blurb:
      'How the Battle Between Extraction and Generation Is Reshaping Our World — 268 concepts, 242 citations, original illustrations.',
  },
  {
    id: 'help-her-take-photo',
    name: 'Help Her Take Photo',
    href: 'https://kensaur.us/help-her-take-photo/',
    icon: 'https://kensaur.us/help-her-take-photo/assets/apple-touch-icon.png',
    blurb: 'Pair phones, direct the pose, nail the photo.',
  },
  {
    id: 'how-to-talk-to-girls',
    name: 'How to Talk to Girls',
    href: 'https://talk.kensaur.us/',
    icon: 'https://talk.kensaur.us/pwa-192.png',
    blurb: 'BYOK Claude practice coach for sticky chats.',
  },
  {
    id: 'solo-boss',
    name: '一人社長 Solo Boss',
    href: 'https://solo-boss.kensaur.us/',
    icon: 'https://solo-boss.kensaur.us/apple-touch-icon.png',
    blurb: 'Bookkeeping and tax-filing co-pilot for one-person companies in Japan.',
  },
  {
    id: 'tsumagoi',
    name: 'Tsumagoi Work&Camp 嬬恋牧場',
    href: 'https://tsumagoi.kensaur.us/',
    icon: 'https://tsumagoi.kensaur.us/apple-touch-icon.png',
    blurb: 'Physical coworking camp at 1,444 m in Gunma, Japan.',
    extras: [
      { href: 'https://www.instagram.com/tsumagoicamp/', label: 'Instagram' },
      { href: 'https://www.facebook.com/profile.php?id=61592113053042', label: 'Facebook' },
      { href: 'https://maps.app.goo.gl/JCNnTfsdQVHCS1FA7', label: 'Maps' },
    ],
  },
  {
    id: 'cursor-kenji',
    name: 'cursor-kenji',
    href: 'https://github.com/kensaurus/cursor-kenji',
    icon: 'https://github.com/kensaurus.png',
    blurb: 'Ready-made playbooks for your AI coding editor.',
  },
  {
    id: 'portfolio',
    name: 'KENSAURUS',
    href: 'https://kensaur.us/?view=portfolio',
    icon: 'https://kensaur.us/favicon.svg',
    blurb: 'Everything else built under the same roof.',
  },
] as const

function withUtm(url: string, utmSource: string): string {
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}utm_source=${utmSource}&utm_medium=cross_promo&utm_campaign=more-by-kensaurus`
}

export function KensaurusPortfolioTable({ utmSource }: { utmSource: string }) {
  const apps = PORTFOLIO
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'More from KENSAURUS',
    itemListElement: apps.map((app, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: app.name,
      url: withUtm(app.href, utmSource),
      description: app.blurb,
    })),
  }

  return (
    <section aria-label="More from KENSAURUS" className="mt-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />
      <h2 className="mb-3 font-serif text-base font-semibold text-[var(--mushi-ink)]">
        More from KENSAURUS
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
        {apps.map((app) => (
          <li key={app.id}>
            <a
              href={withUtm(app.href, utmSource)}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-start gap-2.5 rounded-sm px-2 py-2.5 no-underline transition hover:bg-[color:color-mix(in_srgb,var(--mushi-vermillion)_8%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
            >
              <img
                src={app.icon}
                width={32}
                height={32}
                alt=""
                className="mt-0.5 h-8 w-8 shrink-0 rounded-sm object-cover"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--mushi-ink)]">{app.name}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-normal text-[var(--mushi-ink-muted)]">
                  {app.blurb}
                </span>
              </span>
            </a>
            {'extras' in app && app.extras ? (
              <p className="mt-1 pl-10 text-xs text-[var(--mushi-ink-muted)]">
                {app.extras.map((extra, i) => (
                  <span key={extra.href}>
                    {i > 0 ? ' · ' : null}
                    <a
                      href={extra.href}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-2 hover:text-[var(--mushi-vermillion)] hover:underline"
                    >
                      {extra.label}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
