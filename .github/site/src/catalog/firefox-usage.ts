/**
 * Finds the in-tree counterparts of an acorn asset by filename.
 *
 * Firefox renames these files on import, differently per product, so the match
 * is per product and never complete. Nothing here may fail the build: on a
 * network error, a timeout or an unreadable response the affected source
 * contributes nothing and the detail page renders without the section.
 *
 * `SITE_SKIP_UPSTREAM=1` skips the lookup entirely.
 */

import { fetchText } from './upstream.ts'

import { getCatalog } from './build.ts'
import type { Asset } from './types.ts'

export type FirefoxProduct = 'desktop' | 'android' | 'ios'

export type FirefoxUsage = {
  product: FirefoxProduct
  /** In-tree path, or the declaring Swift file for iOS. */
  path: string
  href: string
  /** Set for iOS only, such as `StandardImageIdentifiers.Large.bookmark`. */
  symbol?: string
}

export type FirefoxIndex = {
  /** Desktop SVG basename to the in-tree paths carrying it. */
  desktopPaths: Map<string, string[]>
  /** In-tree path to the square viewBox size read from its source. */
  desktopSizes: Map<string, number>
  /** Android drawable basename to the in-tree paths carrying it. */
  androidPaths: Map<string, string[]>
  /** Maps an iOS asset identifier to the qualified Swift constant naming it. */
  iosSymbols: Map<string, string>
}

const SEARCHFOX = process.env.SEARCHFOX_BASE_URL ?? 'https://searchfox.org'
const SEARCHFOX_REPO = 'firefox-main'

const IOS_REPO = 'mozilla-mobile/firefox-ios'
const IOS_IDENTIFIERS_PATH =
  'BrowserKit/Sources/Common/Constants/StandardImageIdentifiers.swift'

/**
 * Enumerated rather than discovered, because a query broad enough to cover the
 * whole tree comes back truncated. These are the directories desktop ships
 * icons from; anything imported elsewhere goes unfound.
 */
const DESKTOP_GLOBS = [
  'browser/themes/**/*.svg',
  'toolkit/themes/**/*.svg',
  'browser/components/**/*.svg',
  'toolkit/components/**/*.svg',
  'browser/extensions/**/*.svg',
  'browser/base/**/*.svg',
  'devtools/**/*.svg',
]

const ANDROID_GLOB = 'mobile/android/**/drawable/*.xml'

/** Android Components namespaces every drawable it vendors from acorn. */
const ANDROID_PREFIX = 'mozac_'

/** Preferred first, so the canonical copy of a name leads the list. */
const PATH_PRIORITY = ['browser/themes/', 'toolkit/themes/']

const MAX_PATHS_PER_PRODUCT = 5

let pending: Promise<Map<string, FirefoxUsage[]>> | undefined

export function getFirefoxUsage(): Promise<Map<string, FirefoxUsage[]>> {
  pending ??= build()
  return pending
}

/**
 * Collects the paths out of a searchfox JSON response. Results are grouped by a
 * human-readable heading that varies with the query, `Files` for a path search
 * and `Textual Occurrences` for a text one, so every group is read.
 *
 * Throws on a response that reports a hit limit. A truncated list would drop
 * matches with nothing on the page to show it, so the query has to be narrowed
 * instead.
 */
export function parseSearchfoxPaths(body: string): string[] {
  const payload = JSON.parse(body) as {
    normal?: Record<string, { path?: string }[]>
    '*limits*'?: string[]
  }
  if (payload['*limits*']?.length) {
    throw new Error(
      `searchfox truncated the results (${payload['*limits*'].join(', ')}); the query needs narrowing`,
    )
  }

  const paths = new Set<string>()
  for (const group of Object.values(payload.normal ?? {})) {
    for (const hit of group) {
      if (hit.path) {
        paths.add(hit.path)
      }
    }
  }
  return [...paths]
}

