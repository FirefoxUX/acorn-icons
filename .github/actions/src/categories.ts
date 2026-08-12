/**
 * Shape of `icons/categories.json`, shared by the two actions that read it.
 *
 * The catalog site declares the same shape in
 * .github/site/src/catalog/categories.ts. That copy is unavoidable, since the
 * site is a separate package, but these two are not: keep them here so a
 * change to the file format is made once.
 */

export const CATEGORIES_FILE = 'icons/categories.json'

export type Category = {
  /** Chip text. Defaults to the capitalized category name. */
  label?: string
  /** Slugs, each optionally suffixed `-<size>`. */
  icons: string[]
}

export type CategoriesFile = {
  _comment?: string
  categories: Record<string, Category>
}
