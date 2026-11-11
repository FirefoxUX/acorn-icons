import { EOL } from 'os'
import fs from 'fs'
import path from 'path'
import { summary } from './summary.js'
import prettier from 'prettier'
import prettierXmlPlugin from '@prettier/plugin-xml'
import { Config, PluginConfig, XastParent } from 'svgo'

/**
 * Mozilla Public License 2.0 header for XML files
 */
export const XML_LICENSE = `<!-- This Source Code Form is subject to the terms of the Mozilla Public${EOL}   - License, v. 2.0. If a copy of the MPL was not distributed with this${EOL}   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->`
/**
 * File types that can be formatted
 */
export type FormattableFile = 'svg' | 'xml'

/**
 * Retrieves an input from the environment
 * E.g. if the environment variable is INPUT_FOO_BAR, then the name should be "foo_bar"
 *
 * @param name the name of the input
 * @param required whether the input is required
 * @returns the input value
 */
export function getInput(name: string, required = true): string {
  const val: string = getEnv(`INPUT_${name.replace(/ /g, '_').toUpperCase()}`)
  if (required && !val) {
    throw new Error(`Input required and not supplied: ${name}`)
  }

  return val.trim()
}

/**
 * Retrieves an environment variable
 *
 * @param name the name of the environment variable
 * @returns the environment variable value or an empty string if not found
 */
export function getEnv(name: string): string {
  return process.env[name] || ''
}

/**
 * Ensures that a license is present at the top of the file
 *
 * @param input the file contents
 * @returns the file contents with the license added if needed
 */
export function ensureLicense(input: string): string {
  // Because the license might have different line breaks, we use a regex to
  // match the beginning and end of the license and all whitespace in until the
  // next character after the license.
  const regex = new RegExp(
    '<!-- This Source Code Form is[\\s\\S]*?http://mozilla.org/MPL/2.0/. -->\\s*',
    'g',
  )
  // Remove the license from the file if it exists
  const output = input.replace(regex, '')
  // add the license to the top of the file
  return `${XML_LICENSE}${EOL}${output}`
}

/**
 * Wrapper function for actions that wraps the function in a try/catch block.
 * An unexpected error is logged, added to the summary and recorded as an
 * automation finding, and the process exits with a non-zero exit code.
 *
 * @param fn Function to run in a try/catch block
 * @param errorSummary Message to add to the summary if the function throws an error
 * @returns Promise of the result of the function
 */
export async function tryCatch(fn: () => void, errorSummary: string) {
  try {
    return await fn()
  } catch (error) {
    console.log(`::error title=Action failed::${errorSummary}`)
    console.error(error)
    summary.addAlert('caution', errorSummary)
    // Awaited, because `summary.write` appends asynchronously and the
    // process would otherwise end before it reached the job summary.
    await summary.write()
    recordFindings([
      {
        kind: 'automation',
        title: errorSummary.replace(/\. See logs for details\.$/, ''),
        body: error instanceof Error ? error.message : String(error),
      },
    ])
  }
}

/**
 * Formats a file using prettier.
 * Current config has been written for svg and xml files.
 *
 * @param type either "svg" or "xml"
 * @param content the file contents
 * @returns the formatted file contents
 */
export async function formatFile(type: FormattableFile, content: string) {
  if (!['svg', 'xml'].includes(type)) {
    throw new Error(`Invalid type to format: ${type}`)
  }

  const formatted = await prettier.format(content, {
    parser: 'xml',
    plugins: [prettierXmlPlugin],
    tabWidth: 4,
    printWidth: type === 'svg' ? 100000 : 80,
    singleAttributePerLine: false,
    htmlWhitespaceSensitivity: 'ignore',
    bracketSameLine: true,
    xmlWhitespaceSensitivity: 'ignore',
  })

  return formatted
}

/**
 * SVGO plugins that should run on all SVGs
 */
export const svgoBasePlugins: Exclude<Config['plugins'], undefined> = [
  'removeDesc',
  'removeStyleElement',
  'removeOffCanvasPaths',
  'removeNonInheritableGroupAttrs',
  'sortAttrs',
  'preset-default',
]