/**
 * Maps each iOS asset name to the constant declaring it. The nesting of `public
 * struct Large` is what turns `bookmarkLarge` into the symbol a caller would
 * actually type, so the enclosing struct names are tracked as the file is
 * read.
 */
export function parseSwiftIdentifiers(source: string): Map<string, string> {
  const symbols = new Map<string, string>()
  const scope: string[] = []
  let depth = 0

  for (const line of source.split('\n')) {
    const struct = line.match(/\bstruct\s+([A-Za-z0-9_]+)\s*\{/)
    if (struct) {
      scope[depth] = struct[1]
      depth += 1
      continue
    }

    const constant = line.match(
      /\blet\s+([A-Za-z0-9_]+)\s*=\s*"([A-Za-z0-9_]+)"/,
    )
    if (constant) {
      symbols.set(
        constant[2],
        [...scope.slice(0, depth), constant[1]].join('.'),
      )
      continue
    }

    if (/^\s*\}\s*$/.test(line) && depth > 0) {
      depth -= 1
    }
  }

  return symbols
}

function basename(repoPath: string): string {
  return repoPath.split('/').pop() ?? repoPath
}

function rank(repoPath: string): number {
  const index = PATH_PRIORITY.findIndex((prefix) => repoPath.startsWith(prefix))
  return index === -1 ? PATH_PRIORITY.length : index
}

function sortPaths(paths: string[]): string[] {
  return [...paths]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, MAX_PATHS_PER_PRODUCT)
}

function sourceHref(repoPath: string): string {
  return `${SEARCHFOX}/${SEARCHFOX_REPO}/source/${repoPath}`
}

/**
 * Desktop drops the size from the filename, so `back-16.svg` is in-tree as
 * `back.svg` and one in-tree file is a candidate for every acorn size of that
 * name. Only the size the in-tree file actually declares is accepted, which is
 * why the index carries a size per path.
 */
function matchDesktop(asset: Asset, index: FirefoxIndex): string[] {
  const svg = asset.formats.find((format) => format.kind === 'svg')
  if (!svg) {
    return []
  }

  const name = basename(svg.repoPath)
  const exact = index.desktopPaths.get(name)
  if (exact) {
    return exact
  }

  if (asset.size === undefined) {
    return []
  }
  // Anchored on the asset's own size rather than any trailing number, or
  // `kit-run-1.svg` would go looking for `kit-run.svg`.
  const suffix = `-${asset.size}.svg`
  if (!name.endsWith(suffix)) {
    return []
  }

  const unsized = `${name.slice(0, -suffix.length)}.svg`
  return (index.desktopPaths.get(unsized) ?? []).filter(
    (repoPath) => index.desktopSizes.get(repoPath) === asset.size,
  )
}

export function matchAsset(asset: Asset, index: FirefoxIndex): FirefoxUsage[] {
  const usage: FirefoxUsage[] = []

  if (asset.platform !== 'mobile') {
    for (const repoPath of sortPaths(matchDesktop(asset, index))) {
      usage.push({
        product: 'desktop',
        path: repoPath,
        href: sourceHref(repoPath),
      })
    }
  }

  for (const format of asset.formats) {
    if (format.kind === 'xml') {
      const drawable = ANDROID_PREFIX + basename(format.repoPath)
      for (const repoPath of sortPaths(
        index.androidPaths.get(drawable) ?? [],
      )) {
        usage.push({
          product: 'android',
          path: repoPath,
          href: sourceHref(repoPath),
        })
      }
    }

    // Every PDF is checked, because the `Dark` and `Light` variants of one
    // asset are separate identifiers.
    if (format.kind === 'pdf') {
      const identifier = basename(format.repoPath).replace(/\.pdf$/, '')
      const symbol = index.iosSymbols.get(identifier)
      if (symbol) {
        usage.push({
          product: 'ios',
          path: IOS_IDENTIFIERS_PATH,
          href: `https://github.com/${IOS_REPO}/blob/main/${IOS_IDENTIFIERS_PATH}`,
          symbol,
        })
      }
    }
  }

  return usage
}

