import fs from 'node:fs'
import path from 'node:path'
import { summary } from '../summary.js'
import { inlineCode, tryCatch, writeFeedback } from '../utils.js'

const FEEDBACK_FILE = 'illustration-feedback.json'

type Casing = 'kebab' | 'camel' | 'snake'

type Tree = {
  id: string
  root: string
  ext: string
  casing: Casing
}

/**
 * The five directory trees an illustration ships in. The format sits above
 * the category here, the opposite of the icon trees, and the three casings
 * are per format rather than per platform.
 */
const TREES: Tree[] = [
  {
    id: 'desktop/svg',
    root: 'illustrations/desktop',
    ext: '.svg',
    casing: 'kebab',
  },
  {
    id: 'mobile/svg',
    root: 'illustrations/mobile/svg',
    ext: '.svg',
    casing: 'kebab',
  },
  {
    id: 'mobile/pdf',
    root: 'illustrations/mobile/pdf',
    ext: '.pdf',
    casing: 'camel',
  },
  {
    id: 'mobile/xml',
    root: 'illustrations/mobile/xml',
    ext: '.xml',
    casing: 'snake',
  },
  {
    id: 'mobile/webp',
    root: 'illustrations/mobile/webp',
    ext: '.webp',
    casing: 'snake',
  },
]

const CATEGORIES = ['kit', 'pictograms', 'exports'] as const
type Category = (typeof CATEGORIES)[number]

const PREFIX_FOR_CATEGORY: Record<Category, string[]> = {
  kit: ['kit'],
  pictograms: ['pic'],
  exports: ['kit', 'ill'],
}

/**
 * `exports` is exempt from cross-platform parity. There is no
 * `illustrations/mobile/pdf/exports`, and the desktop and mobile export sets
 * are deliberately disjoint, so only the three mobile trees are compared.
 */
const MOBILE_TREES = ['mobile/svg', 'mobile/xml', 'mobile/webp']

const SHAPE: Record<Casing, RegExp> = {
  kebab: /^(kit|pic|ill)(-[a-z0-9]+)+\.svg$/,
  // A flat quantifier rather than `([A-Z][A-Za-z0-9]*)+`, which backtracks
  // catastrophically on a non-match. Requiring one capital after the prefix
  // is what catches names exported as a single lowercase run.
  camel: /^(kit|pic|ill)[A-Z][A-Za-z0-9]*\.pdf$/,
  snake: /^(kit|pic|ill)(_[a-z0-9]+)+\.(xml|webp)$/,
}

// `camelToKebab`, `snakeToKebab` and `tidy` are copies of the versions in
// .github/site/src/catalog/normalize.ts, which cannot be imported because
// tsconfig.json confines this package to ./src. Keep them in step; the lint
// is the strict half, and the site tolerates names it rejects.
function camelToKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase()
}

function snakeToKebab(name: string): string {
  return name.replace(/_/g, '-').toLowerCase()
}

function tidy(slug: string): string {
  return slug.replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
}

/**
 * Reads a name in any of the three casings, so a file sitting in the wrong
 * tree still yields the slug needed to suggest the right name.
 */
function slugFor(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim()
  if (base.includes('_')) return tidy(snakeToKebab(base))
  if (/[A-Z]/.test(base)) return tidy(camelToKebab(base))
  return tidy(base.toLowerCase())
}

/** Spelled the way each platform's own documentation spells it. */
const CASE_NAME: Record<Casing, string> = {
  kebab: 'kebab-case',
  camel: 'camelCase',
  snake: 'snake_case',
}

const EXAMPLE: Record<Casing, string> = {
  kebab: 'kit-alert-tail.svg',
  camel: 'kitAlertTail.pdf',
  snake: 'kit_alert_tail.xml',
}

function encode(slug: string, casing: Casing, ext: string): string {
  if (casing === 'snake') return slug.replace(/-/g, '_') + ext
  if (casing === 'camel') {
    return slug.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) + ext
  }
  return slug + ext
}

type Violation = { rule: string; message: string }

