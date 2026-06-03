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

// `*-duotone-*.svg` files author two color channels (`fill="context-fill"`
// + `fill="context-stroke"`) on individual child elements so the chrome can
// theme each region independently. The pipeline must preserve those per-
// element fills instead of flattening them to a single root attribute.
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

  // Standard icons get `fill` and `fill-opacity` stripped and re-added on
  // the root by `addContextFill`. Duotone icons author per-element `fill`
  // attributes that must survive cleanup, so we keep them on disk and let
  // `normalizeDuotoneRoot` handle root-level housekeeping instead.
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
    plugins: [
      // `mapChannelIdsToFills` must run before attribute stripping so it
      // can read the designer-authored `id` / `data-name` markers that the
      // Figma export carries; `svgoRemoveAttrs` then drops the noise.
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

// `context-fill` and `context-fill-opacity` let Firefox UI apply the active
// chrome color/opacity to the icon at runtime — required for theming.
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

// Bridges the Figma-side icon-helper to the duotone contract: shapes named
// `context-fill` / `context-stroke` in the plugin land as `id` / `data-name`
// attributes after Figma's SVG export. Rewrite those into per-element `fill`
// attributes so the existing duotone validation accepts the file.
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

// Duotone icons keep `fill` on each child but the root `<svg>` only needs
// `fill-opacity` so the chrome's opacity flows down to the children.
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

// Records a violation when a `-duotone` file is missing the per-element
// `context-fill` / `context-stroke` structure that makes the suffix
// meaningful. Runs before `normalizeDuotoneRoot` so it can observe the
// designer-authored state, not the normalized state.
function validateDuotone(path: string, issues: DuotoneIssue[]): PluginConfig {
  return {
    name: 'validateDuotone',
    fn: () => {
      let hasContextFill = false
      let hasContextStroke = false
      let rootCarriesContextFill = false

      const firstToken = (value: string | undefined): string =>
        (value || '').trim().split(/\s+/)[0]

      return {
        element: {
          enter(node) {
            const token = firstToken(node.attributes.fill)
            if (node.name === 'svg') {
              if (token === 'context-fill' || token === 'context-stroke') {
                rootCarriesContextFill = true
              }
              return
            }
            if (token === 'context-fill') hasContextFill = true
            if (token === 'context-stroke') hasContextStroke = true
          },
        },
        root: {
          exit() {
            const reasons: string[] = []
            if (rootCarriesContextFill) {
              reasons.push(
                'root `<svg>` must not carry `fill="context-fill"` or `fill="context-stroke"` (put fills on the children instead)',
              )
            }
            if (!hasContextFill) {
              reasons.push('no child element has `fill="context-fill"`')
            }
            if (!hasContextStroke) {
              reasons.push('no child element has `fill="context-stroke"`')
            }
            if (reasons.length > 0) {
              issues.push({ path, reasons })
            }
          },
        },
      }
    },
  }
}
