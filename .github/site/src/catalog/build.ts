import {
  categoryFor,
  categoryLabel,
  categorySlug,
  knownCategories,
  MIN_CATEGORY_SIZE,
  MIN_CHIPS_PER_VIEW,
} from './categories.ts'
import {
  displayNameFor,
  isIllustrationCategory,
  parseIllustrationName,
  parseMobilePdf,
  parseSizedName,
} from './normalize.ts'
import { readDimensions, sanitizeSvg } from './sanitize.ts'
import { readJson, readText, scan, type ScannedFile } from './scan.ts'
import type {
  Asset,
  Catalog,
  CategoryView,
  Format,
  FormatKind,
  IllustrationCategory,
  Theme,
} from './types.ts'

type AliasMap = Record<string, string[]>

const aliases = readJson<AliasMap>('src/catalog/aliases.json')

let cached: Catalog | undefined

export function getCatalog(): Catalog {
  cached ??= buildCatalog()
  return cached
}

function toUrl(repoPath: string): string {
  return `assets/${repoPath}`
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function toFormat(
  file: ScannedFile,
  kind: FormatKind,
  variant?: string,
): Format {
  return {
    kind,
    repoPath: file.repoPath,
    url: toUrl(file.repoPath),
    bytes: file.bytes,
    variant,
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key)
  if (existing) {
    existing.push(value)
  } else {
    map.set(key, [value])
  }
}

function buildCatalog(): Catalog {
  const warnings: string[] = []
  const assets: Asset[] = [
    ...buildIcons(warnings),
    ...buildIllustrations(warnings),
  ]

  const byId = new Map(assets.map((asset) => [asset.id, asset]))

  // Siblings are every other asset with the same slug, which links the sizes of
  // an icon and the light and dark halves of an illustration pair.
  const families = new Map<string, Asset[]>()
  for (const asset of assets) {
    push(families, `${asset.kind}:${asset.slug}`, asset)
  }
  for (const family of families.values()) {
    for (const asset of family) {
      asset.siblings = family
        .filter((other) => other.id !== asset.id)
        .map((other) => other.id)
    }
  }

  for (const asset of assets) {
    asset.keywords = keywordsFor(asset)
  }
  warnings.push(...unusedAliases(assets))

  const icons = assets.filter((asset) => asset.kind === 'icon')
  const illustrations = assets.filter((asset) => asset.kind === 'illustration')
  const categoryViews = buildCategoryViews(icons)
  warnings.push(...unusedCategories(icons))

  for (const warning of warnings) {
    console.warn(`[catalog] ${warning}`)
  }

  return {
    assets,
    byId,
    icons,
    illustrations,
    iconSizes: {
      desktop: sizesFor(icons, 'desktop'),
      mobile: sizesFor(icons, 'mobile'),
    },
    categoryViews,
    warnings,
  }
}

/**
 * Categories are offered per size view rather than globally: a chip is only
 * useful if it narrows the page you are on, and the same category can be large
 * at 16px and absent at 40px.
 */
function buildCategoryViews(icons: Asset[]): CategoryView[] {
  const views: CategoryView[] = []

  for (const platform of ['desktop', 'mobile'] as const) {
    for (const size of sizesFor(icons, platform)) {
      const counts = new Map<string, number>()
      for (const icon of icons) {
        if (icon.platform !== platform || icon.size !== size || !icon.group) {
          continue
        }
        counts.set(icon.group, (counts.get(icon.group) ?? 0) + 1)
      }

      const qualifying = [...counts]
        .filter(([, count]) => count >= MIN_CATEGORY_SIZE)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

      if (qualifying.length < MIN_CHIPS_PER_VIEW) {
        continue
      }
      for (const [category, count] of qualifying) {
        views.push({
          platform,
          size,
          category,
          slug: categorySlug(category),
          label: categoryLabel(category),
          count,
        })
      }
    }
  }

  return views
}

function unusedCategories(icons: Asset[]): string[] {
  const used = new Set(icons.map((icon) => icon.group).filter(Boolean))
  const missing = knownCategories().filter((category) => !used.has(category))
  const uncategorized = icons.filter((icon) => !icon.group)

  const warnings = missing.map(
    (category) => `Category "${category}" matches no icon in the repository.`,
  )
  if (uncategorized.length > 0) {
    const desktop = uncategorized.filter((icon) => icon.platform === 'desktop')
    warnings.push(
      `${uncategorized.length} icons have no category (${desktop.length} desktop, ${uncategorized.length - desktop.length} mobile).`,
    )
  }
  return warnings
}

function sizesFor(icons: Asset[], platform: 'desktop' | 'mobile'): number[] {
  return [
    ...new Set(
      icons
        .filter((icon) => icon.platform === platform && icon.size !== undefined)
        .map((icon) => icon.size as number),
    ),
  ].sort((a, b) => a - b)
}

function buildIcons(warnings: string[]): Asset[] {
  const files = scan('icons')
  const assets: Asset[] = []

  // Every asset is anchored on an SVG, so collect those first and let the PDF
  // and XML files attach to whichever anchor exists.
  const anchors = new Map<string, Asset>()

  for (const file of files) {
    if (file.ext !== '.svg') {
      continue
    }

    const [platform, sizeSegment, formatDir] = file.segments
    const isDesktop = platform === 'desktop' && file.segments.length === 3
    const isMobile =
      platform === 'mobile' && file.segments.length === 4 && formatDir === 'svg'
    if (!isDesktop && !isMobile) {
      continue
    }

    const size = Number(sizeSegment)
    const { slug } = parseSizedName(file.filename)
    const source = readText(file.absPath)
    const { width, height } = readDimensions(source)
    const id = `icon-${platform}-${size}-${slug}`

    const asset: Asset = {
      id,
      kind: 'icon',
      platform: platform as 'desktop' | 'mobile',
      slug,
      displayName: displayNameFor(slug),
      size,
      width,
      height,
      group: categoryFor(slug, size),
      // Downloads for desktop are SVG only.
      formats: [toFormat(file, 'svg')],
      inlineSvg: sanitizeSvg(source, id),
      rawSvg: source,
      keywords: [],
      siblings: [],
    }
    assets.push(asset)
    if (isMobile) {
      anchors.set(`${size}:${slug}`, asset)
    }
  }

  for (const file of files) {
    const [platform, sizeSegment, formatDir] = file.segments
    if (platform !== 'mobile' || file.segments.length !== 4) {
      continue
    }
    const size = Number(sizeSegment)

    let slugs: string[]
    let kind: FormatKind
    let variant: string | undefined

    if (formatDir === 'pdf' && file.ext === '.pdf') {
      const parsed = parseMobilePdf(file.filename)
      if (parsed.size !== undefined && parsed.size !== size) {
        warnings.push(
          `${file.repoPath} spells its size as ${parsed.size} but sits in the ${size} folder; matching on the folder.`,
        )
      }
      kind = 'pdf'
      variant = parsed.variant
      // `privateModeCircleFillMediumPurple.pdf` keeps its colour after the size
      // word, where the SVG carries it in the name as
      // `private-mode-circle-fill-purple-20.svg`. Try the more specific slug
      // first so the colour variant does not attach to the plain icon.
      slugs = parsed.variant
        ? [`${parsed.slug}-${parsed.variant}`, parsed.slug]
        : [parsed.slug]
    } else if (formatDir === 'xml' && file.ext === '.xml') {
      kind = 'xml'
      slugs = [parseSizedName(file.filename).slug]
    } else {
      continue
    }

    const anchor = slugs
      .map((slug) => anchors.get(`${size}:${slug}`))
      .find(Boolean)
    if (!anchor) {
      warnings.push(
        `No mobile SVG at size ${size} anchors ${file.repoPath}; this format is not listed.`,
      )
      continue
    }
    anchor.formats.push(
      toFormat(file, kind, anchor.slug === slugs[0] ? undefined : variant),
    )
  }

  return assets
}

function buildIllustrations(warnings: string[]): Asset[] {
  const files = scan('illustrations')

  type Key = string
  const svgs = new Map<
    Key,
    {
      category: IllustrationCategory
      slug: string
      theme?: Theme
      desktop?: ScannedFile
      mobile?: ScannedFile
    }
  >()
  const extras = new Map<Key, { file: ScannedFile; kind: FormatKind }[]>()

  for (const file of files) {
    const [platform] = file.segments
    const isDesktop = platform === 'desktop' && file.segments.length === 3
    const isMobile = platform === 'mobile' && file.segments.length === 4
    if (!isDesktop && !isMobile) {
      continue
    }

    const formatDir = isDesktop ? 'svg' : file.segments[1]
    const category = isDesktop ? file.segments[1] : file.segments[2]
    if (!isIllustrationCategory(category)) {
      continue
    }

    const { slug, theme } = parseIllustrationName(file.filename)
    const key = `${category}:${slug}:${theme ?? ''}`

    if (formatDir === 'svg' && file.ext === '.svg') {
      const entry = svgs.get(key) ?? { category, slug, theme }
      if (isDesktop) {
        entry.desktop = file
      } else {
        entry.mobile = file
      }
      svgs.set(key, entry)
    } else if (['pdf', 'webp', 'xml'].includes(formatDir)) {
      push(extras, key, { file, kind: formatDir as FormatKind })
    }
  }

  const assets: Asset[] = []
  for (const [key, entry] of svgs) {
    // The desktop tree and `mobile/svg` hold byte-identical copies, so a slug
    // present in both is one platform-neutral asset rather than two.
    const anchor = entry.desktop ?? entry.mobile
    if (!anchor) {
      continue
    }
    const platform =
      entry.desktop && entry.mobile
        ? 'shared'
        : entry.desktop
          ? 'desktop'
          : 'mobile'

    const { width, height } = readDimensions(readText(anchor.absPath))
    const themeSuffix = entry.theme ? `-${entry.theme}` : ''
    const id = `illustration-${entry.category}-${entry.slug}${themeSuffix}`

    const formats: Format[] = [toFormat(anchor, 'svg')]
    for (const extra of extras.get(key) ?? []) {
      formats.push(toFormat(extra.file, extra.kind))
    }

    assets.push({
      id,
      kind: 'illustration',
      platform,
      slug: entry.slug,
      displayName: displayNameFor(entry.slug),
      category: entry.category,
      theme: entry.theme,
      width,
      height,
      formats,
      previewUrl: toUrl(anchor.repoPath),
      keywords: [],
      siblings: [],
    })
  }

  for (const [key, entryExtras] of extras) {
    if (!svgs.has(key)) {
      warnings.push(
        `No illustration SVG anchors ${entryExtras.map((extra) => extra.file.repoPath).join(', ')}; these formats are not listed.`,
      )
    }
  }

  for (const asset of assets) {
    if (!asset.theme) {
      continue
    }
    const counterpart = asset.theme === 'light' ? 'dark' : 'light'
    const hasCounterpart = assets.some(
      (other) =>
        other.slug === asset.slug &&
        other.category === asset.category &&
        other.theme === counterpart,
    )
    if (!hasCounterpart) {
      warnings.push(
        `${asset.id} has no ${counterpart} counterpart in the SVG tree.`,
      )
    }
  }

  return assets.sort((a, b) => a.id.localeCompare(b.id))
}

function aliasesFor(slug: string): string[] {
  const padded = ` ${slug.replace(/-/g, ' ')} `
  const found: string[] = []

  for (const [key, values] of Object.entries(aliases)) {
    if (key.startsWith('_')) {
      continue
    }
    if (key.endsWith('*')) {
      if (slug.startsWith(key.slice(0, -1))) {
        found.push(...values)
      }
    } else if (padded.includes(` ${key.replace(/-/g, ' ')} `)) {
      found.push(...values)
    }
  }

  return found
}

function keywordsFor(asset: Asset): string[] {
  const words = [
    ...asset.slug.split('-'),
    ...aliasesFor(asset.slug).flatMap((alias) => alias.split('-')),
    // Every icon contributes its category, including the many groups too small
    // to earn a filter chip, so "paperclip" or "webserial" is still findable.
    ...(asset.group?.split(/[^a-z0-9]+/i) ?? []),
    asset.kind,
    asset.platform,
    asset.category,
    asset.theme,
    asset.size?.toString(),
  ].filter((word): word is string => Boolean(word))

  return [...new Set(words.map((word) => word.toLowerCase()))]
}

function unusedAliases(assets: Asset[]): string[] {
  const slugs = assets.map((asset) => asset.slug)
  return Object.keys(aliases)
    .filter((key) => !key.startsWith('_'))
    .filter((key) =>
      key.endsWith('*')
        ? !slugs.some((slug) => slug.startsWith(key.slice(0, -1)))
        : !slugs.some((slug) =>
            ` ${slug.replace(/-/g, ' ')} `.includes(
              ` ${key.replace(/-/g, ' ')} `,
            ),
          ),
    )
    .map((key) => `Alias key "${key}" matches no asset.`)
}
