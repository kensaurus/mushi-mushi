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
  it('prefers the repo TLD over an SDK origin mounted under a path', () => {
    expect(
      resolveProjectFaviconDomains({
        project_id: '1',
        project_name: 'Lingo',
        project_slug: 'lingo',
        sdk_origin: 'https://apps.example.com/lingo/',
        repo_url: 'https://github.com/acme/lingo.app',
      }),
    ).toEqual(['lingo.app']);
  });

  it('skips a host the app shares under a path: initials instead of the parent site icon', () => {
    expect(
      resolveProjectFaviconDomains({
        project_id: '3',
        project_name: 'Coins',
        project_slug: 'coins',
        sdk_origin: 'https://apps.example.com/coins/',
        repo_url: 'https://github.com/acme/coins',
      }),
    ).toEqual([]);
  });

  it('skips a configured shared host, with or without www', () => {
    const base = { project_id: '5', project_name: 'Board', project_slug: 'board', shared_hosts: ['apps.example.com'] };
    expect(resolveProjectFaviconDomains({ ...base, sdk_origin: 'https://apps.example.com' })).toEqual([]);
    expect(resolveProjectFaviconDomains({ ...base, sdk_origin: 'https://www.apps.example.com' })).toEqual([]);
    expect(resolveProjectFaviconDomains({ ...base, sdk_origin: 'https://board.example.com' })).toEqual(['board.example.com']);
  });

  it('never special-cases a slug: two projects with the same data resolve the same', () => {
    const data = { project_id: 'x', project_name: 'X', sdk_origin: 'https://x.example.com' };
    expect(resolveProjectFaviconDomains({ ...data, project_slug: 'mushi-mushi' })).toEqual(
      resolveProjectFaviconDomains({ ...data, project_slug: 'anything-else' }),
    );
  });

  it('includes a root SDK origin when no repo hint', () => {
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
        project_name: 'Lingo',
        project_slug: 'lingo',
        sdk_origin: 'http://localhost:3000',
        repo_url: 'https://github.com/acme/lingo.app',
      }),
    ).toBe('lingo.app');
  });
});

describe('projectFaviconUrlCandidates', () => {
  it('uses the app icon (projects.icon_url) alone when set', () => {
    expect(
      projectFaviconUrlCandidates({ project_id: '1', project_name: 'A', project_slug: 'a', icon_url: 'https://cdn.example.com/a.png', sdk_origin: 'https://a.example.com' }),
    ).toEqual(['https://cdn.example.com/a.png']);
  });

  it('lists first-party paths per domain, deduped', () => {
    const urls = projectFaviconUrlCandidates({
      project_id: '2',
      project_name: 'Board',
      project_slug: 'board',
      sdk_origin: 'https://board.example.com',
      repo_url: 'https://github.com/acme/board.example.com',
    });
    expect(urls[0]).toBe('https://board.example.com/favicon.svg');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('has nothing to try for an app mounted under a shared host path', () => {
    expect(projectFaviconUrlCandidates({ project_id: '3', project_name: 'C', project_slug: 'c', sdk_origin: 'https://apps.example.com/c/' })).toEqual([]);
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