/**
 * SVGO plugins for illustrations.
 *
 * Deliberately omits `preset-default`. Every illustration paints through
 * `fill="url(#id)"` into a gradient definition, so `cleanupIds` and
 * `removeViewBox` would break them. Nothing here rewrites path data or
 * touches `id`, `fill` or `stroke`. The pass strips export noise and gives
 * the files a stable byte layout; it is not a size optimization.
 */
export const svgoConservativePlugins: Exclude<Config['plugins'], undefined> = [
  'removeDesc',
  'removeComments',
  // The default precision of 3 rounds the `<stop offset>` values in the
  // pic-shield gradients, and `mix-blend-mode` would amplify the resulting
  // sub-pixel shift. 4 leaves every value in the tree untouched.
  { name: 'cleanupNumericValues', params: { floatPrecision: 4 } },
  'sortAttrs',
]

/**
 * SVGO plugin that removes `clip-path="url(#id)"` attributes pointing at an
 * id that is not defined anywhere in the document.
 *
 * Earlier export tooling stripped unused `<clipPath>` defs but left orphaned
 * `<g clip-path="url(...)">` wrappers behind. Stripping the now-meaningless
 * attribute lets `collapseGroups` (part of preset-default) unwrap or simplify
 * the resulting `<g>`.
 */
export const removeOrphanedClipPathRefs: PluginConfig = {
  name: 'removeOrphanedClipPathRefs',
  fn: () => {
    const definedIds = new Set<string>()
    const urlRefRe = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/

    const collectIds = (node: XastParent) => {
      for (const child of node.children) {
        if (child.type !== 'element') continue
        if (child.name === 'clipPath' && child.attributes?.id) {
          definedIds.add(child.attributes.id)
        }
        collectIds(child)
      }
    }

    return {
      root: {
        enter(root) {
          collectIds(root)
        },
      },
      element: {
        enter(node) {
          const ref = node.attributes?.['clip-path']
          if (!ref) return
          const match = urlRefRe.exec(ref)
          if (!match) return
          if (!definedIds.has(match[1])) {
            delete node.attributes['clip-path']
          }
        },
      },
    }
  },
}

/**
 * Returns the bounds of a path whose `d` draws a single axis-aligned
 * rectangle, or null for any other shape.
 */
function rectanglePathBounds(
  d: string,
): [number, number, number, number] | null {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return null

  const points: [number, number][] = []
  let x = 0
  let y = 0
  let command = ''
  let i = 0
  const next = (): number => parseFloat(tokens[i++])

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      command = tokens[i++]
      if (command === 'z' || command === 'Z') {
        // Anything after the close starts a second subpath.
        if (i !== tokens.length) return null
        break
      }
      if ((command === 'M' || command === 'm') && points.length > 0) {
        return null
      }
    }
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'M':
      case 'L': {
        const nx = next()
        const ny = next()
        x = relative ? x + nx : nx
        y = relative ? y + ny : ny
        // Coordinate pairs after a moveto are implicit linetos.
        if (command === 'M') command = 'L'
        if (command === 'm') command = 'l'
        break
      }
      case 'H':
        x = relative ? x + next() : next()
        break
      case 'V':
        y = relative ? y + next() : next()
        break
      default:
        return null
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    points.push([x, y])
  }

  const xs = [...new Set(points.map(([px]) => px))]
  const ys = [...new Set(points.map(([, py]) => py))]
  if (xs.length !== 2 || ys.length !== 2) return null
  // Two distinct x and y values allow only the four corners of one
  // rectangle. A diagonal edge, including the implicit closing edge, would
  // cut it in half.
  for (let j = 0; j < points.length; j++) {
    const [ax, ay] = points[j]
    const [bx, by] = points[(j + 1) % points.length]
    if (ax !== bx && ay !== by) return null
  }
  const corners = new Set(points.map(([px, py]) => `${px},${py}`))
  if (corners.size !== 4) return null

  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY]
}

/**
 * Removes `<clipPath>` defs whose only purpose is to clip to the full
 * viewBox. Figma adds these on every export as a `<rect>`, which SVGO turns
 * into an equivalent `<path>`. They survive `removeUselessDefs` because they
 * have an id and a referrer, but they have no visual effect.
 */
