import { readRepoJson } from './scan.ts'

type Category = {
  /** Chip text. Defaults to the capitalized category name. */
  label?: string
  /** Slugs, each optionally suffixed `-<size>`. */
  icons: string[]
}

type CategoriesFile = {
  categories: Record<string, Category>
}

const file = readRepoJson<CategoriesFile>('icons/categories.json')

/**
 * How many icons a category needs within one size view before it earns a filter
 * chip. Three keeps the busiest view, desktop 16, at a usable number of chips
 * while still covering the groups worth filtering by. Raise it to show fewer.
 */
export const MIN_CATEGORY_SIZE = 3

/**
 * A single chip is not a filter, it is a detour, so the row only appears once
 * this many categories qualify.
 */
export const MIN_CHIPS_PER_VIEW = 2

/**
 * A few icons are categorized per size rather than per icon: the 12px
 * `bookmark-fill` is a badge, the 16px one is a bookmark. A bare slug covers
 * every size, and a `<slug>-<size>` entry overrides it for that one size.
 */
const { exact, bySlug } = buildLookup()

function buildLookup(): {
  exact: Map<string, string>
  bySlug: Map<string, string>
} {
  const exact = new Map<string, string>()
  const bySlug = new Map<string, string>()

  for (const [category, body] of Object.entries(file.categories)) {
    for (const entry of body.icons) {
      if (/-\d+$/.test(entry)) {
        exact.set(entry, category)
      } else {
        bySlug.set(entry, category)
      }
    }
  }
  return { exact, bySlug }
}

export function categoryFor(slug: string, size?: number): string | undefined {
  if (size !== undefined) {
    const sized = exact.get(`${slug}-${size}`)
    if (sized) {
      return sized
    }
  }
  return bySlug.get(slug)
}

export function categorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function categoryLabel(category: string): string {
  return (
    file.categories[category]?.label ??
    category.charAt(0).toUpperCase() + category.slice(1)
  )
}

export function knownCategories(): string[] {
  return Object.keys(file.categories)
}
