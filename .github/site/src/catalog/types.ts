export type AssetKind = 'icon' | 'illustration'
export type Platform = 'desktop' | 'mobile' | 'shared'
export type IllustrationCategory = 'kit' | 'pictograms' | 'exports'
export type Theme = 'light' | 'dark'
export type FormatKind = 'svg' | 'pdf' | 'xml' | 'webp'

export type Format = {
  kind: FormatKind
  /** Path relative to the repository root, which is also the download URL stem. */
  repoPath: string
  url: string
  bytes: number
  /**
   * Set when several files of one kind belong to the same asset, such as the
   * `Dark` and `Light` iOS PDFs that share a single themeless SVG.
   */
  variant?: string
}

export type Asset = {
  id: string
  kind: AssetKind
  platform: Platform
  slug: string
  displayName: string
  size?: number
  category?: IllustrationCategory
  /**
   * Semantic group from the design system, such as `arrows & chevrons`. Icons
   * only, and only where the export covers them.
   */
  group?: string
  theme?: Theme
  width: number
  height: number
  formats: Format[]
  /** Sanitized markup, inlined into the page. Icons only. */
  inlineSvg?: string
  /**
   * The unmodified file contents, offered for copying. Icons only: illustration
   * sources run to tens of kilobytes and are only useful as a download.
   */
  rawSvg?: string
  /** Static URL for an `<img>`. Illustrations only. */
  previewUrl?: string
  keywords: string[]
  /** Ids of assets sharing this slug at other sizes, platforms or themes. */
  siblings: string[]
}

/** One generated category filter page, and the chip that links to it. */
export type CategoryView = {
  platform: 'desktop' | 'mobile'
  size: number
  category: string
  slug: string
  label: string
  count: number
}

export type Catalog = {
  assets: Asset[]
  byId: Map<string, Asset>
  icons: Asset[]
  illustrations: Asset[]
  iconSizes: Record<'desktop' | 'mobile', number[]>
  /** Only the size and category pairings that cleared the chip threshold. */
  categoryViews: CategoryView[]
  warnings: string[]
}
