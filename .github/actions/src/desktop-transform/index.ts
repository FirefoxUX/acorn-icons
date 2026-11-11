import { PluginConfig, optimize } from 'svgo'
import fg from 'fast-glob'
import fs from 'fs'
import nodePath from 'path'
import { summary } from '../summary.js'
import {
  Finding,
  ensureLicense,
  formatFile,
  getInput,
  removeNoOpClipPaths,
  removeOrphanedClipPathRefs,
  svgoBasePlugins,
  svgoRemoveAttrs,
  recordFindings,
  tryCatch,
  unreadableFinding,
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
  const unreadable: { path: string; detail: string }[] = []

  for (const file of files) {
    try {
      if (await updateDesktopIcon(file, duotoneIssues)) {
        changedFiles.push(file)
      }
    } catch (error) {
      console.error(error)
      unreadable.push({
        path: file,
        detail: error instanceof Error ? error.message : String(error),
      })
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
  }
  if (unreadable.length > 0) {
    summary.addHeading(`${unreadable.length} unreadable SVG(s)`, 3)
    summary.addList(
      unreadable.map(({ path, detail }) => `<code>${path}</code>: ${detail}`),
    )
  }

  // The files are already rewritten at this point. Recording findings
  // instead of exiting early lets the commit step still push them.
  recordFindings([
    ...duotoneIssues.map(duotoneFinding),
    ...unreadable.map(({ path, detail }) => unreadableFinding(path, detail)),
  ])

  await summary.write()
}

function displayPath(path: string): string {
  return nodePath.relative(process.cwd(), path)
}

function duotoneFinding({ path, reasons }: DuotoneIssue): Finding {
  const name = nodePath.basename(path)
  return {
    kind: 'fix',
    title: `\`${name}\` has a problem with its two color channels`,
    body: [
      `\`${displayPath(path)}\``,
      '',
      reasons.map((reason) => `- ${reason}`).join('\n'),
      '',
      'A `-duotone` icon needs one shape named `context-fill` and one named `context-stroke` in Figma, and every other shape needs one of those two names as well. Re-export the frame with the icon-helper plugin once the layers are named. If the icon only needs one color, remove `-duotone` from the filename.',
    ].join('\n'),
  }
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
      removeNoOpClipPaths,
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

        if (viewBox) {
          const [, , w, h] = viewBox.trim().split(/[\s,]+/)
          node.attributes.width = width ?? w
          node.attributes.height = height ?? h
        } else if (width && height) {
          node.attributes.viewBox = `0 0 ${width} ${height}`
        } else {
          throw new Error('The SVG has no viewBox and no width and height.')
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

// Shapes inside these are never painted directly, so their `fill` needs no
// color channel.
const NON_RENDERING_CONTAINERS = new Set(['defs', 'clipPath', 'mask'])

// Enough of the path data for a designer to find the layer in Figma.
function describeShape(node: {
  name: string
  attributes: Record<string, string>
}): string {
  const d = node.attributes.d
  return d
    ? `\`<${node.name}>\` starting \`${d.slice(0, 20)}\``
    : `\`<${node.name}>\``
}

function listShapes(shapes: string[]): string {
  return shapes.length === 1
    ? `The ${shapes[0]}`
    : `${shapes.length} shapes (${shapes.join(', ')})`
}

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
      const missingFills: string[] = []
      const badFills: string[] = []

      let nonRenderingDepth = 0

      const firstToken = (value: string | undefined): string =>
        (value || '').trim().split(/\s+/)[0]

      return {
        element: {
          enter(node) {
            if (NON_RENDERING_CONTAINERS.has(node.name)) {
              nonRenderingDepth++
            }
            if (nonRenderingDepth > 0 || node.name === 'svg') {
              return
            }
            const rawFill = node.attributes.fill
            const token = firstToken(rawFill)
            if (token === 'context-fill') hasContextFill = true
            if (token === 'context-stroke') hasContextStroke = true

            // A geometry element without a channel fill renders as default
            // black at runtime, which silently breaks chrome theming.
            if (GEOMETRY_ELEMENTS.has(node.name)) {
              if (!rawFill || rawFill.trim() === '') {
                missingFills.push(describeShape(node))
              } else if (
                token !== 'context-fill' &&
                token !== 'context-stroke'
              ) {
                badFills.push(`${describeShape(node)} (\`${rawFill}\`)`)
              }
            }
          },
          exit(node) {
            if (NON_RENDERING_CONTAINERS.has(node.name)) {
              nonRenderingDepth--
            }
          },
        },
        root: {
          exit() {
            const reasons: string[] = []
            if (!hasContextFill) {
              reasons.push(
                'No shape is named `context-fill`. Name the shape that should follow the icon color.',
              )
            }
            if (!hasContextStroke) {
              reasons.push(
                'No shape is named `context-stroke`. Name the shape that should follow the second color.',
              )
            }
            if (missingFills.length > 0) {
              reasons.push(
                `${listShapes(missingFills)} ${missingFills.length === 1 ? 'has' : 'have'} no color channel. It would render black. Name the layer \`context-fill\` or \`context-stroke\`.`,
              )
            }
            if (badFills.length > 0) {
              reasons.push(
                `${listShapes(badFills)} ${badFills.length === 1 ? 'has a' : 'have'} fixed color${badFills.length === 1 ? '' : 's'} instead of a color channel. Name the layer \`context-fill\` or \`context-stroke\` so the plugin replaces the color.`,
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
