import { describe, expect, it } from 'vitest';
import {
  faviconUrlCandidates,
  githubRepoDomainHint,
  isUntrustedFaviconUrl,
  originToDomain,
  projectFaviconUrlCandidates,
  projectInitials,
  resolveProjectDomain,
  resolveProjectFaviconDomains,
} from './favicon';

describe('faviconUrlCandidates', () => {
  it('uses first-party assets only — no CDN globe fallbacks', () => {
    const urls = faviconUrlCandidates('example.com', 32);
    expect(urls[0]).toBe('https://example.com/favicon.svg');
    expect(urls.every((u) => u.startsWith('https://example.com/'))).toBe(true);
    expect(urls.some((u) => isUntrustedFaviconUrl(u))).toBe(false);
  });
});

describe('resolveProjectFaviconDomains', () => {
  it('prefers repo TLD over SDK parent host', () => {
    expect(
      resolveProjectFaviconDomains({
        project_id: '1',
        project_name: 'glot.it',
        project_slug: 'glot-it',
        sdk_origin: 'https://kensaur.us/glot-it/',
        repo_url: 'https://github.com/kensaurus/glot.it',
      }),
    ).toEqual(['glot.it']);
  });

  it('uses slug hint for solo-boss-cloud', () => {
    expect(
      resolveProjectFaviconDomains({
        project_id: '2',
        project_name: 'solo boss',
        project_slug: 'solo-boss-cloud',
        sdk_origin: 'https://kensaur.us/',
      }),
    ).toEqual(['sbc-front.vercel.app']);
  });

  it('skips kensaur.us for yen-yen native app — no domain, initials fallback', () => {
    expect(
      resolveProjectFaviconDomains({
        project_id: '3',
        project_name: 'yen-yen',
        project_slug: 'yen-yen',
        sdk_origin: 'https://kensaur.us/yen-yen/',
        repo_url: 'https://github.com/kensaurus/yen-yen',
      }),
    ).toEqual([]);
  });

  it('includes non-parent SDK origin when no slug/repo hint', () => {
    expect(
      resolveProjectFaviconDomains({
        project_id: '4',
        project_name: 'Acme',
        project_slug: 'acme',
        sdk_origin: 'https://app.example.com',
      }),
    ).toEqual(['app.example.com']);
  });
});

describe('resolveProjectDomain', () => {
  it('returns first favicon domain candidate', () => {
    expect(
      resolveProjectDomain({
        project_id: '2',
        project_name: 'glot.it',
        project_slug: 'glot-it',
        sdk_origin: 'http://localhost:3000',
        repo_url: 'https://github.com/kensaurus/glot.it',
      }),
    ).toBe('glot.it');
  });
});

describe('projectFaviconUrlCandidates', () => {
  it('prefers verified slug icon URL before domain paths', () => {
    const urls = projectFaviconUrlCandidates({
      project_id: '1',
      project_name: 'mushi',
      project_slug: 'mushi-mushi',
    });
    expect(urls[0]).toBe('https://kensaur.us/mushi-mushi/admin/favicon.svg');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('dedupes URLs across domains', () => {
    const urls = projectFaviconUrlCandidates({
      project_id: '2',
      project_name: 'solo boss',
      project_slug: 'solo-boss-cloud',
    });
    expect(urls[0]).toBe('https://sbc-front.vercel.app/favicon.svg');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('uses kensaur.us proxy for glot.it when TLD blocks hotlinking', () => {
    const urls = projectFaviconUrlCandidates({
      project_id: '3',
      project_name: 'glot.it',
      project_slug: 'glot-it',
    });
    expect(urls[0]).toBe('https://kensaur.us/glot-it/apple-touch-icon.png');
  });
});

describe('originToDomain', () => {
  it('rejects capacitor origins', () => {
    expect(originToDomain('capacitor://localhost')).toBeNull();
  });
});

describe('githubRepoDomainHint', () => {
  it('derives domain from repo slug when it looks like a TLD', () => {
    expect(githubRepoDomainHint('https://github.com/kensaurus/glot.it')).toBe('glot.it');
  });
});

describe('projectInitials', () => {
  it('uses first letters of two word names', () => {
    expect(projectInitials('solo boss')).toBe('SB');
  });
});
