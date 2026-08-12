/**
 * Upgrades tile navigation into a side panel. The tiles are real links, so a
 * click that arrives before this module runs, or in a browser without JS,
 * simply loads the standalone detail page.
 *
 * The panel keeps the address bar in step with what is on screen so a link can
 * still be copied, but it uses `replaceState` rather than `pushState`: stacking
 * every panel view onto browser history turns the back button into a surprise.
 * Moving between panel views is its own trail with its own controls instead,
 * and the back button does what it says, which is leave the page.
 *
 * What it writes is a fragment naming the tile, not the asset's own URL. That
 * keeps the grid and its search in the address bar, so the panel can be
 * reopened on the next load, and it degrades on its own: a browser with no
 * script still scrolls to the tile and `:target` highlights it.
 */

// An injected `<astro-island>` only hydrates once the custom element is defined,
// which happens when the page loads an island of its own.
const canHydrate = () => Boolean(customElements.get('astro-island'))

const SLIDE_MS = 220

let panel: HTMLElement | null = null
let body: HTMLElement | null = null
let grid: HTMLElement | null = null
let nav: HTMLElement | null = null
let status: HTMLElement | null = null
let backButton: HTMLButtonElement | null = null
let forwardButton: HTMLButtonElement | null = null
let opener: HTMLAnchorElement | undefined

/**
 * Read rather than captured, because the search field rewrites the query string
 * while the panel is open and a stored copy would put the old one back on
 * close.
 */
function gridUrl(): string {
  return `${window.location.pathname}${window.location.search}`
}

/** Panel views visited since the panel opened, and where in them we are. */
const trail: string[] = []
let cursor = -1

/** Only left clicks with no modifier, so opening in a new tab still works. */
function isPlainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

function assetHrefFrom(event: MouseEvent): string | undefined {
  const link = (event.target as Element | null)?.closest('a')
  if (!(link instanceof HTMLAnchorElement) || !link.href) {
    return undefined
  }
  return idFromPath(link.pathname) ? link.href : undefined
}

/**
 * Called explicitly from the layout rather than run on import, so the bundler
 * cannot treeshake the module away as a side-effect-free import.
 */
export function initDetailPanel(): void {
  panel = document.querySelector<HTMLElement>('#asset-panel')
  body = panel?.querySelector<HTMLElement>('[data-panel-body]') ?? null
  grid = document.querySelector<HTMLElement>('[data-asset-grid]')
  if (!panel || !body || !grid) {
    return
  }
  nav = panel.querySelector<HTMLElement>('[data-panel-nav]')
  status = panel.querySelector<HTMLElement>('[data-panel-status]')
  backButton = panel.querySelector<HTMLButtonElement>('[data-panel-back]')
  forwardButton = panel.querySelector<HTMLButtonElement>('[data-panel-forward]')

  // Tells the stylesheet to hand the slide over to the view transition pseudo
  // elements instead of running its own transition on the panel.
  if (document.startViewTransition) {
    document.documentElement.classList.add('has-vt')
  }

  restoreFromFragment()
  window.addEventListener('hashchange', onHashChange)

  grid.addEventListener('click', (event) => {
    const href = isPlainClick(event) ? assetHrefFrom(event) : undefined
    if (!href || !canHydrate()) {
      return
    }

    event.preventDefault()
    opener = (event.target as Element).closest('a') as HTMLAnchorElement
    trail.length = 0
    cursor = -1
    void open(href)
  })

  panel.addEventListener('click', (event) => {
    const target = event.target as Element | null
    if (target?.closest('[data-panel-close]')) {
      close()
      return
    }
    if (target?.closest('[data-panel-back]')) {
      void step(-1, backButton)
      return
    }
    if (target?.closest('[data-panel-forward]')) {
      void step(1, forwardButton)
      return
    }

    // "Also available as" points at other assets. Follow those in place rather
    // than throwing the reader back out to a standalone page. Any other link in
    // the panel, such as the category chip or a download, navigates normally.
    const href = isPlainClick(event) ? assetHrefFrom(event) : undefined
    if (!href || !canHydrate()) {
      return
    }
    event.preventDefault()
    void open(href)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel && !panel.hidden) {
      close()
    }
  })
}

