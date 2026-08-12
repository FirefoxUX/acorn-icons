import fs from 'node:fs'
import fg from 'fast-glob'
import { optimize } from 'svgo'
import { summary } from '../summary.js'
import {
  FormattableFile,
  ensureLicense,
  formatFile,
  getInput,
  svgoConservativePlugins,
  tryCatch,
} from '../utils.js'

tryCatch(run, 'Failed to check illustration files. See logs for details.')

async function run() {
  const filesGlob = getInput('files', true)
  const fileType = getInput('file_type', true) as FormattableFile
  const files = await fg(filesGlob)

  if (files.length === 0) {
    summary.addHeading(
      `Illustration ${fileType.toUpperCase()} files: no files found`,
      3,
    )
    summary.addAlert('warning', `No files found matching "${filesGlob}".`)
    summary.write()
    return
  }

  const changedFiles: string[] = []

  for (const file of files) {
    if (await updateIllustration(file, fileType)) {
      changedFiles.push(file)
    }
  }

  if (changedFiles.length === 0) {
    summary.addHeading(
      `Illustration ${fileType.toUpperCase()} files unchanged`,
      3,
    )
    summary.addRaw(
      `Checked ${files.length} ${fileType.toUpperCase()} files and made no changes.`,
    )
    summary.write()
    return
  }

  summary.addHeading(
    `Updated ${changedFiles.length} illustration ${fileType.toUpperCase()} files`,
    3,
  )
  summary.addList(changedFiles)
  summary.write()
}

async function updateIllustration(
  path: string,
  type: FormattableFile,
): Promise<boolean> {
  if (!path.endsWith(`.${type}`)) {
    return false
  }
  console.log(`Checking ${path}`)
  const originalFile = fs.readFileSync(path, 'utf8')

  let formatted = originalFile

  if (type === 'svg') {
    // No multipass: none of the conservative plugins feeds another, so a
    // single pass is already a fixed point.
    formatted = optimize(originalFile, {
      multipass: false,
      plugins: [...svgoConservativePlugins],
    }).data
  }

  // Unlike the mobile icon XML, illustration drawables are reformatted too:
  // they arrive from the exporter with inconsistent indentation, and the
  // nested `aapt:attr` gradients are unreadable without it.
  formatted = await formatFile(type, formatted)

  // `removeComments` strips the license on every run after the first, so
  // this has to come last to put the canonical form back.
  const withLicense = ensureLicense(formatted)

  const fileChanged = withLicense !== originalFile
  if (fileChanged) {
    fs.writeFileSync(path, withLicense)
  }
  return fileChanged
}
