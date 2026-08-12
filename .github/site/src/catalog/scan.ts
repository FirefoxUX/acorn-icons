import fs from 'node:fs'
import path from 'node:path'

/**
 * Derived from the working directory rather than `import.meta.url`, because
 * Vite bundles this module into `dist/.prerender/chunks` and a URL-relative
 * path would then point somewhere else. npm always runs a script from the
 * directory holding its package.json, and CI sets the same working directory.
 */
export const SITE_ROOT = process.cwd()
const REPO_ROOT = path.resolve(SITE_ROOT, '../..')

export type ScannedFile = {
  absPath: string
  /** Path relative to the repository root. */
  repoPath: string
  /** Path segments below the scanned root, the last being the filename. */
  segments: string[]
  filename: string
  ext: string
  bytes: number
}

const IGNORED_EXTENSIONS = new Set(['', '.zip', '.md', '.json'])

/**
 * Lists every asset file below `root`. Filenames are kept verbatim so downloads
 * resolve; callers that derive slugs are the ones that trim.
 */
export function scan(root: string): ScannedFile[] {
  const absRoot = path.join(REPO_ROOT, root)
  if (!fs.existsSync(absRoot)) {
    throw new Error(
      `Cannot find ${absRoot}. The catalog resolves the asset trees against ${REPO_ROOT}, derived from the working directory ${SITE_ROOT}. Run the build from .github/site.`,
    )
  }

  const files: ScannedFile[] = []
  for (const entry of fs.readdirSync(absRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || entry.name.startsWith('.')) {
      continue
    }

    const ext = path.extname(entry.name).toLowerCase()
    if (IGNORED_EXTENSIONS.has(ext)) {
      continue
    }

    const absPath = path.join(entry.parentPath, entry.name)
    const relative = path.relative(absRoot, absPath)
    files.push({
      absPath,
      repoPath: path.join(root, relative),
      segments: relative.split(path.sep),
      filename: entry.name,
      ext,
      bytes: fs.statSync(absPath).size,
    })
  }

  return files
}

export function readText(absPath: string): string {
  return fs.readFileSync(absPath, 'utf8')
}

/** @param relativeToSiteRoot For example `src/catalog/aliases.json`. */
export function readJson<T>(relativeToSiteRoot: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(SITE_ROOT, relativeToSiteRoot), 'utf8'),
  ) as T
}

/** @param relativeToRepoRoot For example `icons/categories.json`. */
export function readRepoJson<T>(relativeToRepoRoot: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativeToRepoRoot), 'utf8'),
  ) as T
}
