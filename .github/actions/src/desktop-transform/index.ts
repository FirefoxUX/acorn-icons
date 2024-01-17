import { PluginConfig, optimize } from 'svgo'
import fg from 'fast-glob'
import fs from 'fs'
import { summary } from '../summary.js'
import {
  ensureLicense,
  formatFile,
  getInput,
  svgoBasePlugins,
  svgoRemoveAttrs,
  tryCatch,
} from '../utils.js'

tryCatch(run, 'Failed to check desktop SVGs. See logs for details.')

async function run() {
  // get glob pattern from environment
  const filesGlob = getInput('files', true)
  // get all file paths that match the glob pattern
  const files = await fg(filesGlob)

  // Return a message if no files are found
  if (files.length === 0) {
    summary.addHeading(':desktop_computer: No files found', 3)
    summary.addAlert('warning', `No files found matching "${filesGlob}".`)
    summary.write()
    return
  }

  // we will keep track of changed files for the summary
  const changedFiles: string[] = []

  // loop through each file and check them.
  // This will automatically update the file if needed.
  for (const file of files) {
    if (await updateDesktopIcon(file)) {
      changedFiles.push(file)
    }
  }

  // If no files were changed, write a message and exit
  if (changedFiles.length === 0) {
    summary.addHeading(':desktop_computer: No SVGs changed', 3)
    summary.addRaw(`Checked ${files.length} desktop SVGs and made no changes.`)
    summary.write()
    return
  }

  // Otherwise, write a summary of changed files
  summary.addHeading(
    `:desktop_computer: Updated ${changedFiles.length} desktop SVGs`,
    3,
  )
  summary.addList(changedFiles)
  summary.write()
}

/**
 * Apply optimizations and formatting to an SVG file for desktop
 *
 * @param path relative path from the current working directory to the SVG file
 * @returns true if the file was changed, false otherwise
 */
async function updateDesktopIcon(path: string): Promise<boolean> {
  // we skip if the file is not an SVG
  if (!path.endsWith('.svg')) {
    return false
  }
  console.log(`Checking ${path}`)
  // Now load the file's contents from disk
  const originalFile = fs.readFileSync(path, 'utf8')

  // Optimize the SVG using SVGO
  const result = optimize(originalFile, {
    plugins: [
      // custom plugin to add viewBox and dimensions if missing
      viewBoxAndDimensions,
      // custom plugin to add context fill
      addContextFill,
      // Import the base config from utils.ts
      ...svgoBasePlugins,
      // Remove all these attributes
      // They usually are added in the export process but for our simple
      //shapes we don't need them
      svgoRemoveAttrs([
        'id',
        'data-name',
        'class',
        'fill',
        'stroke',
        'stroke-width',
        'stroke-miterlimit',
        'clip-rule',
        'fill-rule',
        'fill-opacity',
      ]),
    ],
  })

  // now we run prettier on the file
  const formatted = await formatFile('svg', result.data)
  // and add the license header if needed
  const withLicense = ensureLicense(formatted)

  // if the file changed, write it back to disk
  const fileChanged = withLicense !== originalFile
  if (fileChanged) {
    fs.writeFileSync(path, withLicense)
  }
  return fileChanged
}

/**
 * SVGO plugin to add viewBox and dimensions if either is missing
 */
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

        // return if all are present
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

/**
 * SVGO plugin to add fill and fill-opacity attributes to SVGs
 */
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