/** Without the JSON `Accept` header searchfox serves its HTML search page. */
async function searchfox(params: Record<string, string>): Promise<string[]> {
  const query = new URLSearchParams({
    case: 'false',
    regexp: 'false',
    ...params,
  })
  const body = await fetchText(
    `${SEARCHFOX}/${SEARCHFOX_REPO}/search?${query}`,
    { Accept: 'application/json' },
  )
  return parseSearchfoxPaths(body)
}

function groupByBasename(paths: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const repoPath of paths) {
    const name = basename(repoPath)
    grouped.set(name, [...(grouped.get(name) ?? []), repoPath])
  }
  return grouped
}

async function build(): Promise<Map<string, FirefoxUsage[]>> {
  const usage = new Map<string, FirefoxUsage[]>()
  if (process.env.SITE_SKIP_UPSTREAM) {
    return usage
  }

  const sizes = getCatalog().iconSizes.desktop

  const desktopFiles: string[][] = []
  const desktopSizes = new Map<string, number>()
  const androidFiles: string[][] = []
  const iosSymbols = new Map<string, string>()

  /**
   * Labelled by source, because a source is several requests and a bad host
   * fails all of them with the same message. One line per source, carrying the
   * first reason, is what a CI log can be read from.
   */
  const failures = new Map<string, { count: number; reason: string }>()
  async function attempt(source: string, run: () => Promise<void>) {
    try {
      await run()
    } catch (reason) {
      const seen = failures.get(source)
      failures.set(source, {
        count: (seen?.count ?? 0) + 1,
        reason:
          seen?.reason ??
          (reason instanceof Error ? reason.message : String(reason)),
      })
    }
  }

  await Promise.all([
    ...DESKTOP_GLOBS.map((glob) =>
      attempt('desktop file list', async () => {
        desktopFiles.push(await searchfox({ q: '', path: glob }))
      }),
    ),
    // One probe per size gives every in-tree file's dimensions without reading
    // any of them, which is what makes the unsized desktop names resolvable.
    ...sizes.map((size) =>
      attempt('desktop size probes', async () => {
        const paths = await searchfox({
          q: `text:viewBox="0 0 ${size} ${size}"`,
          path: '*.svg',
        })
        for (const repoPath of paths) {
          desktopSizes.set(repoPath, size)
        }
      }),
    ),
    attempt('Android drawables', async () => {
      androidFiles.push(await searchfox({ q: '', path: ANDROID_GLOB }))
    }),
    attempt('iOS identifiers', async () => {
      const source = await fetchText(
        `https://raw.githubusercontent.com/${IOS_REPO}/main/${IOS_IDENTIFIERS_PATH}`,
      )
      for (const [identifier, symbol] of parseSwiftIdentifiers(source)) {
        iosSymbols.set(identifier, symbol)
      }
    }),
  ])

  const index: FirefoxIndex = {
    desktopPaths: groupByBasename(desktopFiles.flat()),
    desktopSizes,
    androidPaths: groupByBasename(androidFiles.flat()),
    iosSymbols,
  }

  // Counted per asset, not per link, because one asset can name several in-tree
  // copies of the same file and the totals are what a reviewer checks.
  const assets = { desktop: 0, android: 0, ios: 0 }
  let links = 0
  for (const asset of getCatalog().assets) {
    const matches = matchAsset(asset, index)
    if (!matches.length) {
      continue
    }
    usage.set(asset.id, matches)
    links += matches.length
    for (const product of new Set(matches.map((match) => match.product))) {
      assets[product] += 1
    }
  }

  for (const [source, failure] of failures) {
    console.warn(
      `[firefox] ${source} unavailable, ${failure.count} request(s) failed: ${failure.reason}`,
    )
  }
  console.info(
    `[firefox] matched ${assets.desktop} desktop, ${assets.android} Android and ${assets.ios} iOS assets to ${links} in-tree files`,
  )

  return usage
}
