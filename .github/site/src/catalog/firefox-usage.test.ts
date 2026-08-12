import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  matchAsset,
  parseSearchfoxPaths,
  parseSwiftIdentifiers,
  type FirefoxIndex,
} from './firefox-usage.ts'
import type { Asset, Format } from './types.ts'

function index(overrides: Partial<FirefoxIndex> = {}): FirefoxIndex {
  return {
    desktopPaths: new Map(),
    desktopSizes: new Map(),
    androidPaths: new Map(),
    iosSymbols: new Map(),
    ...overrides,
  }
}

function format(kind: Format['kind'], repoPath: string): Format {
  return { kind, repoPath, url: repoPath, bytes: 0 }
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'icon-desktop-16-bookmark',
    kind: 'icon',
    platform: 'desktop',
    slug: 'bookmark',
    displayName: 'Bookmark',
    size: 16,
    width: 16,
    height: 16,
    formats: [format('svg', 'icons/desktop/16/bookmark-16.svg')],
    keywords: [],
    siblings: [],
    ...overrides,
  }
}

test('parseSearchfoxPaths reads a path search', () => {
  const body = JSON.stringify({
    normal: {
      Files: [
        { path: 'browser/themes/shared/icons/bookmark.svg' },
        { path: 'toolkit/themes/shared/icons/heart.svg' },
      ],
    },
    '*limits*': [],
  })
  assert.deepEqual(parseSearchfoxPaths(body), [
    'browser/themes/shared/icons/bookmark.svg',
    'toolkit/themes/shared/icons/heart.svg',
  ])
})

test('parseSearchfoxPaths reads groups other than Files', () => {
  // A text query returns "Textual Occurrences", and the heading varies with the
  // query, so no group name may be hardcoded.
  const body = JSON.stringify({
    normal: {
      'Textual Occurrences': [{ path: 'browser/themes/shared/icons/back.svg' }],
    },
    '*limits*': [],
  })
  assert.deepEqual(parseSearchfoxPaths(body), [
    'browser/themes/shared/icons/back.svg',
  ])
})

test('parseSearchfoxPaths deduplicates a path hit in several groups', () => {
  const body = JSON.stringify({
    normal: {
      Files: [{ path: 'a/b.svg' }],
      'Textual Occurrences': [{ path: 'a/b.svg' }],
    },
    '*limits*': [],
  })
  assert.deepEqual(parseSearchfoxPaths(body), ['a/b.svg'])
})

test('parseSearchfoxPaths rejects a truncated response', () => {
  const body = JSON.stringify({
    normal: { Files: [{ path: 'a/b.svg' }] },
    '*limits*': ['file', 'result count limit'],
  })
  assert.throws(() => parseSearchfoxPaths(body), /truncated/)
})

test('parseSwiftIdentifiers qualifies each constant with its struct', () => {
  const source = `
public struct StandardImageIdentifiers {
    // Icon size 8x8
    public struct ExtraSmall {
        public static let chevronDown = "chevronDownExtraSmall"
    }

    public struct Large {
        public static let bookmark = "bookmarkLarge"
    }
}
`
  const symbols = parseSwiftIdentifiers(source)
  assert.equal(
    symbols.get('chevronDownExtraSmall'),
    'StandardImageIdentifiers.ExtraSmall.chevronDown',
  )
  assert.equal(
    symbols.get('bookmarkLarge'),
    'StandardImageIdentifiers.Large.bookmark',
  )
})

test('parseSwiftIdentifiers keeps its depth across a closing brace', () => {
  // The struct that follows a closed one must not inherit its name.
  const source = `
public struct Root {
    public struct First {
        public static let a = "aFirst"
    }
    public struct Second {
        public static let b = "bSecond"
    }
}
`
  const symbols = parseSwiftIdentifiers(source)
  assert.equal(symbols.get('aFirst'), 'Root.First.a')
  assert.equal(symbols.get('bSecond'), 'Root.Second.b')
})

test('matchAsset links a desktop icon whose in-tree name kept the size', () => {
  const usage = matchAsset(
    asset(),
    index({
      desktopPaths: new Map([
        ['bookmark-16.svg', ['browser/themes/shared/icons/bookmark-16.svg']],
      ]),
    }),
  )
  assert.deepEqual(usage, [
    {
      product: 'desktop',
      path: 'browser/themes/shared/icons/bookmark-16.svg',
      href: 'https://searchfox.org/firefox-main/source/browser/themes/shared/icons/bookmark-16.svg',
    },
  ])
})

test('matchAsset links an unsized in-tree name of the same size', () => {
  const usage = matchAsset(
    asset(),
    index({
      desktopPaths: new Map([
        ['bookmark.svg', ['browser/themes/shared/icons/bookmark.svg']],
      ]),
      desktopSizes: new Map([['browser/themes/shared/icons/bookmark.svg', 16]]),
    }),
  )
  assert.equal(usage.length, 1)
  assert.equal(usage[0].path, 'browser/themes/shared/icons/bookmark.svg')
})

