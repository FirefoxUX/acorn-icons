/**
 * Fills that mark a genuinely multicolor icon. Everything else that is pure
 * black is monochrome artwork the mobile pipeline never converted, so it
 * becomes `currentColor` in previews.
 */
const KEEP_FILLS = new Set(['#fff', '#ffffff', '#c52d4f', '#b833e1', '#d6d5da'])

const BLACK_FILL = /(fill|stroke)="(#000|#000000|black)"/gi

type Dimensions = { width: number; height: number }

/**
 * Reads the drawing size from the `viewBox`, falling back to the `width` and
 * `height` attributes. Three files in the repo disagree with the size in their
 * own filename and folder, so the `viewBox` is the only trustworthy source.
 */
export function readDimensions(svg: string): Dimensions {
  const viewBox = svg.match(/viewBox="([^"]+)"/i)
  if (viewBox) {
    const parts = viewBox[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [, , width, height] = parts
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }
  }

  const width = svg.match(/\bwidth="([\d.]+)/i)
  const height = svg.match(/\bheight="([\d.]+)/i)
  if (width && height) {
    return { width: Number(width[1]), height: Number(height[1]) }
  }

  return { width: 1, height: 1 }
}

/**
 * Rewrites an asset SVG so it can be inlined into the page. The original file
 * is never touched; downloads always serve the source bytes.
 *
 * @param idPrefix Prepended to every id in the file. Illustration exports reuse
 *   single-letter gradient ids across the whole corpus, so without this two
 *   assets on one page resolve `url(#b)` to the same gradient.
 */
export function sanitizeSvg(source: string, idPrefix: string): string {
  let svg = source
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()

  // `context-fill` and `context-stroke` only resolve inside Firefox's own
  // chrome. In a content page they are invalid paints and the shape falls back
  // to black, which loses the two channels of the duotone icons entirely.
  svg = svg
    .replace(/(fill|stroke)="context-fill"/gi, '$1="currentColor"')
    .replace(/(fill|stroke)="context-stroke"/gi, '$1="var(--asset-fill-2)"')
    // Both `context-fill-opacity` and `context-stroke-opacity` occur, so the
    // value is matched loosely rather than spelled out.
    .replace(/\s(fill|stroke)-opacity="context-[a-z-]+"/gi, '')

  svg = svg.replace(BLACK_FILL, (match, attribute: string, value: string) =>
    KEEP_FILLS.has(value.toLowerCase()) ? match : `${attribute}="currentColor"`,
  )

  svg = svg
    .replace(
      /\bid="([^"]+)"/g,
      (_match, id: string) => `id="${idPrefix}-${id}"`,
    )
    .replace(
      /url\((['"]?)#([^)'"]+)\1\)/g,
      (_match, quote: string, id: string) =>
        `url(${quote}#${idPrefix}-${id}${quote})`,
    )
    .replace(
      /((?:xlink:)?href)="#([^"]+)"/g,
      (_match, attribute: string, id: string) =>
        `${attribute}="#${idPrefix}-${id}"`,
    )

  // Dropping width and height lets CSS size the element, but only if a viewBox
  // survives to carry the aspect ratio.
  const { width, height } = readDimensions(svg)
  const hasViewBox = /viewBox="/i.test(svg)

  return svg.replace(/<svg\b([^>]*)>/i, (_match, attributes: string) => {
    const cleaned = attributes
      .replace(/\s(width|height)="[^"]*"/gi, '')
      .replace(/\s(aria-hidden|focusable)="[^"]*"/gi, '')
      .trimEnd()
    const viewBox = hasViewBox ? '' : ` viewBox="0 0 ${width} ${height}"`
    return `<svg${cleaned}${viewBox} aria-hidden="true" focusable="false">`
  })
}
