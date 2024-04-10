import fs from 'node:fs'
import fg from 'fast-glob'
import { optimize } from 'svgo'
import { summary } from '../summary.js'
import {
  FormattableFile,
  ensureLicense,
  formatFile,
  getInput,
  svgoBasePlugins,
  svgoRemoveAttrs,
  tryCatch,
} from '../utils.js'

tryCatch(run, 'Failed to check mobile files. See logs for details.')

async function run() {
  // get glob pattern from environment
  const filesGlob = getInput('files', true)
  // get file type from environment
  const fileType = getInput('file_type', true) as FormattableFile
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
    if (await updateMobileIcon(file, fileType)) {
      changedFiles.push(file)
    }
  }

  // If no files were changed, write a message and exit
  if (changedFiles.length === 0) {
    summary.addHeading(`:iphone: No ${fileType.toUpperCase()} files changed`, 3)
    summary.addRaw(
      `Checked ${files.length} ${fileType.toUpperCase()} files and made no changes.`,
    )
    summary.write()
    return
  }

  // Otherwise, write a summary of changed files
  summary.addHeading(
    `:iphone: Updated ${changedFiles.length} mobile ${fileType.toUpperCase()} files`,
    3,
  )
  summary.addList(changedFiles)
  summary.write()
}

/**
 * Apply optimizations and formatting to an SVG file for mobile
 *
 * @param path relative path from the current working directory to the SVG file
 * @returns true if the file was changed, false otherwise
 */
async function updateMobileIcon(
  path: string,
  type: FormattableFile,
): Promise<boolean> {
  // we skip if the file is not an SVG
  if (!path.endsWith(`.${type}`)) {
    return false
  }
  console.log(`Checking ${path}`)
  // Now load the file's contents from disk
  const originalFile = fs.readFileSync(path, 'utf8')

  let formatted = originalFile

  // If the file is an SVG, optimize the SVG using SVGO
  if (type === 'svg') {
    formatted = optimize(originalFile, {
      plugins: [
        // Remove all these attributes
        // They usually are added in the export process but for our simple
        // shapes we don't need them
        svgoRemoveAttrs([
          'id',
          'data-name',
          'class',
          'stroke',
          'stroke-width',
          'stroke-miterlimit',
        ]),
        // Import the base config from utils.ts
        ...svgoBasePlugins,
      ],
    }).data

    // now we run prettier on the file
    formatted = await formatFile(type, originalFile)
  }

  // and add the license header if needed
  const withLicense = ensureLicense(formatted)

  // if the file changed, write it back to disk
  const fileChanged = withLicense !== originalFile
  if (fileChanged) {
    fs.writeFileSync(path, withLicense)
  }
  return fileChanged
}