function idFromPath(pathname: string): string | undefined {
  return pathname.match(/\/asset\/([^/]+)\/?$/)?.[1]
}

function fragmentId(): string {
  return decodeURIComponent(window.location.hash.slice(1))
}

/**
 * Reopens the panel a shared fragment names. Without a script the fragment has
 * already done what it can on its own, which is scroll to the tile and let
 * `:target` mark it.
 */
function restoreFromFragment(): void {
  const tile = tileFor(fragmentId())
  if (!tile) {
    return
  }
  opener = tile
  // The islands inside the fetched fragment only hydrate once Astro has defined
  // the element, and on a cold load that has not necessarily happened yet.
  void customElements.whenDefined('astro-island').then(() =>
    // Focus stays where the browser put it: taking it on load, before any
    // interaction, would lose the reader's place rather than follow them.
    open(tile.href, { moveFocus: false }),
  )
}

/**
 * A fragment link pointing at the grid already on screen navigates within the
 * document, so nothing reloads and the panel would otherwise ignore it.
 * `replaceState` does not fire this event, so the panel's own writes cannot
 * loop back in here.
 */
function onHashChange(): void {
  const tile = tileFor(fragmentId())
  if (!tile) {
    if (panel && !panel.hidden) {
      close()
    }
    return
  }
  opener = tile
  trail.length = 0
  cursor = -1
  void open(tile.href)
}

async function step(
  delta: number,
  pressed: HTMLButtonElement | null,
): Promise<void> {
  const next = cursor + delta
  if (next < 0 || next >= trail.length) {
    return
  }
  cursor = next
  // Focus stays on the button so the reader can keep stepping.
  await open(trail[cursor], { record: false, moveFocus: false })

  // Disabling the focused control drops focus to the document, so hand it on
  // deliberately rather than losing the reader's place.
  if (pressed?.disabled) {
    const other = pressed === backButton ? forwardButton : backButton
    const next = other && !other.disabled ? other : panel
    next?.focus()
  }
}

/**
 * A live region stays silent when the new text matches the old, so it is
 * cleared first. That happens in practice when stepping between two sizes of
 * one icon.
 */
function announce(text: string): void {
  if (!status) {
    return
  }
  status.textContent = ''
  setTimeout(() => {
    if (status) {
      status.textContent = text
    }
  }, 60)
}

function updateNav(): void {
  if (backButton) {
    backButton.disabled = cursor <= 0
  }
  if (forwardButton) {
    forwardButton.disabled = cursor >= trail.length - 1
  }
  // With a single view there is nowhere to step, so the whole row is noise.
  if (nav) {
    nav.hidden = trail.length < 2
  }
}