test('matchAsset rejects an unsized in-tree name of another size', () => {
  // The only in-tree `heart.svg` is 16px, so the 12px and 20px acorn icons of
  // that name must not claim it.
  const heart = index({
    desktopPaths: new Map([
      ['heart.svg', ['toolkit/themes/shared/icons/heart.svg']],
    ]),
    desktopSizes: new Map([['toolkit/themes/shared/icons/heart.svg', 16]]),
  })
  const at = (size: number) =>
    matchAsset(
      asset({
        size,
        slug: 'heart',
        formats: [format('svg', `icons/desktop/${size}/heart-${size}.svg`)],
      }),
      heart,
    )
  assert.deepEqual(at(12), [])
  assert.deepEqual(at(20), [])
  assert.equal(at(16).length, 1)
})

test('matchAsset does not read a trailing number as a size', () => {
  // `kit-run-1.svg` has no size, so stripping the trailing digits would send it
  // looking for an unrelated `kit-run.svg`.
  const usage = matchAsset(
    asset({
      kind: 'illustration',
      platform: 'shared',
      slug: 'kit-run-1',
      size: undefined,
      formats: [format('svg', 'illustrations/desktop/kit/kit-run-1.svg')],
    }),
    index({
      desktopPaths: new Map([
        ['kit-run.svg', ['browser/base/content/kit-run.svg']],
      ]),
    }),
  )
  assert.deepEqual(usage, [])
})

test('matchAsset prefers the themes copy and caps the list', () => {
  const usage = matchAsset(
    asset({
      formats: [format('svg', 'icons/desktop/16/back-16.svg')],
      slug: 'back',
    }),
    index({
      desktopPaths: new Map([
        [
          'back.svg',
          [
            'devtools/client/themes/images/back.svg',
            'toolkit/themes/shared/narrate/back.svg',
            'browser/themes/shared/icons/back.svg',
          ],
        ],
      ]),
      desktopSizes: new Map([
        ['devtools/client/themes/images/back.svg', 16],
        ['toolkit/themes/shared/narrate/back.svg', 16],
        ['browser/themes/shared/icons/back.svg', 16],
      ]),
    }),
  )
  assert.deepEqual(
    usage.map((entry) => entry.path),
    [
      'browser/themes/shared/icons/back.svg',
      'toolkit/themes/shared/narrate/back.svg',
      'devtools/client/themes/images/back.svg',
    ],
  )
})

test('matchAsset prefixes an Android drawable', () => {
  const usage = matchAsset(
    asset({
      platform: 'mobile',
      size: 24,
      formats: [format('xml', 'icons/mobile/24/xml/ic_bookmark_24.xml')],
    }),
    index({
      androidPaths: new Map([
        [
          'mozac_ic_bookmark_24.xml',
          ['mobile/android/a/res/drawable/mozac_ic_bookmark_24.xml'],
        ],
      ]),
    }),
  )
  assert.deepEqual(usage, [
    {
      product: 'android',
      path: 'mobile/android/a/res/drawable/mozac_ic_bookmark_24.xml',
      href: 'https://searchfox.org/firefox-main/source/mobile/android/a/res/drawable/mozac_ic_bookmark_24.xml',
    },
  ])
})

test('matchAsset resolves every iOS PDF variant of one asset', () => {
  const usage = matchAsset(
    asset({
      platform: 'mobile',
      size: 24,
      formats: [
        format('pdf', 'icons/mobile/24/pdf/avatarLargeDark.pdf'),
        format('pdf', 'icons/mobile/24/pdf/avatarLargeLight.pdf'),
      ],
    }),
    index({
      iosSymbols: new Map([
        ['avatarLargeDark', 'StandardImageIdentifiers.Large.avatarDark'],
        ['avatarLargeLight', 'StandardImageIdentifiers.Large.avatarLight'],
      ]),
    }),
  )
  assert.deepEqual(
    usage.map((entry) => entry.symbol),
    [
      'StandardImageIdentifiers.Large.avatarDark',
      'StandardImageIdentifiers.Large.avatarLight',
    ],
  )
})

test('matchAsset keeps a mobile icon out of the desktop list', () => {
  // Desktop and mobile share filenames at 16 and 20px, and an in-tree desktop
  // file is not evidence that the mobile asset ships.
  const usage = matchAsset(
    asset({
      platform: 'mobile',
      formats: [format('svg', 'icons/mobile/16/svg/bookmark-16.svg')],
    }),
    index({
      desktopPaths: new Map([
        ['bookmark-16.svg', ['browser/themes/shared/icons/bookmark-16.svg']],
      ]),
    }),
  )
  assert.deepEqual(usage, [])
})
