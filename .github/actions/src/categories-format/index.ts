import fs from 'node:fs'
import { summary } from '../summary.js'
import { CATEGORIES_FILE, Category, CategoriesFile } from '../categories.js'
import { tryCatch } from '../utils.js'

/**
 * Rewrites `icons/categories.json` into a canonical order so the file stays
 * readable however it was edited. Contributors can append an icon to the end
 * of any list and the next run files it away.
 *
 * Reports nothing and fails nothing. `categories-check` owns the
 * diagnostics, and it runs in its own job so its verdict is not mixed up
 * with the asset transforms.
 */
async function run() {
  if (!fs.existsSync(CATEGORIES_FILE)) {
    summary.addHeading('No icon categories file', 3)
    summary.addRaw(`There is no ${CATEGORIES_FILE} to format.`)
    await summary.write()
    return
  }

  const original = fs.readFileSync(CATEGORIES_FILE, 'utf8')

  let parsed: CategoriesFile
  try {
    parsed = JSON.parse(original)
  } catch {
    // Leave it alone. categories-check reports the syntax error with a line
    // number, and rewriting a file we cannot parse would only lose work.
    summary.addHeading('Skipped the icon categories file', 3)
    summary.addAlert('warning', `${CATEGORIES_FILE} is not valid JSON.`)
    await summary.write()
    return
  }

  const formatted = canonical(parsed)
  if (formatted === original) {
    summary.addHeading('Icon categories unchanged', 3)
    summary.addRaw(`${CATEGORIES_FILE} is already tidy.`)
    await summary.write()
    return
  }

  fs.writeFileSync(CATEGORIES_FILE, formatted)
  summary.addHeading('Tidied the icon categories file', 3)
  summary.addRaw(`Sorted and reformatted ${CATEGORIES_FILE}.`)
  await summary.write()
}

function canonical(file: CategoriesFile): string {
  const categories = file.categories ?? {}
  const sorted: Record<string, Category> = {}

  for (const name of Object.keys(categories).sort((a, b) =>
    a.localeCompare(b),
  )) {
    const body = categories[name] ?? ({} as Category)
    const icons = [...new Set(body.icons ?? [])].sort((a, b) =>
      a.localeCompare(b),
    )
    // `label` before `icons`, so a category reads as its name then its members.
    sorted[name] =
      body.label !== undefined ? { label: body.label, icons } : { icons }
  }

  // Built as one literal so `_comment` keeps its place at the top of the file.
  const ordered: CategoriesFile =
    file._comment !== undefined
      ? { _comment: file._comment, categories: sorted }
      : { categories: sorted }

  return `${JSON.stringify(ordered, null, 2)}\n`
}

tryCatch(run, 'Failed to format the icon categories. See logs for details.')
