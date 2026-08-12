/**
 * Filtering runs twice on a cold load: once from the early script that reads
 * `?q=`, and again inside the search island once its bundle arrives. Both call
 * this so the two passes cannot disagree and produce a visible flash.
 */

const TILE_SELECTOR = '[data-keywords]'

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
}

/** A tile matches when every query token is a prefix of one of its keywords. */
function matches(keywords: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true
  }
  const words = keywords.split(' ')
  return tokens.every((token) => words.some((word) => word.startsWith(token)))
}

/** Returns the number of visible tiles. */
export function applyFilter(root: ParentNode, query: string): number {
  const tokens = tokenize(query)
  let visible = 0

  for (const tile of root.querySelectorAll<HTMLElement>(TILE_SELECTOR)) {
    const hit = matches(tile.dataset.keywords ?? '', tokens)
    tile.hidden = !hit
    if (hit) {
      visible += 1
    }
  }

  return visible
}
