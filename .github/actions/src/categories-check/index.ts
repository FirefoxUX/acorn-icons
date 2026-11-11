import fs from 'node:fs'
import { summary } from '../summary.js'
import { CATEGORIES_FILE } from '../categories.js'
import { inlineCode, recordFindings, tryCatch } from '../utils.js'

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

  summary.addHeading('Icon categories', 3)
  summary.addRaw(`${CATEGORIES_FILE} is valid.`)
  summary.addEOL()
  await summary.write()
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
  recordFindings([
    {
      kind: 'fix',
      title,
      body: [
        problems.map((problem) => `- ${problem}`).join('\n'),
        '',
        'The catalog site reads this file to group icons into the filter chips, so it has to stay well formed. Each category holds an optional `label` and a list of icon names.',
      ].join('\n'),
    },
  ])

  await summary.write()
}

// Runs last so the constants above are initialized before `run` reads them.
tryCatch(run, 'Failed to check icon categories. See logs for details.')