async function open(
  href: string,
  {
    record = true,
    moveFocus = true,
  }: { record?: boolean; moveFocus?: boolean } = {},
): Promise<void> {
  if (!panel || !body) {
    return
  }

  const { pathname } = new URL(href, window.location.href)
  const id = idFromPath(pathname)

  let markup: string
  try {
    const response = await fetch(`${pathname}panel/`)
    if (!response.ok) {
      throw new Error(`${response.status}`)
    }
    markup = await response.text()
  } catch {
    // Never leave the user stranded on a half-open panel.
    window.location.assign(href)
    return
  }

  const panelEl = panel
  const bodyEl = body
  // Revealing the panel and filling it in one step lets a view transition
  // capture a single before and after state. Opening the panel also reflows the
  // grid from two columns to three, and that is the change worth animating.
  const apply = () => {
    bodyEl.innerHTML = markup
    panelEl.hidden = false
    panelEl.classList.add('is-open')
  }

  // Sliding in again would be wrong when the panel is already there and only
  // its contents changed, so that case cross-fades instead.
  await withViewTransition(apply, panelEl.hidden ? undefined : 'swap')

  if (record) {
    // A new view discards anything that was ahead of the cursor, the same way a
    // browser drops the forward entries.
    trail.splice(cursor + 1)
    trail.push(href)
    cursor = trail.length - 1
  }
  updateNav()

  // Names the tile instead of navigating to the asset, so the grid and its
  // search stay in the address bar and the panel can be reopened from it. Also
  // runs for a step through the trail and for a sibling followed inside the
  // panel, since every one of those goes through here.
  window.history.replaceState({}, '', id ? `${gridUrl()}#${id}` : gridUrl())

  // The link may be a sibling inside the panel rather than a grid tile, so the
  // current marker and the focus target are looked up from the grid by id.
  const tile = tileFor(id)
  if (tile) {
    opener = tile
  }
  markCurrent(tile)

  const name = bodyEl.querySelector('#asset-panel-heading')?.textContent?.trim()
  const meta = bodyEl.querySelector('.meta')?.textContent?.trim()
  if (name) {
    // The size belongs in the message: two sizes of one icon share a display
    // name, so "Bookmark" alone would not tell a reader that anything changed.
    announce([name, meta].filter(Boolean).join(', '))
  }

  if (moveFocus) {
    // The element that was focused is inside the replaced markup, so focus has
    // to be placed somewhere. The panel is labelled by the asset name, which is
    // what a screen reader then announces.
    panel.focus()
  }
}

function tileFor(id: string | undefined): HTMLAnchorElement | undefined {
  if (!id || !grid) {
    return undefined
  }
  // Checked for containment, so a fragment naming some other element on the
  // page cannot be mistaken for a tile.
  const tile = document.getElementById(id)
  if (!tile || !grid.contains(tile)) {
    return undefined
  }
  return tile.querySelector<HTMLAnchorElement>('a') ?? undefined
}

/**
 * Runs the DOM update inside a view transition when the browser has one and the
 * reader has not asked for less motion. Without it the CSS transition on the
 * panel handles the slide instead, which is why the stylesheet keeps both
 * paths.
 */
async function withViewTransition(
  update: () => void,
  mode?: 'swap',
): Promise<void> {
  if (!document.startViewTransition || prefersReducedMotion()) {
    update()
    return
  }
  const root = document.documentElement
  if (mode) {
    root.dataset.vt = mode
  }
  const transition = document.startViewTransition(update)
  // Held until the animation ends, not just the DOM update, or the stylesheet
  // would switch back to the slide halfway through.
  void transition.finished.finally(() => {
    if (mode) {
      delete root.dataset.vt
    }
  })
  await transition.updateCallbackDone
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function close(): void {
  if (!panel || !body) {
    return
  }

  const panelEl = panel
  const bodyEl = body

  const teardown = () => {
    panelEl.classList.remove('is-open')
    panelEl.hidden = true
    bodyEl.innerHTML = ''
  }

  if (document.startViewTransition && !prefersReducedMotion()) {
    void document.startViewTransition(teardown)
  } else if (prefersReducedMotion()) {
    teardown()
  } else {
    // Without a view transition the panel needs its CSS slide to finish before
    // it is removed from the layout.
    panelEl.classList.remove('is-open')
    setTimeout(() => {
      // Only tear down if nothing reopened the panel while it slid out.
      if (!panelEl.classList.contains('is-open')) {
        panelEl.hidden = true
        bodyEl.innerHTML = ''
      }
    }, SLIDE_MS)
  }

  trail.length = 0
  cursor = -1
  updateNav()
  markCurrent(undefined)
  if (status) {
    status.textContent = ''
  }
  window.history.replaceState({}, '', gridUrl())
  // Back to the tile that opened the panel, so the reader resumes where they
  // left off rather than at the top of the document.
  opener?.focus()
  opener = undefined
}

function markCurrent(link: HTMLAnchorElement | undefined): void {
  for (const previous of document.querySelectorAll('a[aria-current="true"]')) {
    previous.removeAttribute('aria-current')
  }
  link?.setAttribute('aria-current', 'true')
}
