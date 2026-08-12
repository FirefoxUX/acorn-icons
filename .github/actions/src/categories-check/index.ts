import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { summary } from '../summary.js'
import { CATEGORIES_FILE, CategoriesFile } from '../categories.js'
import { getInput, inlineCode, tryCatch, writeFeedback } from '../utils.js'

const FEEDBACK_FILE = 'categories-feedback.json'
const NOTICE_FILE = 'categories-notice.json'

const ENTRY = /^[a-z0-9]+(-[a-z0-9]+)*$/

async function run() {
  const raw = read()
  if (raw === null) {
    await fail([`\`${CATEGORIES_FILE}\` is missing.`])
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await fail([`\`${CATEGORIES_FILE}\` is not valid JSON: ${detail}`])
    return
  }

  const problems = validate(parsed)
  if (problems.length > 0) {
    await fail(problems)
    return
  }

  await remind(parsed as CategoriesFile)
}

function read(): string | null {
  try {
    return fs.readFileSync(CATEGORIES_FILE, 'utf8')
  } catch {
    return null
  }
}

/** Everything here would break or silently corrupt the catalog build. */
function validate(parsed: unknown): string[] {
  const problems: string[] = []

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [`\`${CATEGORIES_FILE}\` must contain a JSON object.`]
  }
  const categories = (parsed as Record<string, unknown>).categories
  if (
    typeof categories !== 'object' ||
    categories === null ||
    Array.isArray(categories)
  ) {
    return ['The top-level `categories` key is missing or is not an object.']
  }

  // The site's lookup keeps whichever category is declared last, so a
  // duplicate quietly moves an icon's chip with nothing to show for it.
  const owner = new Map<string, string>()

  for (const [name, body] of Object.entries(categories)) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      problems.push(`Category \`${name}\` must be an object.`)
      continue
    }
    const { label, icons } = body as Record<string, unknown>

    if (label !== undefined && typeof label !== 'string') {
      problems.push(`The \`label\` of \`${name}\` must be text.`)
    }
    if (!Array.isArray(icons)) {
      problems.push(`Category \`${name}\` needs an \`icons\` list.`)
      continue
    }

    for (const entry of icons) {
      if (typeof entry !== 'string') {
        problems.push(`Category \`${name}\` lists a value that is not text.`)
        continue
      }
      if (!ENTRY.test(entry)) {
        problems.push(
          `\`${entry}\` in \`${name}\` is not a valid entry; use the icon's name, lowercase and hyphenated, optionally ending in its size.`,
        )
        continue
      }
      const already = owner.get(entry)
      if (already !== undefined) {
        problems.push(
          `\`${entry}\` is listed in both \`${already}\` and \`${name}\`; an icon belongs to one category.`,
        )
        continue
      }
      owner.set(entry, name)
    }
  }
  return problems
}

/**
 * Names the icons this pull request adds that no category covers. Pre-existing
 * uncategorized icons are deliberately ignored, so the reminder only ever
 * concerns work the author is doing right now.
 */
async function remind(file: CategoriesFile) {
  const exact = new Set<string>()
  const bare = new Set<string>()
  for (const body of Object.values(file.categories)) {
    for (const entry of body.icons) {
      if (/-\d+$/.test(entry)) {
        exact.add(entry)
      } else {
        bare.add(entry)
      }
    }
  }

  const added = addedIcons()
  if (added === null) {
    summary.addHeading('Icon categories', 3)
    summary.addRaw('Could not work out which icons this pull request adds.')
    summary.addEOL()
    await summary.write()
    return
  }

  const uncovered = added.filter(
    ({ slug, size }) => !exact.has(`${slug}-${size}`) && !bare.has(slug),
  )

  summary.addHeading(
    `${added.length} icon${added.length === 1 ? '' : 's'} added by this pull request`,
    3,
  )

  if (uncovered.length === 0) {
    summary.addRaw(
      added.length === 0
        ? 'No icons were added.'
        : 'Every added icon has a category.',
    )
    summary.addEOL()
    await summary.write()
    return
  }

  const names = [...new Set(uncovered.map(({ slug }) => slug))].sort()
  summary.addAlert(
    'note',
    `${names.length} added icon${names.length === 1 ? ' has' : 's have'} no category. This does not fail the check.`,
  )
  summary.addList(names.map((name) => `<code>${name}</code>`))

  writeFeedback(
    {
      title:
        names.length === 1
          ? 'One new icon has no category yet'
          : `${names.length} new icons have no category yet`,
      summary: 'Optional: add them to icons/categories.json.',
      body: [
        `These icons are new in this pull request and no category in \`${CATEGORIES_FILE}\` covers them:`,
        '',
        names.map((name) => `- \`${name}\``).join('\n'),
        '',
        `Categories drive the filter chips on the catalog site. To add one, open \`${CATEGORIES_FILE}\`, find the category it belongs to and add its name to that list. Use the plain name, like \`bookmark-fill\`, so every size is covered; add the size, like \`bookmark-fill-12\`, only when that one size belongs somewhere else. Create a new category block if none fits.`,
        '',
        'Leaving an icon out is fine, and nothing here blocks the merge. It just will not appear under a filter.',
      ].join('\n'),
    },
    NOTICE_FILE,
  )

  await summary.write()
}

