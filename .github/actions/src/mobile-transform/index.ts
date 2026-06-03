import fs from 'node:fs'
import fg from 'fast-glob'
import { optimize } from 'svgo'
import { summary } from '../summary.js'
import {
  FormattableFile,
  ensureLicense,
  formatFile,
  getInput,
  removeOrphanedClipPathRefs,
  svgoBasePlugins,
  svgoRemoveAttrs,
  tryCatch,
} from '../utils.js'

tryCatch(run, 'Failed to check mobile files. See logs for details.')

async function run() {
  const filesGlob = getInput('files', true)
  const fileType = getInput('file_type', true) as FormattableFile
  const files = await fg(filesGlob)

  if (files.length === 0) {
    summary.addHeading(
      `Mobile ${fileType.toUpperCase()} files: no files found`,
      3,
    )
    summary.addAlert('warning', `No files found matching "${filesGlob}".`)
    summary.write()
    return
  }

  const changedFiles: string[] = []

  for (const file of files) {
    if (await updateMobileIcon(file, fileType)) {
      changedFiles.push(file)
    }
  }

  if (changedFiles.length === 0) {
    summary.addHeading(`Mobile ${fileType.toUpperCase()} files unchanged`, 3)
    summary.addRaw(
      `Checked ${files.length} ${fileType.toUpperCase()} files and made no changes.`,
    )
    summary.write()
    return
  }

  summary.addHeading(
    `Updated ${changedFiles.length} mobile ${fileType.toUpperCase()} files`,
    3,
  )
  summary.addList(changedFiles)
  summary.write()
}

async function updateMobileIcon(
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
    formatted = optimize(originalFile, {
      // Loop until output stabilizes (see desktop-transform for rationale).
      multipass: true,
      plugins: [
        // These attributes are added during export but are noise for our
        // simple single-shape icons.
        svgoRemoveAttrs([
          'id',
          'data-name',
          'class',
          'stroke',
          'stroke-width',
          'stroke-miterlimit',
        ]),
        removeOrphanedClipPathRefs,
        ...svgoBasePlugins,
      ],
    }).data

    formatted = await formatFile(type, formatted)
  }

  const withLicense = ensureLicense(formatted)

  const fileChanged = withLicense !== originalFile
  if (fileChanged) {
    fs.writeFileSync(path, withLicense)
  }
  return fileChanged
}
