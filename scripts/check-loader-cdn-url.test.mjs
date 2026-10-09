/**
 * Tests for scripts/check-loader-cdn-url.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAgreement, publishedWebVersion } from './check-loader-cdn-url.mjs'

const URL_1 = 'https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js'
const TSUP = `export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm', 'cjs'] },
  { entry: { 'mushi.loader': 'src/loader.ts' }, format: ['iife'], globalName: 'MushiLoader' },
])`
const good = () => ({
  pkg: {
    version: '1.28.0',
    jsdelivr: './dist/mushi.loader.global.js',
    unpkg: './dist/mushi.loader.global.js',
    files: ['dist', 'README.md'],
  },
  tsupConfig: TSUP,
  loaderSource: ` *   <script async\n *     src="${URL_1}"\n *     data-project="proj_xxx"></script>`,
  snippetsSource: `export const LOADER_CDN_URL =\n  '${URL_1}'`,
  otherUrls: [{ file: 'apps/docs/content/quickstart/web.mdx', url: URL_1 }],
})

test('the repo shape agrees', () => {
  assert.deepEqual(checkAgreement(good()), [])
})

test('a console URL pinned to the wrong major fails', () => {
  const input = good()
  input.snippetsSource = input.snippetsSource.replace('web@1/', 'web@2/')
  assert.match(checkAgreement(input).join('\n'), /LOADER_CDN_URL is .*web@2.*expected .*web@1/)
})

test('a major bump without updating the URLs fails', () => {
  const input = good()
  input.pkg.version = '2.0.0'
  const problems = checkAgreement(input).join('\n')
  assert.match(problems, /sdkSnippets\.ts: LOADER_CDN_URL/)
  assert.match(problems, /loader\.ts: example URL/)
  assert.match(problems, /web\.mdx: .* pins @1, but @mushi-mushi\/web is on major 2/)
})

test('jsdelivr and unpkg must name the same built IIFE file', () => {
  const input = good()
  input.pkg.unpkg = './dist/index.cjs'
  assert.match(checkAgreement(input).join('\n'), /jsdelivr .* and unpkg .* disagree/)

  const renamed = good()
  renamed.pkg.jsdelivr = renamed.pkg.unpkg = './dist/loader.global.js'
  assert.match(checkAgreement(renamed).join('\n'), /no entry named 'loader'/)

  const notIife = good()
  notIife.pkg.jsdelivr = notIife.pkg.unpkg = './dist/index.cjs'
  assert.match(checkAgreement(notIife).join('\n'), /not a tsup IIFE output/)
})

test('the file must be inside `files`', () => {
  const input = good()
  input.pkg.files = ['README.md']
  assert.match(checkAgreement(input).join('\n'), /"files" does not publish dist\/mushi\.loader\.global\.js/)
})

test('a doc URL naming another file fails; a bare or exact-version URL passes', () => {
  const input = good()
  input.otherUrls = [
    { file: 'README.md', url: 'https://unpkg.com/@mushi-mushi/web@1' },
    { file: 'README.md', url: 'https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1.28.0/dist/mushi.loader.global.js' },
    { file: 'docs/x.md', url: 'https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/index.global.js' },
  ]
  const problems = checkAgreement(input)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /docs\/x\.md: .* names dist\/index\.global\.js/)
})

test('publishedWebVersion reads changesets publishedPackages', () => {
  assert.equal(
    publishedWebVersion('[{"name":"@mushi-mushi/core","version":"1.28.1"},{"name":"@mushi-mushi/web","version":"1.28.1"}]'),
    '1.28.1',
  )
  assert.equal(publishedWebVersion('[{"name":"@mushi-mushi/web-extra","version":"1.0.0"}]'), null)
  assert.equal(publishedWebVersion(''), null)
  assert.throws(() => publishedWebVersion('{not json'), /not valid JSON/)
})