/**
 * What to compare against when deciding which icons are new.
 *
 * The tip of the base branch, not `base_sha`. `base_sha` is only as fresh as
 * the event that triggered the run, so once the author merges the base branch
 * back into theirs, every icon that landed on the base in the meantime looks
 * like one of theirs. The tip is not an ancestor of those merges, so the
 * merge base lands where the branch actually diverged.
 *
 * Falls back to `base_sha` when the branch is not fetched, which is right for
 * the common case where the two are the same commit.
 */
function diffBase(): string | null {
  const sha = getInput('base_sha', false)
  const ref = getInput('base_ref', false)

  if (ref) {
    const remote = `origin/${ref}`
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', remote], {
        stdio: 'ignore',
      })
      return remote
    } catch {
      console.log(`::debug::${remote} is not fetched, using base_sha instead.`)
    }
  }
  return sha || null
}

/**
 * SVG is the anchor format for both platforms, so it alone decides whether an
 * icon is new. Returns null when there was nothing to diff against, which is
 * not the same as a pull request that added no icons.
 */
function addedIcons(): { slug: string; size: number }[] | null {
  const base = diffBase()
  if (base === null) {
    return null
  }

  let output: string
  try {
    // Three dots, so the comparison starts where the branch left the base
    // rather than at whatever `HEAD` happens to be merged with.
    output = execFileSync(
      'git',
      [
        'diff',
        '--diff-filter=A',
        '--name-only',
        `${base}...HEAD`,
        '--',
        'icons',
      ],
      { encoding: 'utf8' },
    )
  } catch (error) {
    console.log(`::warning::Could not diff against ${base}: ${error}`)
    return null
  }

  const added: { slug: string; size: number }[] = []
  for (const file of output.split('\n')) {
    if (!file.endsWith('.svg')) {
      continue
    }
    const parsed = parseSizedName(path.basename(file))
    if (parsed.size !== undefined) {
      added.push({ slug: parsed.slug, size: parsed.size })
    }
  }
  return added
}

// Kept in step with `parseSizedName` in
// .github/site/src/catalog/normalize.ts, which cannot be imported because
// tsconfig.json confines this package to ./src.
function parseSizedName(filename: string): { slug: string; size?: number } {
  const trimmed = filename.replace(/\.[^.]+$/, '').trim()
  const base = (trimmed.startsWith('ic_') ? trimmed.slice(3) : trimmed)
    .replace(/_/g, '-')
    .toLowerCase()
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  const match = base.match(/^(.*)-(\d+)$/)
  return match ? { slug: match[1], size: Number(match[2]) } : { slug: base }
}

async function fail(problems: string[]) {
  summary.addHeading(
    `${problems.length} problem${problems.length === 1 ? '' : 's'} in ${CATEGORIES_FILE}`,
    3,
  )
  summary.addAlert('caution', 'The catalog site cannot build with this file.')
  summary.addList(problems.map(inlineCode))

  const title =
    problems.length === 1
      ? 'icons/categories.json has a problem'
      : `icons/categories.json has ${problems.length} problems`
  const first = problems[0].replace(/[`*]/g, '')

  writeFeedback(
    {
      title,
      summary: first.length <= 140 ? first : title,
      body: [
        problems.map((problem) => `- ${problem}`).join('\n'),
        '',
        'The catalog site reads this file to group icons into the filter chips, so it has to stay well formed. Each category holds an optional `label` and a list of icon names.',
      ].join('\n'),
    },
    FEEDBACK_FILE,
  )

  await summary.write()
  process.exit(1)
}

// Runs last so the constants above are initialized before `run` reads them.
tryCatch(run, 'Failed to check icon categories. See logs for details.')
