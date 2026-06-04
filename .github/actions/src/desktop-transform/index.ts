import { PluginConfig, optimize } from 'svgo'
import fg from 'fast-glob'
import fs from 'fs'
import { summary } from '../summary.js'
import {
  ensureLicense,
  formatFile,
  getInput,
  removeOrphanedClipPathRefs,
  svgoBasePlugins,
  svgoRemoveAttrs,
  tryCatch,
  writeFeedback,
} from '../utils.js'

tryCatch(run, 'Failed to check desktop SVGs. See logs for details.')

// Duotone icons carry per-element `fill="context-fill"` and
// `fill="context-stroke"` so the chrome can theme each region separately.
// Flattening would erase that distinction, so the pipeline branches on
// this predicate to skip the usual root-fill normalization.
function isDuotone(path: string): boolean {
  return /-duotone-\d+\.svg$/.test(path)
}

type DuotoneIssue = {
  path: string
  reasons: string[]
}

async function run() {
  const filesGlob = getInput('files', true)
  const files = await fg(filesGlob)

  if (files.length === 0) {
    summary.addHeading('Desktop SVGs: no files found', 3)
    summary.addAlert('warning', `No files found matching "${filesGlob}".`)
    summary.write()
    return
  }

  const changedFiles: string[] = []
  const duotoneIssues: DuotoneIssue[] = []

  for (const file of files) {
    if (await updateDesktopIcon(file, duotoneIssues)) {
      changedFiles.push(file)
    }
  }

  if (changedFiles.length === 0) {
    summary.addHeading('Desktop SVGs unchanged', 3)
    summary.addRaw(`Checked ${files.length} desktop SVGs and made no changes.`)
    summary.addEOL()
  } else {
    summary.addHeading(`Updated ${changedFiles.length} desktop SVGs`, 3)
    summary.addList(changedFiles)
  }

  if (duotoneIssues.length > 0) {
    summary.addHeading(`${duotoneIssues.length} invalid duotone icon(s)`, 3)
    summary.addAlert('caution', duotoneContractExplanation())
    summary.addList(
      duotoneIssues.map(
        ({ path, reasons }) => `<code>${path}</code> — ${reasons.join('; ')}`,
      ),
    )
    writeFeedback({
      title: duotoneFeedbackTitle(duotoneIssues.length),
      summary: duotoneFeedbackSummary(duotoneIssues),
      body: duotoneFeedbackBody(duotoneIssues),
    })
    await summary.write()
    process.exit(1)
  }

  summary.write()
}

function duotoneContractExplanation(): string {
  return [
    'A `*-duotone-*.svg` file must be authored with two color channels so',
    'the chrome can theme each region independently. The contract is:',
    '',
    '- at least one descendant element carries `fill="context-fill"`',
    '- at least one descendant element carries `fill="context-stroke"`',
    '- the root `<svg>` does not carry `fill="context-fill"` or `fill="context-stroke"`',
    '',
    'If an icon only needs a single color channel, drop the `-duotone`',
    'suffix from the filename and the pipeline will set the root fill',
    'automatically.',
  ].join('\n')
}

function duotoneFeedbackTitle(count: number): string {
  return count === 1
    ? '1 duotone icon needs fixing'
    : `${count} duotone icons need fixing`
}

function duotoneFeedbackSummary(issues: DuotoneIssue[]): string {
  // Commit-status descriptions are capped at 140 chars by the GitHub API,
  // so name the first file and the headline reason; fall back to a count
  // if that already pushes us over the limit.
  const first = issues[0]
  const headline = first.reasons[0] ?? 'invalid duotone structure'
  const fileLabel = first.path.split('/').pop() ?? first.path
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : ''
  const candidate = `${fileLabel}: ${headline}${more}`
  if (candidate.length <= 140) return candidate
  return duotoneFeedbackTitle(issues.length)
}