async function run() {
  const blocking: Violation[] = []
  const warnings: Violation[] = []
  // `${category}:${slug}` -> the tree ids it was found in.
  const index = new Map<string, Set<string>>()
  let scanned = 0

  for (const tree of TREES) {
    if (!fs.existsSync(tree.root)) continue

    for (const entry of fs.readdirSync(tree.root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (!entry.isDirectory()) {
        blocking.push({
          rule: 'stray',
          message: `\`${tree.root}/${entry.name}\` sits at the root of a format tree; every asset belongs in one of ${CATEGORIES.join(', ')}`,
        })
        continue
      }
      if (!(CATEGORIES as readonly string[]).includes(entry.name)) {
        blocking.push({
          rule: 'stray',
          message: `\`${tree.root}/${entry.name}/\` is not a known category; expected one of ${CATEGORIES.join(', ')}`,
        })
      }
    }

    for (const category of CATEGORIES) {
      const dir = path.join(tree.root, category)
      if (!fs.existsSync(dir)) continue

      for (const filename of fs.readdirSync(dir)) {
        if (filename.startsWith('.')) continue
        scanned++
        const rel = path.join(dir, filename)

        if (!filename.endsWith(tree.ext)) {
          blocking.push({
            rule: 'stray',
            message: `\`${rel}\` is not a ${tree.ext} file, but sits in the ${tree.id} tree`,
          })
          continue
        }

        const slug = slugFor(filename)
        const base = filename.replace(/\.[^.]+$/, '')
        const prefixes = PREFIX_FOR_CATEGORY[category]
        const suggestion = encode(slug, tree.casing, tree.ext)
        const expected = prefixes.map((p) => `\`${p}\``).join(' or ')

        if (!prefixes.some((p) => base.toLowerCase().startsWith(p))) {
          blocking.push({
            rule: 'shape',
            message: `\`${rel}\` starts with \`${slug.split('-')[0]}\`; files in ${category} start with ${expected}`,
          })
        } else if (!prefixes.includes(slug.split('-')[0])) {
          // The name begins with a legal prefix but nothing separates it from
          // the next word, so the word breaks cannot be recovered.
          blocking.push({
            rule: 'shape',
            message: `\`${rel}\` runs its words together, so the name cannot be split into words; write it ${CASE_NAME[tree.casing]} like \`${EXAMPLE[tree.casing]}\``,
          })
        } else if (suggestion !== filename) {
          blocking.push({
            rule: 'shape',
            message: `\`${rel}\` is not ${CASE_NAME[tree.casing]}; rename it to \`${suggestion}\``,
          })
        } else if (!SHAPE[tree.casing].test(filename)) {
          blocking.push({
            rule: 'shape',
            message: `\`${rel}\` does not match the ${CASE_NAME[tree.casing]} convention for ${tree.id}; names look like \`${EXAMPLE[tree.casing]}\``,
          })
        }

        const key = `${category}:${slug}`
        if (!index.has(key)) index.set(key, new Set())
        index.get(key)!.add(tree.id)
      }
    }
  }

  const allTrees = TREES.map((tree) => tree.id)
  for (const [key, present] of [...index].sort()) {
    const category = key.split(':')[0] as Category
    const expected =
      category === 'exports'
        ? MOBILE_TREES.some((tree) => present.has(tree))
          ? MOBILE_TREES
          : []
        : allTrees
    const missing = expected.filter((tree) => !present.has(tree))
    if (missing.length > 0) {
      warnings.push({
        rule: 'parity',
        message: `\`${key.split(':')[1]}\` is missing from ${missing.join(', ')}`,
      })
    }
  }

  for (const tree of TREES) {
    for (const category of CATEGORIES) {
      const dir = path.join(tree.root, category)
      if (!fs.existsSync(dir)) continue
      const slugs = new Set(
        fs
          .readdirSync(dir)
          .filter((f) => !f.startsWith('.'))
          .map((f) => slugFor(f)),
      )
      for (const slug of [...slugs].sort()) {
        const match = slug.match(/^(.*)-(light|dark)$/)
        if (!match) continue
        const counterpart = `${match[1]}-${match[2] === 'light' ? 'dark' : 'light'}`
        if (!slugs.has(counterpart)) {
          warnings.push({
            rule: 'theme',
            message: `\`${slug}\` in ${tree.id}/${category} has no \`${counterpart}\` counterpart`,
          })
        }
      }
    }
  }

  await report(scanned, blocking, warnings)
}

const RULE_HEADINGS: Record<string, string> = {
  stray: 'Files in the wrong place',
  shape: 'Filenames that do not match the convention for their folder',
  parity: 'Assets missing from a format tree',
  theme: 'Themed assets without a counterpart',
}

function group(violations: Violation[]): string {
  return Object.keys(RULE_HEADINGS)
    .map((rule) => {
      const matching = violations.filter((v) => v.rule === rule)
      if (matching.length === 0) return ''
      return [
        `**${RULE_HEADINGS[rule]}**`,
        matching.map((v) => `- ${v.message}`).join('\n'),
      ].join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

async function report(
  scanned: number,
  blocking: Violation[],
  warnings: Violation[],
): Promise<void> {
  summary.addHeading(`Checked ${scanned} illustration filenames`, 3)

  // Warnings never write a feedback payload. post-feedback treats the mere
  // presence of one as a failure, so a warning that wrote a payload would
  // turn the check red.
  if (warnings.length > 0) {
    summary.addAlert(
      'warning',
      `${warnings.length} asset${warnings.length === 1 ? '' : 's'} incomplete. This does not fail the check.`,
    )
    summary.addList(warnings.map((v) => inlineCode(v.message)))
  }

  if (blocking.length === 0) {
    if (warnings.length === 0) {
      summary.addRaw('Every illustration filename follows the conventions.')
      summary.addEOL()
    }
    await summary.write()
    return
  }

  summary.addAlert(
    'caution',
    `${blocking.length} filename${blocking.length === 1 ? '' : 's'} must be fixed.`,
  )
  summary.addList(blocking.map((v) => inlineCode(v.message)))

  const count = blocking.length
  const title =
    count === 1
      ? '1 illustration filename breaks the naming rules'
      : `${count} illustration filenames break the naming rules`

  writeFeedback(
    {
      title,
      summary: summarize(title, blocking),
      body: [
        group(blocking),
        '',
        'SVG names are kebab-case, iOS PDFs are camelCase, and Android XML and WebP are snake_case. Every name starts with `kit-`, `pic-` or `ill-`, and acronyms follow the same casing as any other word, so `illFeatureMozillaVpn` rather than `illFeatureMozillaVPN`.',
      ].join('\n'),
    },
    FEEDBACK_FILE,
  )

  await summary.write()
  process.exit(1)
}

/** GitHub caps commit-status descriptions at 140 characters. */
function summarize(title: string, blocking: Violation[]): string {
  const first = blocking[0].message.replace(/[`*]/g, '')
  const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : ''
  const candidate = `${first}${more}`
  return candidate.length <= 140 ? candidate : title
}

// Runs last so the tables above are initialized before `run` reads them.
tryCatch(run, 'Failed to lint illustration filenames. See logs for details.')