export const removeNoOpClipPaths: PluginConfig = {
  name: 'removeNoOpClipPaths',
  fn: () => {
    let vb: [number, number, number, number] | null = null

    const num = (v: string | undefined, fallback: number): number => {
      if (v === undefined) return fallback
      const n = parseFloat(v)
      return Number.isFinite(n) ? n : NaN
    }

    return {
      element: {
        enter(node, parentNode) {
          if (node.name === 'svg') {
            const parts = (node.attributes.viewBox ?? '')
              .trim()
              .split(/[\s,]+/)
              .map((s) => parseFloat(s))
            if (parts.length === 4 && parts.every(Number.isFinite)) {
              vb = [parts[0], parts[1], parts[2], parts[3]]
            }
            return
          }
          if (vb === null || node.name !== 'clipPath') return

          const elementKids = node.children.filter((c) => c.type === 'element')
          if (elementKids.length !== 1) return
          const child = elementKids[0]
          if (child.attributes.transform) return

          let bounds: [number, number, number, number] | null = null
          if (child.name === 'rect') {
            bounds = [
              num(child.attributes.x, 0),
              num(child.attributes.y, 0),
              num(child.attributes.width, NaN),
              num(child.attributes.height, NaN),
            ]
          } else if (child.name === 'path') {
            bounds = rectanglePathBounds(child.attributes.d ?? '')
          }
          if (bounds === null || !bounds.every(Number.isFinite)) return

          const [x, y, w, h] = bounds

          const [vbX, vbY, vbW, vbH] = vb
          if (
            x <= vbX &&
            y <= vbY &&
            x + w >= vbX + vbW &&
            y + h >= vbY + vbH
          ) {
            parentNode.children = parentNode.children.filter((c) => c !== node)
          }
        },
      },
    }
  },
}

/**
 * Job summaries are assembled as raw HTML, where Markdown backticks would
 * show up literally. The same message strings go into pull request comments,
 * which are Markdown, so they keep their backticks and get converted here.
 */
export function inlineCode(text: string): string {
  return text.replace(/`([^`]+)`/g, '<code>$1</code>')
}

/**
 * One problem to show on the pull request.
 *
 * - `fix`: the author can resolve it.
 * - `automation`: the pipeline itself failed, which is not the author's fault.
 * - `body`: Markdown. Should name each offending file and say how to resolve
 *   it.
 */
export type Finding = {
  kind: 'fix' | 'automation'
  title: string
  body: string
}

export const FINDINGS_FILE = 'findings.jsonl'

/**
 * Appends findings, one JSON object per line, to the file the report job
 * collects from this job's runner. Several steps of one job write to the same
 * file. Marks the process as failed, so a step that records a finding fails
 * its job without every caller having to remember to exit.
 *
 * Outside CI there is no `RUNNER_TEMP`, so the findings only reach the log.
 */
export function recordFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    return
  }
  process.exitCode = 1
  for (const finding of findings) {
    console.log(`::error::${finding.title}`)
  }
  const runnerTemp = process.env.RUNNER_TEMP
  if (!runnerTemp) {
    return
  }
  try {
    fs.mkdirSync(runnerTemp, { recursive: true })
    fs.appendFileSync(
      path.join(runnerTemp, FINDINGS_FILE),
      findings.map((finding) => `${JSON.stringify(finding)}\n`).join(''),
      'utf8',
    )
  } catch (error) {
    // The job is already failing, and the report job falls back to a generic
    // automation message when a failed job left no findings.
    console.error(error)
  }
}

/**
 * The finding for a file that threw while it was being read or optimized.
 */
export function unreadableFinding(filePath: string, detail: string): Finding {
  const relative = path.relative(process.cwd(), filePath)
  return {
    kind: 'fix',
    title: `\`${path.basename(filePath)}\` could not be read`,
    body: [
      `\`${relative}\``,
      '',
      `The file could not be processed: ${detail}`,
      '',
      'Export the icon from Figma again and replace the file. If the new export fails the same way, the problem is probably in the file and not in your icon, so please let us know.',
    ].join('\n'),
  }
}

/**
 * Factory function to create an SVGO plugin that removes specified attributes
 *
 * @param attrs the attributes to remove
 * @returns the plugin config
 */
export function svgoRemoveAttrs(attrs: string[]): PluginConfig {
  const attrString = attrs.map((attr) => attr.trim()).join('|')
  return {
    name: 'removeAttrs',
    params: {
      attrs: `(${attrString})`,
    },
  }
}