function duotoneFeedbackBody(issues: DuotoneIssue[]): string {
  const fileSections = issues
    .map(({ path, reasons }) => {
      const bullets = reasons.map((r) => `    - ${r}`).join('\n')
      return `- \`${path}\`\n${bullets}`
    })
    .join('\n')

  return [
    fileSections,
    '',
    `A duotone SVG needs one child element with \`fill="context-fill"\` and one with \`fill="context-stroke"\`, and no \`fill\` on the root \`<svg>\`. Re-export the frame from the icon-helper Figma plugin, or drop the \`-duotone\` part from the filename if it only needs one color channel.`,
  ].join('\n')
}

async function updateDesktopIcon(
  path: string,
  duotoneIssues: DuotoneIssue[],
): Promise<boolean> {
  if (!path.endsWith('.svg')) {
    return false
  }
  console.log(`Checking ${path}`)
  const originalFile = fs.readFileSync(path, 'utf8')

  const duotone = isDuotone(path)

  // Duotone files encode color information on each child's `fill`, so we
  // can't strip `fill` / `fill-opacity` the way we do for single-channel
  // icons. `normalizeDuotoneRoot` handles the root attributes downstream.
  const attrsToRemove = duotone
    ? [
        'id',
        'data-name',
        'class',
        'stroke',
        'stroke-width',
        'stroke-miterlimit',
      ]
    : [
        'id',
        'data-name',
        'class',
        'fill',
        'stroke',
        'stroke-width',
        'stroke-miterlimit',
        'fill-opacity',
      ]

  const result = optimize(originalFile, {
    // Without multipass, SVGO output is not always a fixed point of its
    // own algorithm: a later pass can shrink path data once a neighbour
    // has already been reduced. The CI would then re-format the file on
    // every run and produce drift commits.
    multipass: true,
    plugins: [
      // Read the `id` / `data-name` markers the icon-helper Figma plugin
      // emits before `svgoRemoveAttrs` strips them.
      ...(duotone ? [mapChannelIdsToFills] : []),
      svgoRemoveAttrs(attrsToRemove),
      viewBoxAndDimensions,
      ...(duotone
        ? [validateDuotone(path, duotoneIssues), normalizeDuotoneRoot]
        : [addContextFill]),
      removeOrphanedClipPathRefs,
      ...svgoBasePlugins,
    ],
  })

  const formatted = await formatFile('svg', result.data)
  const withLicense = ensureLicense(formatted)

  const fileChanged = withLicense !== originalFile
  if (fileChanged) {
    fs.writeFileSync(path, withLicense)
  }
  return fileChanged
}

const viewBoxAndDimensions: PluginConfig = {
  name: 'viewBoxAndDimensions',
  fn: () => ({
    element: {
      enter(node) {
        if (node.name !== 'svg') {
          return
        }
        const viewBox = node.attributes.viewBox
        const width = node.attributes.width
        const height = node.attributes.height

        if (viewBox && width && height) {
          return
        }

        if ((viewBox && !width) || !height) {
          const [, , w, h] = viewBox.split(' ')
          node.attributes.width = w
          node.attributes.height = h
        } else if (width && height && !viewBox) {
          node.attributes.viewBox = `0 0 ${width} ${height}`
        } else {
          throw new Error('SVG has no width, height, or viewBox')
        }
      },
    },
  }),
}

// `context-fill` / `context-fill-opacity` are how Firefox themes the icon
// at runtime; the chrome reads them off the root and substitutes its own
// values.
const addContextFill: PluginConfig = {
  name: 'addContextFill',
  fn: () => ({
    element: {
      enter(node) {
        if (node.name !== 'svg') {
          return
        }
        node.attributes.fill = 'context-fill'
        node.attributes['fill-opacity'] = 'context-fill-opacity'
      },
    },
  }),
}

