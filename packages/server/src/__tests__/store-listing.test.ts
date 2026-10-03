/**
 * `_shared/store-listing.ts` — listings as code (Plan 020 §5.2): fastlane
 * metadata parsing, repo-vs-live drift, missing languages, store limits and
 * the `store` manifest block.
 */
import { describe, expect, it } from 'vitest'
import {
  checkListingLimits,
  compareListing,
  normalizeListingText,
  parseFastlaneMetadata,
  storeManifestBlockSchema,
} from '../../supabase/functions/_shared/store-listing.ts'

const FILES: Record<string, string> = {
  'fastlane/metadata/en-US/name.txt': 'glot.it\n',
  'fastlane/metadata/en-US/subtitle.txt': 'Learn Thai, one sign at a time\n',
  'fastlane/metadata/en-US/description.txt': 'Learn to read Thai.\r\nShort daily lessons.\n',
  'fastlane/metadata/en-US/keywords.txt': 'thai,learn,language',
  'fastlane/metadata/ja/name.txt': 'glot.it',
  'fastlane/metadata/review_information/notes.txt': 'not a locale',
  'fastlane/metadata/android/en-US/title.txt': 'glot.it – Learn Thai',
  'fastlane/metadata/android/en-US/short_description.txt': 'Read Thai in minutes a day.',
  'fastlane/metadata/android/en-US/full_description.txt': 'Learn to read Thai.',
  'fastlane/metadata/android/en-US/images/phoneScreenshots/1.png': 'binary',
  'src/app.ts': 'ignored',
}

describe('parseFastlaneMetadata', () => {
  it('reads iOS and Android fields per locale and skips non-locale folders and images', () => {
    const l = parseFastlaneMetadata(FILES)
    expect(Object.keys(l.ios).sort()).toEqual(['en-US', 'ja'])
    expect(l.ios['en-US']).toMatchObject({ name: 'glot.it\n', keywords: 'thai,learn,language', promotionalText: null })
    expect(l.android['en-US']).toMatchObject({ title: 'glot.it – Learn Thai', video: null })
  })

  it('honours a custom listing dir', () => {
    const l = parseFastlaneMetadata({ 'store/meta/en-US/name.txt': 'x' }, 'store/meta/')
    expect(l.ios['en-US'].name).toBe('x')
  })
})

describe('checkListingLimits', () => {
  it('flags a field over the store limit with the file to edit', () => {
    const l = parseFastlaneMetadata({ ...FILES, 'fastlane/metadata/en-US/subtitle.txt': 'x'.repeat(31), 'fastlane/metadata/android/en-US/short_description.txt': 'y'.repeat(81) })
    const r = checkListingLimits(l)
    expect(r.state).toBe('finding')
    expect(r.findings.map((f) => f.filePath).sort()).toEqual(['fastlane/metadata/android/en-US/short_description.txt', 'fastlane/metadata/en-US/subtitle.txt'])
  })

  it('counts characters, not bytes, and reads unknown with no listing', () => {
    const l = parseFastlaneMetadata({ 'fastlane/metadata/ja/name.txt': 'あ'.repeat(30) })
    expect(checkListingLimits(l).state).toBe('ok')
    expect(checkListingLimits({ ios: {}, android: {} }).state).toBe('unknown')
  })
})

describe('compareListing', () => {
  const repo = parseFastlaneMetadata(FILES)

  it('reports drift per differing field and languages missing either way', () => {
    const [drift, missing] = compareListing(repo, {
      ios: { 'en-US': { name: 'glot.it', subtitle: 'Learn Thai fast', description: 'Learn to read Thai. Short daily lessons.' }, 'th': { name: 'glot.it' } },
      android: { 'en-US': { title: 'glot.it – Learn Thai', shortDescription: 'Read Thai in minutes a day.', fullDescription: 'Learn to read Thai.' } },
    })
    expect(drift.state).toBe('finding')
    expect(drift.findings.map((f) => f.target).sort()).toEqual(['ios:en-US:description', 'ios:en-US:subtitle'])
    expect(missing.findings.map((f) => [f.target, f.severity])).toEqual([['ios:ja', 'warn'], ['ios:th', 'info']])
  })

  it('treats whitespace and line endings as equal', () => {
    expect(normalizeListingText('a  b\r\n c\n')).toBe(normalizeListingText('a b\nc'))
    const [drift] = compareListing(parseFastlaneMetadata({ 'fastlane/metadata/en-US/name.txt': 'glot.it \n' }), { ios: { 'en-US': { name: 'glot.it' } }, android: null })
    expect(drift.state).toBe('ok')
  })

  it('reads unknown, never in sync, when the live listing could not be read', () => {
    const [drift, missing] = compareListing(repo, { ios: null, android: null })
    expect([drift.state, missing.state]).toEqual(['unknown', 'unknown'])
  })
})

describe('storeManifestBlockSchema', () => {
  it('accepts the documented block and keeps unknown keys', () => {
    const r = storeManifestBlockSchema.safeParse({ listingDir: 'fastlane/metadata', ios: { bundleId: 'com.x', appleId: '123' }, android: { package: 'com.x' }, locales: ['en-US', 'ja'], brandName: 'X', privacyUrl: 'https://x.test/privacy', future: 1 })
    expect(r.success).toBe(true)
    expect(r.success && (r.data as Record<string, unknown>).future).toBe(1)
    expect(storeManifestBlockSchema.safeParse({ locales: 'en-US' }).success).toBe(false)
  })
})
