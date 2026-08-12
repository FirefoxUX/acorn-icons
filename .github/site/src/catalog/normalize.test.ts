import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  camelToKebab,
  displayNameFor,
  parseIllustrationName,
  parseMobilePdf,
  parseSizedName,
  splitTheme,
} from './normalize.ts'

test('parseSizedName reads the desktop and mobile SVG scheme', () => {
  assert.deepEqual(parseSizedName('bookmark-16.svg'), {
    slug: 'bookmark',
    size: 16,
  })
  assert.deepEqual(parseSizedName('play-circle-fill-slash-12.svg'), {
    slug: 'play-circle-fill-slash',
    size: 12,
  })
  assert.deepEqual(parseSizedName('logo-firefox-24.svg'), {
    slug: 'logo-firefox',
    size: 24,
  })
})

test('parseSizedName reads the Android XML scheme', () => {
  assert.deepEqual(parseSizedName('ic_bookmark_24.xml'), {
    slug: 'bookmark',
    size: 24,
  })
  assert.deepEqual(parseSizedName('ic_app_menu_space_24.xml'), {
    slug: 'app-menu-space',
    size: 24,
  })
  assert.deepEqual(parseSizedName('ic_share_apple_24.xml'), {
    slug: 'share-apple',
    size: 24,
  })
})

test('parseSizedName only strips ic_ from names that carry it', () => {
  assert.deepEqual(parseSizedName('icon-thing-16.svg'), {
    slug: 'icon-thing',
    size: 16,
  })
})

test('parseSizedName tolerates a missing size suffix', () => {
  assert.deepEqual(parseSizedName('bookmark.svg'), { slug: 'bookmark' })
})

test('parseMobilePdf covers every iOS size word', () => {
  const cases: [string, string, number][] = [
    ['chevronDownExtraSmall.pdf', 'chevron-down', 8],
    ['checkmarkSmall.pdf', 'checkmark', 16],
    ['adBlockerCheckmarkMedium.pdf', 'ad-blocker-checkmark', 20],
    ['accessibilityLarge.pdf', 'accessibility', 24],
    ['crossCircleFillExtraLarge.pdf', 'cross-circle-fill', 30],
    [
      'privateModeCircleFillExtraExtraLarge.pdf',
      'private-mode-circle-fill',
      48,
    ],
    ['cloudExtraExtraExtraLarge.pdf', 'cloud', 72],
  ]
  for (const [filename, slug, size] of cases) {
    assert.deepEqual(
      parseMobilePdf(filename),
      { slug, size, variant: undefined },
      filename,
    )
  }
})

test('parseMobilePdf prefers the longest matching size word', () => {
  // `ExtraExtraExtraLarge` also ends in `ExtraLarge` and in `Large`.
  assert.equal(parseMobilePdf('cloudExtraExtraExtraLarge.pdf').size, 72)
  assert.equal(parseMobilePdf('tabGroupExtraLarge.pdf').size, 30)
})

test('parseMobilePdf splits the theme and colour tokens off', () => {
  assert.deepEqual(parseMobilePdf('lockSlashLargeDark.pdf'), {
    slug: 'lock-slash',
    size: 24,
    variant: 'dark',
  })
  assert.deepEqual(parseMobilePdf('starOneHalfFillMediumLight.pdf'), {
    slug: 'star-one-half-fill',
    size: 20,
    variant: 'light',
  })
  assert.deepEqual(parseMobilePdf('bookmarkBadgeFillMediumViolet50.pdf'), {
    slug: 'bookmark-badge-fill',
    size: 20,
    variant: 'violet-50',
  })
})

test('parseMobilePdf keeps a colour that follows the size word', () => {
  // The SVG spells this one `private-mode-circle-fill-purple-20.svg`, so the
  // colour has to come back as a token the caller can reattach.
  assert.deepEqual(parseMobilePdf('privateModeCircleFillMediumPurple.pdf'), {
    slug: 'private-mode-circle-fill',
    size: 20,
    variant: 'purple',
  })
})

test('camelToKebab separates the trailing numbers the SVG tree splits', () => {
  assert.equal(camelToKebab('kitRun1'), 'kit-run-1')
  assert.equal(camelToKebab('kitJumpHole2'), 'kit-jump-hole-2')
  assert.equal(camelToKebab('kitSeparateLookDown1'), 'kit-separate-look-down-1')
})

test('the three mobile schemes agree on one slug', () => {
  const svg = parseSizedName('bookmark-24.svg')
  const xml = parseSizedName('ic_bookmark_24.xml')
  const pdf = parseMobilePdf('bookmarkLarge.pdf')
  assert.equal(svg.slug, xml.slug)
  assert.equal(svg.slug, pdf.slug)
  assert.equal(svg.size, xml.size)
  assert.equal(svg.size, pdf.size)
})

test('parseIllustrationName handles all three casings', () => {
  assert.deepEqual(parseIllustrationName('kit-paw.svg'), { slug: 'kit-paw' })
  assert.deepEqual(parseIllustrationName('kit_paw.xml'), { slug: 'kit-paw' })
  assert.deepEqual(parseIllustrationName('kitPaw.pdf'), { slug: 'kit-paw' })
  assert.deepEqual(parseIllustrationName('kit_browser_dark.webp'), {
    slug: 'kit-browser',
    theme: 'dark',
  })
  assert.deepEqual(parseIllustrationName('kitAppStoreRatingDark.pdf'), {
    slug: 'kit-app-store-rating',
    theme: 'dark',
  })
  assert.deepEqual(parseIllustrationName('ill-feature-mozilla-vpn-light.svg'), {
    slug: 'ill-feature-mozilla-vpn',
    theme: 'light',
  })
})

test('parseIllustrationName tolerates the trailing space in the filename', () => {
  assert.deepEqual(parseIllustrationName('pic-envelope-open .svg'), {
    slug: 'pic-envelope-open',
  })
})

test('splitTheme leaves a slug that merely ends in a word alone', () => {
  assert.deepEqual(splitTheme('pic-lightning-bolt'), {
    slug: 'pic-lightning-bolt',
  })
})

test('camelToKebab keeps digit runs attached', () => {
  assert.equal(camelToKebab('starOneHalfFill'), 'star-one-half-fill')
  assert.equal(camelToKebab('shareMacos'), 'share-macos')
})

test('displayNameFor title-cases the slug', () => {
  assert.equal(displayNameFor('lock-slash-duotone'), 'Lock Slash Duotone')
})