// Figma writes a shape's name into `id` / `data-name` on export. The
// icon-helper plugin names the two channels `context-fill` and
// `context-stroke` precisely so we can promote them to `fill` here.
const mapChannelIdsToFills: PluginConfig = {
  name: 'mapChannelIdsToFills',
  fn: () => ({
    element: {
      enter(node) {
        if (node.name === 'svg') {
          return
        }
        const marker = node.attributes.id ?? node.attributes['data-name'] ?? ''
        if (marker === 'context-fill' || marker === 'context-stroke') {
          node.attributes.fill = marker
        }
      },
    },
  }),
}

// The root `<svg>` must not carry `fill` for duotone (otherwise children
// inherit the wrong color), but it still needs `fill-opacity` so the
// chrome's opacity propagates to both channels.
const normalizeDuotoneRoot: PluginConfig = {
  name: 'normalizeDuotoneRoot',
  fn: () => ({
    element: {
      enter(node) {
        if (node.name !== 'svg') {
          return
        }
        delete node.attributes.fill
        node.attributes['fill-opacity'] = 'context-fill-opacity'
      },
    },
  }),
}

// Geometry-bearing elements need a themable `fill`; containers like `g`,
// `defs`, `clipPath` don't render and are deliberately excluded.
const GEOMETRY_ELEMENTS = new Set([
  'path',
  'circle',
  'rect',
  'ellipse',
  'polygon',
  'polyline',
  'line',
])

// Captures duotone violations that need a designer to resolve. A root
// `fill` attribute is auto-fixable by `normalizeDuotoneRoot` and is
// deliberately not surfaced here.
function validateDuotone(path: string, issues: DuotoneIssue[]): PluginConfig {
  // Lives outside `fn` so multipass iterations don't push duplicate
  // entries into the shared issues array.
  let alreadyRecorded = false
  return {
    name: 'validateDuotone',
    fn: () => {
      let hasContextFill = false
      let hasContextStroke = false
      let missingFillCount = 0
      const badFillValues: string[] = []

      const firstToken = (value: string | undefined): string =>
        (value || '').trim().split(/\s+/)[0]

      return {
        element: {
          enter(node) {
            const rawFill = node.attributes.fill
            const token = firstToken(rawFill)
            if (node.name === 'svg') {
              return
            }
            if (token === 'context-fill') hasContextFill = true
            if (token === 'context-stroke') hasContextStroke = true

            // A geometry element without a channel fill renders as default
            // black at runtime, which silently breaks chrome theming.
            if (GEOMETRY_ELEMENTS.has(node.name)) {
              if (!rawFill || rawFill.trim() === '') {
                missingFillCount++
              } else if (
                token !== 'context-fill' &&
                token !== 'context-stroke'
              ) {
                badFillValues.push(rawFill)
              }
            }
          },
        },
        root: {
          exit() {
            const reasons: string[] = []
            if (!hasContextFill) {
              reasons.push('no child element has `fill="context-fill"`')
            }
            if (!hasContextStroke) {
              reasons.push('no child element has `fill="context-stroke"`')
            }
            if (missingFillCount > 0) {
              const noun = missingFillCount === 1 ? 'shape has' : 'shapes have'
              reasons.push(
                `${missingFillCount} child ${noun} no \`fill\` attribute — set \`fill="context-fill"\` or \`fill="context-stroke"\` on each`,
              )
            }
            if (badFillValues.length > 0) {
              const example = badFillValues[0]
              const extra =
                badFillValues.length > 1
                  ? ` (+${badFillValues.length - 1} more)`
                  : ''
              const noun =
                badFillValues.length === 1 ? 'shape has' : 'shapes have'
              reasons.push(
                `${badFillValues.length} child ${noun} \`fill="${example}"\`${extra} — use \`fill="context-fill"\` or \`fill="context-stroke"\` instead`,
              )
            }
            if (reasons.length > 0 && !alreadyRecorded) {
              alreadyRecorded = true
              issues.push({ path, reasons })
            }
          },
        },
      }
    },
  }
}
