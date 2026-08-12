import type { IllustrationCategory, Theme } from './types.ts'

/**
 * Sizes are spelled out rather than written as digits in the iOS PDF names.
 * Ordered longest first so `ExtraExtraExtraLarge` is matched before
 * `ExtraLarge`.
 */
const MOBILE_PDF_SIZE_WORDS: [string, number][] = [
  ['ExtraExtraExtraLarge', 72],
  ['ExtraExtraLarge', 48],
  ['ExtraLarge', 30],
  ['ExtraSmall', 8],
  ['Large', 24],
  ['Medium', 20],
  ['Small', 16],
]

/**
 * The digit boundary matters because the SVG trees separate trailing numbers,
 * as in `kit-run-1.svg`, while the iOS PDFs glue them on as `kitRun1.pdf`.
 */
export function camelToKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase()
}

function snakeToKebab(name: string): string {
  return name.replace(/_/g, '-').toLowerCase()
}

/** Collapses repeated separators and drops leading or trailing ones. */
function tidy(slug: string): string {
  return slug.replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

/** Splits a trailing `-light` or `-dark` off a kebab slug. */
export function splitTheme(slug: string): { slug: string; theme?: Theme } {
  const match = slug.match(/^(.*)-(light|dark)$/)
  if (!match) {
    return { slug }
  }
  return { slug: match[1], theme: match[2] as Theme }
}

/**
 * `bookmark-16.svg` and `ic_bookmark_24.xml` both give `bookmark`. The `ic_`
 * prefix is only stripped from the Android XML names that actually carry it, so
 * an icon whose own name begins with `ic-` would survive.
 */
export function parseSizedName(filename: string): {
  slug: string
  size?: number
} {
  const trimmed = stripExtension(filename).trim()
  const base = tidy(
    snakeToKebab(trimmed.startsWith('ic_') ? trimmed.slice(3) : trimmed),
  )
  const match = base.match(/^(.*)-(\d+)$/)
  if (!match) {
    return { slug: base }
  }
  return { slug: tidy(match[1]), size: Number(match[2]) }
}

/**
 * The iOS PDFs are camelCase with the size spelled out and an optional theme or
 * colour token after it, as in `lockSlashLargeDark` or
 * `bookmarkBadgeFillMediumViolet50`. Parsing backwards from the end is more
 * reliable than trying to reconstruct the name from a slug, so the returned
 * `size` is only used to flag files sitting in the wrong folder. The folder is
 * authoritative.
 */
export function parseMobilePdf(filename: string): {
  slug: string
  size?: number
  variant?: string
} {
  let base = stripExtension(filename).trim()
  let variant: string | undefined

  const theme = base.match(/(Dark|Light)$/)
  if (theme) {
    variant = theme[1].toLowerCase()
    base = base.slice(0, -theme[1].length)
  }

  // The size word is usually last, but `privateModeCircleFillMediumPurple` puts
  // a colour after it. Match on the latest ending position so a trailing token
  // does not hide the size, and break ties on length so `ExtraExtraLarge` wins
  // over the `ExtraLarge` nested inside it.
  const candidates = MOBILE_PDF_SIZE_WORDS.map(([word, size]) => {
    const index = base.lastIndexOf(word)
    return { word, size, index, end: index + word.length }
  })
    .filter((candidate) => candidate.index >= 0)
    .sort((a, b) => b.end - a.end || b.word.length - a.word.length)

  const best = candidates[0]
  if (!best) {
    return { slug: tidy(camelToKebab(base)), variant }
  }

  const trailing = base.slice(best.end)
  if (trailing) {
    variant = [camelToKebab(trailing), variant].filter(Boolean).join('-')
  }
  return {
    slug: tidy(camelToKebab(base.slice(0, best.index))),
    size: best.size,
    variant,
  }
}

/**
 * Illustration filenames arrive in all three casings: kebab in the SVG trees,
 * snake_case in `webp` and `xml`, camelCase in `pdf`.
 */
export function parseIllustrationName(filename: string): {
  slug: string
  theme?: Theme
} {
  const base = stripExtension(filename).trim()
  const kebab = base.includes('_')
    ? snakeToKebab(base)
    : /[A-Z]/.test(base)
      ? camelToKebab(base)
      : base.toLowerCase()
  return splitTheme(tidy(kebab))
}

export function displayNameFor(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export const ILLUSTRATION_CATEGORIES: IllustrationCategory[] = [
  'kit',
  'pictograms',
  'exports',
]

export function isIllustrationCategory(
  value: string,
): value is IllustrationCategory {
  return (ILLUSTRATION_CATEGORIES as string[]).includes(value)
}
